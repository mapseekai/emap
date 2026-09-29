import { getDefaultMapshaperAdapter } from './adapter';

const ARRAY_CHUNK_LENGTH = 2048;
// Small messages are already bounded by their caller (e.g. 4096-row GPKG batches).
const ARRAY_CHUNK_THRESHOLD = 4096;
interface BinaryChunk {
  attachment?: number;
  bytes?: Uint8Array;
}
interface ChunkedArray {
  path: Array<string | number>;
  length: number;
  chunks: BinaryChunk[];
}

/** Keep data under an envelope: unpackSessionData restores only root datasets. */
export function encodeWorkerData(value: unknown, attachments?: Uint8Array[]): Uint8Array {
  const views: Array<{
    path: Array<string | number>;
    type: string;
    bytes?: Uint8Array;
    attachment?: number;
  }> = [];
  const attached = new Map<ArrayBufferLike, Map<string, number>>();
  const dates: Array<{ path: Array<string | number>; time: number }> = [];
  const arrays: ChunkedArray[] = [];
  const ancestors = new Set<object>();
  const visitArray = (item: any[], path: Array<string | number>, start: number, end: number) => {
    const result = new Array(end - start);
    for (let i = start; i < end; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
      if (!descriptor) continue;
      if (!('value' in descriptor))
        throw new TypeError('Worker binary data must not contain accessors');
      result[i - start] = visit(descriptor.value, [...path, i]);
    }
    return result;
  };
  const visit = (item: any, path: Array<string | number>): any => {
    if (item instanceof Date) {
      dates.push({ path, time: Date.prototype.getTime.call(item) });
      return null;
    }
    if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint')
      throw new TypeError('Unsupported Worker binary value');
    if (path.length > 128) throw new RangeError('Worker binary data exceeds maximum depth');
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) {
      const bytes =
        item instanceof ArrayBuffer
          ? new Uint8Array(item)
          : new Uint8Array(item.buffer, item.byteOffset, item.byteLength);
      if (attachments && bytes.byteLength >= 64 * 1024 && attachments.length < 4000) {
        let entries = attached.get(bytes.buffer);
        if (!entries) attached.set(bytes.buffer, (entries = new Map()));
        const key = `${bytes.byteOffset}:${bytes.byteLength}`;
        let attachment = entries.get(key);
        if (attachment === undefined) {
          attachment = attachments.length;
          entries.set(key, attachment);
          attachments.push(bytes);
        }
        views.push({ path, type: item.constructor.name, attachment });
      } else views.push({ path, type: item.constructor.name, bytes });
      return null;
    }
    if (item && typeof item === 'object') {
      if (ancestors.has(item)) throw new TypeError('Cyclic Worker binary data is unsupported');
      const proto = Object.getPrototypeOf(item);
      if (!Array.isArray(item) && proto !== Object.prototype && proto !== null)
        throw new TypeError('Unsupported Worker binary object');
      ancestors.add(item);
      try {
        if (Array.isArray(item)) {
          if (attachments && item.length > ARRAY_CHUNK_THRESHOLD) {
            const array: ChunkedArray = { path, length: item.length, chunks: [] };
            // Preorder is important: parent arrays must exist before child paths decode.
            arrays.push(array);
            for (let i = 0; i < item.length; i += ARRAY_CHUNK_LENGTH) {
              const payload = visitArray(
                item,
                path,
                i,
                Math.min(item.length, i + ARRAY_CHUNK_LENGTH),
              );
              // Repeated record keys dominate large attribute tables. Keep one
              // ordered schema per homogeneous chunk; mixed shapes stay generic.
              const first = payload[0];
              const keys =
                first && typeof first === 'object' && !Array.isArray(first)
                  ? Object.keys(first)
                  : null;
              const tabular =
                keys &&
                Object.keys(payload).length === payload.length &&
                payload.every((row) => {
                  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
                  const names = Object.keys(row);
                  return names.length === keys.length && names.every((name, i) => name === keys[i]);
                });
              const bytes = Uint8Array.from(
                getDefaultMapshaperAdapter().pack({
                  datasets: [],
                  payload: tabular ? payload.map((row) => keys.map((name) => row[name])) : payload,
                  ...(tabular ? { keys } : {}),
                }),
              );
              if (attachments.length < 4000) {
                array.chunks.push({ attachment: attachments.length });
                attachments.push(bytes);
              } else array.chunks.push({ bytes });
            }
            return null;
          }
          return visitArray(item, path, 0, item.length);
        }
        // Escape every payload key: mapshaper's codec rewrites __proto__ keys.
        return Object.fromEntries(
          Object.keys(item).map((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
            if (!('value' in descriptor))
              throw new TypeError('Worker binary data must not contain accessors');
            return [':' + key, visit(descriptor.value, [...path, key])];
          }),
        );
      } finally {
        ancestors.delete(item);
      }
    }
    return item;
  };
  // mapshaper's MessagePack codec treats arbitrary typed views as bytes, losing
  // their element type. Keep exact view bytes and restore only recorded paths.
  return Uint8Array.from(
    getDefaultMapshaperAdapter().pack({
      datasets: [],
      payload: visit(value, []),
      views,
      dates,
      arrays,
    }),
  );
}
export async function decodeWorkerData<T>(data: Uint8Array | WorkerDataPacket): Promise<T> {
  const bytes = data instanceof Uint8Array ? data : data.bytes;
  const attachments = data instanceof Uint8Array ? [] : data.buffers;
  const envelope = await getDefaultMapshaperAdapter().unpackSessionData(bytes);
  const restoreKeys = (item: any): any => {
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) item[i] = restoreKeys(item[i]);
      return item;
    }
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item).map(([key, value]) => [key.slice(1), restoreKeys(value)]),
      );
    return item;
  };
  let result = restoreKeys(envelope.payload);
  const assign = (path: Array<string | number>, value: unknown) => {
    if (!path.length) result = value;
    else {
      let target = result as Record<string | number, any>;
      for (const key of path.slice(0, -1)) target = target[key];
      Object.defineProperty(target, path.at(-1)!, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  };
  const arrays = (envelope.arrays ?? []) as ChunkedArray[];
  if (arrays.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  let slice = performance.now();
  for (const array of arrays) {
    const values = new Array(array.length);
    assign(array.path, values);
    let offset = 0;
    for (const chunk of array.chunks) {
      const bytes = chunk.attachment === undefined ? chunk.bytes : attachments[chunk.attachment];
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Invalid Worker array attachment');
      const decoded = await getDefaultMapshaperAdapter().unpackSessionData(bytes);
      let items = restoreKeys(decoded.payload);
      if (decoded.keys !== undefined) {
        const keys = decoded.keys as string[];
        if (
          !Array.isArray(keys) ||
          keys.some((key) => typeof key !== 'string' || !key.startsWith(':')) ||
          !Array.isArray(items) ||
          items.some((row: unknown) => !Array.isArray(row) || row.length !== keys.length)
        )
          throw new TypeError('Invalid Worker record chunk');
        items = items.map((row: unknown[]) => {
          const record: Record<string, unknown> = {};
          for (let i = 0; i < keys.length; i++) {
            const name = keys[i].slice(1),
              value = row[i];
            if (name === '__proto__')
              Object.defineProperty(record, name, {
                value,
                enumerable: true,
                configurable: true,
                writable: true,
              });
            else record[name] = value;
          }
          return record;
        });
      }
      if (
        !Array.isArray(items) ||
        items.length > ARRAY_CHUNK_LENGTH ||
        offset + items.length > values.length
      )
        throw new TypeError('Invalid Worker array chunk');
      for (let i = 0; i < items.length; i++) values[offset++] = items[i];
      if (performance.now() - slice > 4) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        slice = performance.now();
      }
    }
    if (offset !== values.length) throw new TypeError('Incomplete Worker array chunks');
  }
  for (const date of (envelope.dates ?? []) as Array<{
    path: Array<string | number>;
    time: number;
  }>)
    assign(date.path, new Date(date.time));
  const constructors: Record<string, new (buffer: ArrayBuffer) => ArrayBufferView> = {
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    DataView,
  };
  for (const view of envelope.views as Array<{
    path: Array<string | number>;
    type: string;
    bytes?: Uint8Array;
    attachment?: number;
  }>) {
    const bytes = view.attachment === undefined ? view.bytes : attachments[view.attachment];
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Invalid Worker binary attachment');
    const buffer =
      view.attachment !== undefined &&
      bytes.byteOffset === 0 &&
      bytes.byteLength === bytes.buffer.byteLength &&
      bytes.buffer instanceof ArrayBuffer
        ? bytes.buffer
        : Uint8Array.from(bytes).buffer;
    const Ctor = Object.hasOwn(constructors, view.type) ? constructors[view.type] : undefined;
    if (!Ctor && view.type !== 'ArrayBuffer')
      throw new Error(`Unsupported Worker binary view: ${view.type}`);
    const value = Ctor ? new Ctor(buffer) : buffer;
    assign(view.path, value);
  }
  return result as T;
}

/** Object metadata plus bounded binary attachments, all owned by the returned packet. */
export interface WorkerDataPacket {
  bytes: Uint8Array;
  buffers: Uint8Array[];
}
export function encodeWorkerPacket(
  value: unknown,
  transfer: readonly Transferable[] = [],
): WorkerDataPacket {
  const buffers: Uint8Array[] = [];
  const bytes = encodeWorkerData(value, buffers);
  const owned = new Set(transfer);
  return {
    bytes,
    buffers: buffers.map((view) =>
      view.buffer instanceof ArrayBuffer &&
      owned.has(view.buffer) &&
      view.byteOffset === 0 &&
      view.byteLength === view.buffer.byteLength
        ? view
        : view.slice(),
    ),
  };
}
export function workerPacketTransfers(packet: WorkerDataPacket): ArrayBuffer[] {
  return [
    ...new Set([packet.bytes.buffer, ...packet.buffers.map((view) => view.buffer)]),
  ] as ArrayBuffer[];
}

/** Conservative wire/preparation bound without constructing a second object tree. */
export function workerDataByteBound(value: unknown, limit = 2 * 1024 ** 3): number {
  let bytes = 1024 ** 2;
  const ancestors = new Set<object>();
  const visit = (item: any, pathBytes: number, depth: number): void => {
    if (bytes >= limit) return;
    if (depth > 128) throw new RangeError('Worker binary data exceeds maximum depth');
    if (item instanceof Date) {
      bytes += pathBytes + 128;
      return;
    }
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) {
      bytes += item.byteLength + pathBytes + 512;
      return;
    }
    if (typeof item === 'string') {
      bytes += item.length * 3 + 8;
      return;
    }
    if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint')
      throw new TypeError('Unsupported Worker binary value');
    if (!item || typeof item !== 'object') {
      bytes += 9;
      return;
    }
    if (ancestors.has(item)) throw new TypeError('Cyclic Worker binary data is unsupported');
    const array = Array.isArray(item);
    const proto = Object.getPrototypeOf(item);
    if (!array && proto !== Object.prototype && proto !== null)
      throw new TypeError('Unsupported Worker binary object');
    ancestors.add(item);
    bytes += 16;
    try {
      const inspect = (key: string, nextPath: number) => {
        const field = Object.getOwnPropertyDescriptor(item, key);
        if (!field) {
          bytes += 9;
          return;
        }
        if (!('value' in field))
          throw new TypeError('Worker binary data must not contain accessors');
        visit(field.value, nextPath, depth + 1);
      };
      if (array) {
        if (item.length > ARRAY_CHUNK_THRESHOLD)
          bytes += Math.ceil(item.length / ARRAY_CHUNK_LENGTH) * 128 + pathBytes + 128;
        for (let i = 0; i < item.length && bytes < limit; i++) inspect(String(i), pathBytes + 9);
      } else {
        for (const key of Object.keys(item)) {
          if (bytes >= limit) break;
          const cost = key.length * 3 + 12;
          bytes += cost;
          inspect(key, pathBytes + cost);
        }
      }
    } finally {
      ancestors.delete(item);
    }
  };
  visit(value, 0, 0);
  return Math.min(limit, bytes);
}

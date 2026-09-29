import { expect, it } from 'vitest';
import { encodeWorkerData, decodeWorkerData } from './binary';
it('preserves signed IDs, fractional coordinates, view offsets and hostile record keys', async () => {
  const bytes = new Uint8Array([9, 1, 255, 8]);
  const value = {
    coordinates: new Float64Array([1.25, -180.1, Infinity, NaN]),
    ids: new Int32Array([0, -2, 3]),
    count: new Uint32Array([2]),
    blob: bytes.subarray(1, 3),
    records: [JSON.parse('{"__proto__":"safe","constructor":"attribute"}')],
  };
  const result = await decodeWorkerData<typeof value>(encodeWorkerData(value));
  expect(result).toEqual(value);
  expect(result.coordinates).toBeInstanceOf(Float64Array);
  expect(result.ids).toBeInstanceOf(Int32Array);
  expect(result.blob.byteLength).toBe(2);
  expect(({} as Record<string, unknown>).safe).toBeUndefined();
});

it('preserves epoch, invalid and nested dates including special attribute keys', async () => {
  const input = {
    epoch: new Date(0),
    invalid: new Date(NaN),
    nested: [{ when: new Date('2026-09-25T00:00:00Z') }],
    ...Object.fromEntries([['__proto__', new Date(123)]]),
  };
  expect(await decodeWorkerData(encodeWorkerData(input))).toEqual(input);
  expect(await decodeWorkerData(encodeWorkerData(new Date(0)))).toEqual(new Date(0));
});
it('rejects unsupported objects and cycles rather than silently corrupting data', () => {
  for (const value of [new Map(), new Set(), /pattern/, () => {}, Symbol('attribute')])
    expect(() => encodeWorkerData({ value })).toThrow(/Unsupported/);
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  expect(() => encodeWorkerData(cycle)).toThrow(/Cyclic/);
  let calls = 0;
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  expect(() => encodeWorkerData(accessor)).toThrow(/accessors/);
  expect(calls).toBe(0);
});

it('keeps large buffers outside MessagePack and preserves caller ownership', async () => {
  const { encodeWorkerPacket, workerPacketTransfers, workerDataByteBound } = await import(
    './binary'
  );
  const { packetByteLength } = await import('@mapseekai/tasklane');
  const coordinates = Float64Array.from({ length: 40000 }, (_, i) => i / 3);
  const value = { coordinates, when: new Date(123), alias: coordinates };
  const packet = encodeWorkerPacket(value);
  expect(packet.bytes.byteLength).toBeLessThan(4096);
  expect(packet.buffers).toHaveLength(1);
  expect(packet.buffers[0].buffer).not.toBe(coordinates.buffer);
  expect(packetByteLength(packet)).toBeLessThanOrEqual(workerDataByteBound(value));
  const received = structuredClone(packet, { transfer: workerPacketTransfers(packet) });
  expect(coordinates.byteLength).toBe(320000);
  const result = await decodeWorkerData<typeof value>(received);
  expect(result).toEqual(value);
  expect(result.coordinates.buffer).toBe(received.buffers[0].buffer);
  expect(result.alias.buffer).toBe(result.coordinates.buffer);
});
it('directly transfers explicitly owned full buffers', async () => {
  const { encodeWorkerPacket, workerPacketTransfers } = await import('./binary');
  const values = new Float64Array(40000);
  values[3] = 1.25;
  const packet = encodeWorkerPacket({ values }, [values.buffer]);
  expect(packet.buffers[0].buffer).toBe(values.buffer);
  const received = structuredClone(packet, { transfer: workerPacketTransfers(packet) });
  expect(values.byteLength).toBe(0);
  expect((await decodeWorkerData<{ values: Float64Array }>(received)).values[3]).toBe(1.25);
});

it('copies partial views exactly and packs thousands of tiny blobs without attachment overflow', async () => {
  const { encodeWorkerPacket } = await import('./binary');
  const storage = new Uint8Array(200000);
  storage.fill(7, 10000, 90000);
  const value = {
    partial: storage.subarray(10000, 90000),
    blobs: Array.from({ length: 5000 }, (_, i) => Uint8Array.of(i % 256)),
  };
  const packet = encodeWorkerPacket(value, [storage.buffer]);
  expect(packet.buffers.length).toBeLessThanOrEqual(4000);
  expect(packet.buffers[0].buffer.byteLength).toBe(80000);
  expect(packet.buffers[0].buffer).not.toBe(storage.buffer);
  expect(await decodeWorkerData(packet)).toEqual(value);
});
it('does not invoke array getters while measuring or encoding', async () => {
  const { workerDataByteBound } = await import('./binary');
  let calls = 0;
  const array: unknown[] = [];
  Object.defineProperty(array, '0', {
    get() {
      calls++;
      return 1;
    },
    enumerable: true,
  });
  expect(() => workerDataByteBound(array)).toThrow(/accessors/);
  expect(() => encodeWorkerData(array)).toThrow(/accessors/);
  expect(calls).toBe(0);
});

it('decodes large shape/record arrays in bounded packets while preserving nested paths', async () => {
  const { encodeWorkerPacket } = await import('./binary');
  const records = Array.from({ length: 6000 }, (_, i) => ({
    id: i,
    ':name': 'escaped',
    name: String(i),
    when: new Date(i),
    values: Uint8Array.of(i % 256),
    ...Object.fromEntries([['__proto__', 'attribute']]),
  }));
  const input = { records, shapes: [Array.from({ length: 6000 }, (_, i) => [i, -i - 1])] };
  const packet = encodeWorkerPacket(input);
  expect(packet.buffers.length).toBeGreaterThan(1);
  const { packetByteLength } = await import('@mapseekai/tasklane');
  const { workerDataByteBound } = await import('./binary');
  expect(packetByteLength(packet)).toBeLessThanOrEqual(workerDataByteBound(input));
  let yielded = false;
  const timer = setTimeout(() => {
    yielded = true;
  }, 0);
  const result = await decodeWorkerData<typeof input>(packet);
  clearTimeout(timer);
  expect(yielded).toBe(true);
  expect(result).toEqual(input);
  expect(Object.keys(result.records[0])).toEqual(Object.keys(records[0]));
  expect(Object.getPrototypeOf(result.records[0])).toBe(Object.prototype);
});

it('rejects cycles and accessors inside chunked arrays without invoking them', async () => {
  const { encodeWorkerPacket } = await import('./binary');
  const input = new Array(6000).fill(null);
  input[5000] = input;
  expect(() => encodeWorkerPacket(input)).toThrow(/Cyclic/);
  let calls = 0;
  Object.defineProperty(input, '5000', {
    get() {
      calls++;
      return 1;
    },
  });
  expect(() => encodeWorkerPacket(input)).toThrow(/accessors/);
  expect(calls).toBe(0);
});

it('keeps already bounded row batches intact and shares homogeneous record keys', async () => {
  const { encodeWorkerPacket } = await import('./binary');
  const rows = Array.from({ length: 6000 }, (_, i) => ({
    veryLongAttributeName: i,
    otherRepeatedAttributeName: 'x',
  }));
  const bounded = encodeWorkerPacket(rows.slice(0, 4096));
  expect(bounded.buffers).toHaveLength(0);
  const packet = encodeWorkerPacket(rows);
  const bytes = packet.bytes.length + packet.buffers.reduce((n, b) => n + b.length, 0);
  expect(bytes).toBeLessThan(encodeWorkerData(rows).length / 2);
  expect(await decodeWorkerData(packet)).toEqual(rows);
});

it('preserves heterogeneous record schemas, key order and non-finite values', async () => {
  const { encodeWorkerPacket } = await import('./binary');
  const rows = Array.from({ length: 6000 }, (_, i) =>
    i % 2
      ? { constructor: 'attribute', value: NaN, a: Infinity }
      : { a: -Infinity, value: undefined, constructor: 'attribute' },
  );
  const result = await decodeWorkerData<typeof rows>(encodeWorkerPacket(rows));
  expect(result).toEqual(rows);
  expect(Object.keys(result[0])).toEqual(Object.keys(rows[0]));
  expect(Object.keys(result[1])).toEqual(Object.keys(rows[1]));
});

it('retains the legacy representation of holes in large sparse arrays', async () => {
  const { encodeWorkerPacket } = await import('./binary');
  const rows = new Array(5000);
  rows[0] = { name: 'first' };
  rows[4999] = { name: 'last' };
  expect(await decodeWorkerData(encodeWorkerPacket(rows))).toEqual(
    await decodeWorkerData(encodeWorkerData(rows)),
  );
});

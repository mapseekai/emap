import { geometryBatchIds } from './geometry-batches';
import { radixOrder } from './radix-order';
import { normalizePointShape } from '../../../domain/source/layer-utils';
import {
  absArcId,
  type ArcCollection,
  type ArcVertexData,
  type PathShape,
} from '../../../shared/types/mapshaper-types';
import type { Rect } from '../../../integrations/luma/types';
import type { Shapes } from './geometry';
import type { ScreenPathRequest } from './screen-paths';

export interface GeometryInput {
  kind: 'point' | 'path' | 'fill' | 'arrow';
  /** Trusted source/style membership supplied by the formal layer renderer. */
  sourceSelection?: boolean;
  arcs?: ArcCollection;
  shapes?: Shapes;
  ids?: Uint32Array | Int32Array;
  components?: Uint32Array;
  forward?: boolean;
  /** Multicolour icons must preserve feature order even within one paint. */
  ordered?: boolean;
  /** Cache and present the entire layer; batches bound preparation, not spatial coverage. */
  wholeLayer?: boolean;
  /** Raw opaque MSAA strokes alone permit ordering inside one existing preparation job. */
  spatialOrder?: boolean;
  filter?: (id: number) => boolean;
  interval: number;
  bounds: Rect;
  viewBounds?: Rect;
  storageBounds?: Rect;
  screen?: ScreenPathRequest;
  compactStroke?: boolean;
}
export interface GeometryPartition {
  membership: Uint32Array;
  chunks: number;
  bounds?: Float64Array;
  batchIds?: Uint32Array;
}
export interface GeometryJob {
  /** Conservative bounds of a stable source chunk, independent of the viewport. */
  bounds?: Rect;
  chunk: number;
  members: Int32Array;
  components?: Uint32Array;
}
/** Bounded CPU preparation batches; GPU buffers remain independently split. */
export const GEOMETRY_CHUNK_VERTICES = 262144;
export const MAX_GEOMETRY_JOB_VERTICES = 2_000_000;
export const EMPTY_COMPONENT = 0xffffffff;

/** Cooperative main-thread planning; neither source coordinates nor attributes are copied. */
export async function geometryYield(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal.throwIfAborted();
}

function box(): [number, number, number, number] {
  return [Infinity, Infinity, -Infinity, -Infinity];
}
function point(b: number[], x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  b[0] = Math.min(b[0], x);
  b[1] = Math.min(b[1], y);
  b[2] = Math.max(b[2], x);
  b[3] = Math.max(b[3], y);
}
function arcBox(
  arcs: ArcCollection,
  id: number,
  target: number[],
  data: ArcVertexData | undefined,
): number {
  const absolute = absArcId(id);
  if (data?.bb) {
    point(target, data.bb[absolute * 4], data.bb[absolute * 4 + 1]);
    point(target, data.bb[absolute * 4 + 2], data.bb[absolute * 4 + 3]);
    return data.nn[absolute];
  }
  const iter = arcs.getArcIter(absolute);
  let count = 0;
  while (iter.hasNext()) {
    point(target, iter.x, iter.y);
    count++;
  }
  return count;
}
function geometryBounds(
  input: GeometryInput,
  id: number,
  target: number[],
  data: ArcVertexData | undefined,
): number {
  if (input.kind === 'path') return arcBox(input.arcs!, id, target, data);
  const shape = input.shapes![id];
  let cost = 0;
  if (shape && input.kind === 'point')
    for (const p of normalizePointShape(shape)) {
      point(target, p[0], p[1]);
      cost++;
    }
  else if (shape)
    for (const part of shape as PathShape)
      for (const arc of part) cost += arcBox(input.arcs!, arc, target, data);
  return cost;
}
/** Bins and chunk boundaries are derived from ALL source IDs, not the current view.
 * Styles remain separate ordered draw commands; grouping within one uniform paint
 * never moves content across another layer or expression bucket.
 */
export async function partitionGeometry(
  input: GeometryInput,
  signal: AbortSignal,
): Promise<GeometryPartition> {
  const count = input.kind === 'path' ? input.arcs!.size() : input.shapes!.length;
  const data = input.arcs?.getVertexData?.();
  if (count * 4 > 128 * 1024 ** 2)
    throw new RangeError('Spatial partition metadata exceeds the bounded index limit.');
  let slice = performance.now();
  const checkpoint = async () => {
    await geometryYield(signal);
    slice = performance.now();
  };
  const membership = new Uint32Array(count);
  membership.fill(EMPTY_COMPONENT);
  if (input.wholeLayer && !input.ordered) {
    signal.throwIfAborted();
    const costs: number[] = [];
    let chunk = 0,
      vertices = 0,
      size = 0;
    for (let id = 0; id < count; id++) {
      if ((id & 2047) === 0 && performance.now() - slice >= 4) await checkpoint();
      const bounds = box(),
        cost = geometryBounds(input, id, bounds, data);
      if (!bounds.every(Number.isFinite) || (input.kind === 'fill' && cost < 3)) continue;
      if (size && (vertices + cost > GEOMETRY_CHUNK_VERTICES || size >= 8192)) {
        costs.push(vertices);
        chunk++;
        vertices = size = 0;
      }
      membership[id] = chunk;
      vertices += cost;
      size++;
    }
    if (size) costs.push(vertices);
    return {
      membership,
      chunks: costs.length,
      ...(input.kind === 'path' && count >= 100_000 && costs.length >= 64
        ? { batchIds: geometryBatchIds(Uint32Array.from(costs), GEOMETRY_CHUNK_VERTICES * 4) }
        : {}),
    };
  }
  if (input.ordered) {
    for (let i = 0; i < count; i++) {
      if ((i & 8191) === 0 && performance.now() - slice >= 4) await checkpoint();
      membership[i] = Math.floor(i / 4096);
    }
    return { membership, chunks: Math.ceil(count / 4096) };
  }
  const bins: number[][] = Array.from({ length: 256 }, () => []);
  const costs = new Uint32Array(count),
    [x0, y0, x1, y1] = input.bounds;
  for (let id = 0; id < count; id++) {
    if ((id & 2047) === 0 && performance.now() - slice >= 4) await checkpoint();
    const b = box();
    const cost = geometryBounds(input, id, b, data);
    // Fewer than three native vertices cannot form any fill triangle. Keep
    // source features intact; omit only this render-only degenerate job member.
    if (!b.every(Number.isFinite) || (input.kind === 'fill' && cost < 3)) continue;
    const x = Math.max(
      0,
      Math.min(15, Math.floor((((b[0] + b[2]) * 0.5 - x0) / (x1 - x0 || 1)) * 16)),
    );
    const y = Math.max(
      0,
      Math.min(15, Math.floor((((b[1] + b[3]) * 0.5 - y0) / (y1 - y0 || 1)) * 16)),
    );
    const bin = y * 16 + x;
    bins[bin].push(id);
    costs[id] = cost;
  }
  let chunks = 0;
  const chunkBounds: number[] = [];
  const chunkCosts: number[] = [];
  for (let binId = 0; binId < bins.length; binId++) {
    const bin = bins[binId];
    if (!bin.length) continue;
    signal.throwIfAborted();
    let vertices = 0,
      size = 0,
      chunk = chunks,
      tight = box();
    for (const id of bin) {
      if (size && (vertices + costs[id] > GEOMETRY_CHUNK_VERTICES || size >= 8192)) {
        chunkBounds.push(...tight);
        chunkCosts.push(vertices);
        chunk = ++chunks;
        vertices = size = 0;
        tight = box();
      }
      if ((size & 2047) === 0 && performance.now() - slice >= 4) await checkpoint();
      geometryBounds(input, id, tight, data);
      membership[id] = chunk;
      size++;
      vertices += costs[id];
    }
    if (size) {
      chunkBounds.push(...tight);
      chunkCosts.push(vertices);
      chunks++;
    }
  }
  return {
    membership,
    chunks,
    bounds: Float64Array.from(chunkBounds),
    ...(input.kind === 'path' && count >= 100_000 && chunks >= 64
      ? { batchIds: geometryBatchIds(Uint32Array.from(chunkCosts), GEOMETRY_CHUNK_VERTICES * 4) }
      : {}),
  };
}
/** Build only membership lists for this view/filter. Their original IDs are stable
 * across navigation and are part of the exact cache key, including MultiPoint components.
 */
export async function selectGeometryJobs(
  input: GeometryInput,
  partition: GeometryPartition,
  signal: AbortSignal,
): Promise<GeometryJob[]> {
  let slice = performance.now();
  const groups = new Map<number, { members: number[]; components: number[] }>();
  const orderedGroups: { chunk: number; members: number[]; components: number[] }[] = [];
  const seen =
    input.kind === 'path' && input.shapes
      ? new Uint32Array(Math.ceil(input.arcs!.size() / 32))
      : null;
  const add = (signed: number, component = EMPTY_COMPONENT) => {
    const id = input.kind === 'path' ? absArcId(signed) : signed;
    if (seen) {
      const word = id >>> 5,
        bit = 1 << (id & 31);
      if (seen[word] & bit) return;
      seen[word] |= bit;
    }
    if (input.kind === 'path' && input.filter && !input.filter(id)) return;
    const chunk = partition.membership[id];
    if (chunk === undefined || chunk === EMPTY_COMPONENT) return;
    if (partition.bounds && input.viewBounds) {
      const at = chunk * 4,
        b = partition.bounds,
        v = input.viewBounds;
      if (b[at] > v[2] || b[at + 1] > v[3] || b[at + 2] < v[0] || b[at + 3] < v[1]) return;
    }
    let group;
    if (input.ordered) {
      const previous = orderedGroups.at(-1);
      if (previous?.chunk === chunk) group = previous;
      else {
        group = { chunk, members: [], components: [] };
        orderedGroups.push(group);
      }
    } else {
      group = groups.get(chunk);
      if (!group) {
        group = { members: [], components: [] };
        groups.set(chunk, group);
      }
    }
    group.members.push(input.forward && input.kind === 'path' ? id : signed);
    if (input.kind === 'point') group.components.push(component);
  };
  const count = input.ids?.length ?? input.shapes?.length ?? input.arcs!.size();
  let visitedArcs = 0;
  for (let k = 0; k < count; k++) {
    if ((k & 2047) === 0 && performance.now() - slice >= 4) {
      await geometryYield(signal);
      slice = performance.now();
    }
    const id = input.ids?.[k] ?? k;
    if (input.kind === 'path' && input.shapes) {
      for (const part of (input.shapes[id] ?? []) as PathShape)
        for (const arc of part) {
          add(arc);
          if ((++visitedArcs & 2047) === 0 && performance.now() - slice >= 4) {
            await geometryYield(signal);
            slice = performance.now();
          }
        }
    } else add(id, input.components?.[k]);
  }
  if (input.ordered)
    return orderedGroups.map((group) => ({
      chunk: group.chunk,
      members: Int32Array.from(group.members),
      components: Uint32Array.from(group.components),
    }));
  const jobs: GeometryJob[] = [...groups]
    .sort((a, b) => a[0] - b[0])
    .map(([chunk, group]) => ({
      chunk,
      members: Int32Array.from(group.members),
      ...(input.kind === 'point' ? { components: Uint32Array.from(group.components) } : {}),
    }));
  if (!partition.batchIds || input.kind !== 'path') return spatialPathJobs(input, jobs, signal);
  const batched: GeometryJob[] = [];
  for (let i = 0; i < jobs.length; ) {
    const first = i,
      batch = partition.batchIds[jobs[i].chunk];
    let count = 0;
    do {
      count += jobs[i++].members.length;
    } while (i < jobs.length && partition.batchIds[jobs[i].chunk] === batch);
    const members = new Int32Array(count);
    let at = 0;
    for (let j = first; j < i; j++) {
      members.set(jobs[j].members, at);
      at += jobs[j].members.length;
    }
    batched.push({ chunk: batch, members });
  }
  return spatialPathJobs(input, batched, signal);
}
function spread(value: number): number {
  let n = value & 0xffff;
  n = (n | (n << 8)) & 0x00ff00ff;
  n = (n | (n << 4)) & 0x0f0f0f0f;
  n = (n | (n << 2)) & 0x33333333;
  return (n | (n << 1)) & 0x55555555;
}
/** Same-paint coverage is commutative only at the caller's opaque MSAA boundary.
 * Sort derived member IDs, never coordinates, source shapes or preparation groups. */
async function spatialPathJobs(
  input: GeometryInput,
  jobs: GeometryJob[],
  signal: AbortSignal,
): Promise<GeometryJob[]> {
  if (
    !input.spatialOrder ||
    input.kind !== 'path' ||
    !input.wholeLayer ||
    input.ordered ||
    input.screen
  )
    return jobs;
  const data = input.arcs!.getVertexData?.(),
    bounds = box(),
    [x0, y0, x1, y1] = input.bounds;
  let slice = performance.now();
  for (const job of jobs) {
    signal.throwIfAborted();
    const codes = new Uint32Array(job.members.length);
    for (let i = 0; i < codes.length; i++) {
      if ((i & 2047) === 0 && performance.now() - slice >= 4) {
        await geometryYield(signal);
        slice = performance.now();
      }
      bounds[0] = bounds[1] = Infinity;
      bounds[2] = bounds[3] = -Infinity;
      arcBox(input.arcs!, job.members[i], bounds, data);
      const x = Math.max(
          0,
          Math.min(
            65535,
            Math.floor(((bounds[0] / 2 + bounds[2] / 2 - x0) / (x1 - x0 || 1)) * 65535),
          ),
        ),
        y = Math.max(
          0,
          Math.min(
            65535,
            Math.floor(((bounds[1] / 2 + bounds[3] / 2 - y0) / (y1 - y0 || 1)) * 65535),
          ),
        );
      codes[i] = (spread(x) | (spread(y) << 1)) >>> 0;
    }
    const order = radixOrder(codes),
      members = new Int32Array(order.length);
    for (let i = 0; i < order.length; i++) members[i] = job.members[order[i]];
    job.members = members;
  }
  signal.throwIfAborted();
  return jobs;
}
export interface GeometryPacket {
  /** Internal ownership round-trip for reusable source packets; no coordinate copy. */
  recycleInput?: boolean;
  /** Optional conservative source-space coverage for derived GPU fill storage. */
  storageBounds?: Rect;
  /** Exact original feature identity, only for Worker-local tessellation reuse. */
  featureIds?: Int32Array;
  sourceId?: string;
  cacheKey?: string;
  kind: GeometryInput['kind'];
  coordinates: Float64Array;
  offsets: Uint32Array;
  features: Uint32Array;
  screen?: ScreenPathRequest;
  compactStroke?: boolean;
}
/** Copy only one bounded chunk to exact-sized Float64 buffers. Native length
 * admission or exact count/write passes avoid a second graph of JS XY tuples on the UI thread. Native typed arcs
 * can yield inside a long ring without retaining mapshaper's shared mutable iterator.
 */
export async function packGeometryJob(
  input: GeometryInput,
  job: GeometryJob,
  signal: AbortSignal,
): Promise<GeometryPacket> {
  signal.throwIfAborted();
  if (job.members.length > MAX_GEOMETRY_JOB_VERTICES)
    throw new RangeError('Geometry member packet exceeds its bounded limit.');
  const data = input.arcs?.getVertexData?.();
  let lastYield = performance.now();
  const checkpoint = async () => {
    await geometryYield(signal);
    lastYield = performance.now();
  };
  const scan = async (
    coordinates?: Float64Array,
    offsets?: Uint32Array,
    features?: Uint32Array,
  ) => {
    let vertices = 0,
      paths = 0,
      visited = 0;
    let lastX = NaN,
      lastY = NaN;
    const emit = (x: number, y: number, deduplicate: boolean) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || (deduplicate && x === lastX && y === lastY))
        return;
      if (vertices >= MAX_GEOMETRY_JOB_VERTICES)
        throw new RangeError(
          'One geometry exceeds the bounded preparation limit; no source features were omitted.',
        );
      if (coordinates) {
        coordinates[vertices * 2] = x;
        coordinates[vertices * 2 + 1] = y;
      }
      vertices++;
      lastX = x;
      lastY = y;
    };
    const begin = () => {
      if (paths >= MAX_GEOMETRY_JOB_VERTICES)
        throw new RangeError('Geometry path packet exceeds its bounded limit.');
      if (offsets) offsets[paths] = vertices;
      lastX = lastY = NaN;
    };
    // Keep ordinary arc/ring loops synchronous. Only an actual time-slice
    // boundary creates an await, not every one of millions of short rings.
    for (let k = 0; k < job.members.length; k++) {
      if ((k & 127) === 0 && performance.now() - lastYield >= 4) await checkpoint();
      const id = job.members[k];
      if (features) features[k] = paths;
      if (input.kind === 'point') {
        begin();
        const shape = input.shapes![id],
          points = shape ? normalizePointShape(shape) : [];
        const component = job.components?.[k] ?? EMPTY_COMPONENT;
        for (
          let j = component === EMPTY_COMPONENT ? 0 : component,
            end = component === EMPTY_COMPONENT ? points.length : component + 1;
          j < end;
          j++
        ) {
          const p = points[j];
          if (p) emit(p[0], p[1], false);
          if ((++visited & 8191) === 0 && performance.now() - lastYield >= 4) await checkpoint();
        }
        paths++;
        continue;
      }
      const rings = input.kind === 'path' ? null : ((input.shapes![id] ?? []) as PathShape);
      for (let ring = 0; ring < (rings ? rings.length : 1); ring++) {
        begin();
        const ids = rings?.[ring];
        for (let a = 0; a < (ids ? ids.length : 1); a++) {
          const signed = ids ? ids[a] : id;
          if (data) {
            const arc = absArcId(signed),
              start = data.ii[arc],
              length = data.nn[arc];
            const inc = signed < 0 ? -1 : 1;
            const first = signed < 0 ? start + length - 1 : start;
            const stop = signed < 0 ? start - 1 : start + length;
            for (let i = first; i !== stop; i += inc) {
              if (i === first || !data.zz || !input.interval || !(data.zz[i] < input.interval))
                emit(data.xx[i], data.yy[i], true);
              if ((++visited & 8191) === 0 && performance.now() - lastYield >= 4)
                await checkpoint();
            }
          } else {
            const arcs = input.arcs!,
              previous = arcs.getRetainedInterval?.() ?? 0;
            arcs.setRetainedInterval?.(input.interval);
            try {
              const iter = arcs.getArcIter(signed);
              while (iter.hasNext()) emit(iter.x, iter.y, true);
            } finally {
              arcs.setRetainedInterval?.(previous);
            }
            // Custom iterators may be shared: never suspend with one alive.
            if (performance.now() - lastYield >= 4) await checkpoint();
          }
        }
        paths++;
      }
    }
    if (offsets) offsets[paths] = vertices;
    if (features) features[job.members.length] = paths;
    signal.throwIfAborted();
    return { vertices, paths };
  };
  // Native, unsimplified arcs already supply a conservative allocation size.
  // Visit IDs rather than reading every coordinate merely to count it. Retained
  // detail/custom iterators use the exact two-pass path; no raw bound may reject
  // a source whose filtered output still fits the existing limit.
  const reserve = async () => {
    if (!data || input.interval || input.kind === 'point') return null;
    let vertices = 0,
      paths = 0,
      visited = 0,
      members = 0;
    for (let k = 0; k < job.members.length; k++) {
      const id = job.members[k];
      const rings = input.kind === 'path' ? null : ((input.shapes![id] ?? []) as PathShape);
      for (let ring = 0; ring < (rings ? rings.length : 1); ring++) {
        paths++;
        const ids = rings?.[ring];
        for (let a = 0; a < (ids ? ids.length : 1); a++) {
          const length = data.nn[absArcId(ids ? ids[a] : id)];
          if (!Number.isSafeInteger(length) || length < 0)
            throw new Error('Invalid native arc length');
          vertices += length;
          // Bound speculative coordinate storage to 2 MiB. Large jobs keep
          // exact counting, even if deduplication would make their output tiny.
          if (vertices > 131072 || paths > MAX_GEOMETRY_JOB_VERTICES) return null;
          if ((++visited & 2047) === 0 && performance.now() - lastYield >= 4) await checkpoint();
        }
        if (paths > MAX_GEOMETRY_JOB_VERTICES) return null;
        if ((paths & 2047) === 0 && performance.now() - lastYield >= 4) await checkpoint();
      }
      if ((++members & 2047) === 0 && performance.now() - lastYield >= 4) await checkpoint();
    }
    signal.throwIfAborted();
    return { vertices, paths };
  };
  const capacity = await reserve();
  const count = capacity ?? (await scan());
  const coordinates = new Float64Array(count.vertices * 2),
    offsets = new Uint32Array(count.paths + 1),
    features = new Uint32Array(job.members.length + 1);
  const written = await scan(coordinates, offsets, features);
  if (
    (capacity ? written.vertices > count.vertices : written.vertices !== count.vertices) ||
    written.paths !== count.paths
  )
    throw new Error('Geometry changed during bounded preparation');
  return {
    kind: input.kind,
    ...(input.compactStroke ? { compactStroke: true } : {}),
    ...(input.storageBounds ? { storageBounds: input.storageBounds } : {}),
    // Consecutive shared endpoints/non-finite coordinates may leave slack.
    // Transfer exact owned arrays, not views retaining an oversized backing store.
    coordinates:
      written.vertices === count.vertices
        ? coordinates
        : coordinates.slice(0, written.vertices * 2),
    offsets,
    features,
    ...(input.screen ? { screen: input.screen } : {}),
  };
}

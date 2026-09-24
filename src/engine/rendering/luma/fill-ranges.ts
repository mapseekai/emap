import { radixOrder } from './radix-order';
import Flatbush from 'flatbush';
import { groundBounds } from '../../../domain/geo/perspective-transform';
import type { AffineTransform } from '../../../domain/geo/transform';
import type {
  GeometryBuffer,
  FillRangeData,
  FillDrawRange,
} from '../../../integrations/luma/types';

function coordinate(g: GeometryBuffer, id: number, axis: number): number {
  const i = id * 4 + axis;
  return g.vertices[i] + g.vertices[i + 2];
}
function spread(value: number): number {
  let n = value & 0xffff;
  n = (n | (n << 8)) & 0x00ff00ff;
  n = (n | (n << 4)) & 0x0f0f0f0f;
  n = (n | (n << 2)) & 0x33333333;
  return (n | (n << 1)) & 0x55555555;
}
/** Reorder only triangles within ONE uniform paint, never layers/style buckets.
 * All original triangles and indices are retained; bounds include every vertex.
 */
export function spatialFillGeometry(g: GeometryBuffer): GeometryBuffer {
  if (g.kind !== 'fill' || !g.indices || g.count <= 3072) return g;
  const n = g.count / 3;
  if (!Number.isInteger(n)) throw new Error('Fill indices must contain complete triangles');
  const centers = new Float64Array(n * 2);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let t = 0; t < n; t++) {
    let x = 0,
      y = 0;
    for (let j = 0; j < 3; j++) {
      x += coordinate(g, g.indices[t * 3 + j], 0) / 3;
      y += coordinate(g, g.indices[t * 3 + j], 1) / 3;
    }
    centers[t * 2] = x;
    centers[t * 2 + 1] = y;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const codes = new Uint32Array(n);
  for (let t = 0; t < n; t++) {
    const x = Math.max(
      0,
      Math.min(65535, Math.floor(((centers[t * 2] - x0) / (x1 - x0 || 1)) * 65535)),
    );
    const y = Math.max(
      0,
      Math.min(65535, Math.floor(((centers[t * 2 + 1] - y0) / (y1 - y0 || 1)) * 65535)),
    );
    codes[t] = (spread(x) | (spread(y) << 1)) >>> 0;
  }
  const order = radixOrder(codes);
  const indices = new Uint32Array(g.count);
  for (let t = 0; t < n; t++) {
    const source = order[t] * 3,
      target = t * 3;
    indices[target] = g.indices[source];
    indices[target + 1] = g.indices[source + 1];
    indices[target + 2] = g.indices[source + 2];
  }
  return { ...g, indices };
}
/** Source-coordinate range metadata travels with the mesh, not with the camera. */
export function buildFillRanges(g: GeometryBuffer, blockSize = 96): FillRangeData {
  if (g.kind !== 'fill' || !g.indices || g.count % 3 || blockSize <= 0 || blockSize % 3)
    throw new Error('Invalid triangle range input');
  const bounds = new Float64Array(Math.ceil(g.count / blockSize) * 4);
  for (let b = 0; b < bounds.length / 4; b++) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = b * blockSize, end = Math.min(g.count, i + blockSize); i < end; i++) {
      const x = coordinate(g, g.indices[i], 0),
        y = coordinate(g, g.indices[i], 1);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    bounds.set([x0, y0, x1, y1], b * 4);
  }
  return { blockSize, bounds };
}
export interface FillRangeSelection {
  ranges: FillDrawRange[] | null;
  triangles: number;
  rejected: number;
}
export class FillRangeIndex {
  private index: InstanceType<typeof Flatbush> | null = null;
  private extent = [Infinity, Infinity, -Infinity, -Infinity];
  private key = '';
  private selected: FillRangeSelection | null = null;
  readonly bytes: number;
  constructor(
    readonly data: FillRangeData,
    readonly count: number,
  ) {
    const n = Math.ceil(count / data.blockSize);
    if (count % 3 || data.blockSize <= 0 || data.blockSize % 3 || data.bounds.length !== n * 4)
      throw new Error('Invalid triangle range metadata');
    if (n) {
      this.index = new Flatbush(n);
      for (let i = 0; i < n; i++) {
        const [a, b, c, d] = data.bounds.subarray(i * 4, i * 4 + 4);
        if (![a, b, c, d].every(Number.isFinite) || a > c || b > d)
          throw new Error('Invalid triangle bounds');
        this.index.add(a, b, c, d);
        this.extent[0] = Math.min(this.extent[0], a);
        this.extent[1] = Math.min(this.extent[1], b);
        this.extent[2] = Math.max(this.extent[2], c);
        this.extent[3] = Math.max(this.extent[3], d);
      }
      this.index.finish();
    }
    this.bytes = data.bounds.byteLength + (this.index?.data.byteLength ?? 0);
  }
  select(view: AffineTransform, width: number, height: number): FillRangeSelection {
    const box = groundBounds(view, width, height, 2),
      key = box.join(':');
    if (key === this.key && this.selected) return this.selected;
    this.key = key;
    if (
      box[0] <= this.extent[0] &&
      box[1] <= this.extent[1] &&
      box[2] >= this.extent[2] &&
      box[3] >= this.extent[3]
    )
      return (this.selected = { ranges: null, triangles: this.count / 3, rejected: 0 });
    const ids: number[] = this.index?.search(...box) ?? [];
    ids.sort((a, b) => a - b);
    const ranges: FillDrawRange[] = [];
    let indices = 0;
    for (const id of ids) {
      const firstIndex = id * this.data.blockSize,
        indexCount = Math.min(this.data.blockSize, this.count - firstIndex);
      const last = ranges.at(-1);
      if (last && last.firstIndex + last.indexCount === firstIndex) last.indexCount += indexCount;
      else ranges.push({ firstIndex, indexCount });
      indices += indexCount;
    }
    // Keep all false positives rather than issuing unbounded fragmented draws.
    if (ranges.length > 128 || indices > this.count * 0.9)
      return (this.selected = { ranges: null, triangles: this.count / 3, rejected: 0 });
    return (this.selected = {
      ranges,
      triangles: indices / 3,
      rejected: (this.count - indices) / 3,
    });
  }
}

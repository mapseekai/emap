import { groundBounds } from '../../../domain/geo/perspective-transform';
import Flatbush from 'flatbush';
import { AffineTransform } from '../../../domain/geo/transform';
import type { PathDrawRange, PathRangeData, Rect } from '../../../integrations/luma/types';
import type { Point } from './geometry';

/** No geometry writes: each range describes the SAME instances in the existing GPU buffer.
 * Neighbor positions are included for conservative caps/joins, even at a range boundary.
 */
export function buildPathRanges(
  paths: readonly (readonly Point[])[],
  count: number,
  blockSize = 1024,
): PathRangeData {
  const n = Math.ceil(count / blockSize),
    bounds = new Float64Array(n * 4),
    segments = new Uint32Array(n);
  for (let i = 0; i < n; i++) bounds.set([Infinity, Infinity, -Infinity, -Infinity], i * 4);
  let first = 0;
  for (const path of paths) {
    if (path.length < 2) continue;
    const closed =
      path.length > 2 && path[0][0] === path.at(-1)![0] && path[0][1] === path.at(-1)![1];
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i],
        b = path[i + 1];
      if (a[0] === b[0] && a[1] === b[1]) continue; // Already an invalid GPU instance, not a size filter.
      const block = Math.floor((first + i) / blockSize),
        k = block * 4;
      segments[block]++;
      const prev = i ? path[i - 1] : closed ? path[path.length - 2] : a;
      const next = i + 2 < path.length ? path[i + 2] : closed ? path[1] : b;
      bounds[k] = Math.min(bounds[k], prev[0], a[0], b[0], next[0]);
      bounds[k + 1] = Math.min(bounds[k + 1], prev[1], a[1], b[1], next[1]);
      bounds[k + 2] = Math.max(bounds[k + 2], prev[0], a[0], b[0], next[0]);
      bounds[k + 3] = Math.max(bounds[k + 3], prev[1], a[1], b[1], next[1]);
    }
    first += path.length + 2;
  }
  return { blockSize, bounds, segments };
}
export interface PathRangeSelection {
  ranges: PathDrawRange[] | null;
  segments: number;
  rejected: number;
}
export class PathRangeIndex {
  private index: InstanceType<typeof Flatbush> | null = null;
  private extent = [Infinity, Infinity, -Infinity, -Infinity];
  private total = 0;
  private always: number[] = [];
  private previousBounds: Rect | null = null;
  private selected: PathRangeSelection | null = null;
  readonly bytes: number;
  constructor(
    readonly data: PathRangeData,
    private count: number,
  ) {
    const n = data.segments.length;
    this.bytes =
      data.bounds.byteLength + data.segments.byteLength + (data.uncullable?.byteLength ?? 0);
    if (!n) return;
    this.index = new Flatbush(n);
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      if (!data.segments[i]) {
        this.index.add(0, 0, 0, 0);
        continue;
      }
      const a = data.bounds[k],
        b = data.bounds[k + 1],
        c = data.bounds[k + 2],
        d = data.bounds[k + 3];
      this.index.add(a, b, c, d);
      if (data.uncullable?.[i]) this.always.push(i);
      this.total += data.segments[i];
      this.extent[0] = Math.min(this.extent[0], a);
      this.extent[1] = Math.min(this.extent[1], b);
      this.extent[2] = Math.max(this.extent[2], c);
      this.extent[3] = Math.max(this.extent[3], d);
    }
    this.index.finish();
    this.bytes += this.index.data.byteLength + this.always.length * 8;
  }
  select(
    view: AffineTransform,
    width: number,
    height: number,
    padding: number,
  ): PathRangeSelection {
    return this.selectBounds(groundBounds(view, width, height, padding));
  }
  /** A paint scope computes this viewport once for all its immutable meshes. */
  selectBounds(bounds: Rect): PathRangeSelection {
    const last = this.previousBounds;
    if (
      last &&
      this.selected &&
      last[0] === bounds[0] &&
      last[1] === bounds[1] &&
      last[2] === bounds[2] &&
      last[3] === bounds[3]
    )
      return this.selected;
    this.previousBounds = [...bounds];
    const [x0, y0, x1, y1] = bounds;
    // All visible: retain a single draw and avoid traversing all source ranges.
    if (
      x0 <= this.extent[0] &&
      y0 <= this.extent[1] &&
      x1 >= this.extent[2] &&
      y1 >= this.extent[3]
    )
      return (this.selected = { ranges: null, segments: this.total, rejected: 0 });
    const ids: number[] = (this.index?.search(x0, y0, x1, y1) ?? []).filter(
      (id: number) => !this.data.uncullable?.[id],
    );
    ids.push(...this.always);
    ids.sort((a, b) => a - b);
    const ranges: PathDrawRange[] = [];
    let segments = 0;
    for (const id of ids) {
      if (!this.data.segments[id]) continue;
      segments += this.data.segments[id];
      const firstInstance = id * this.data.blockSize,
        end = Math.min(this.count, firstInstance + this.data.blockSize);
      const previous = ranges.at(-1);
      if (previous && previous.firstInstance + previous.count === firstInstance)
        previous.count = end - previous.firstInstance;
      else ranges.push({ firstInstance, count: end - firstInstance });
    }
    // Fragmented selections keep false positives instead of creating thousands of draw calls.
    if (ranges.length > 24 || segments > this.total * 0.8)
      return (this.selected = { ranges: null, segments: this.total, rejected: 0 });
    return (this.selected = { ranges, segments, rejected: this.total - segments });
  }
}

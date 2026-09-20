import type { GeometryBuffer } from '../../../integrations/luma/types';
import type { Point } from './geometry';

/** XY hi/lo, cumulative distance hi/lo, segment flags. Coordinates are stored ONCE.
 * The four neighbor attributes reference the same buffer at different byte offsets.
 * luma v10 expands these logical offsets into portable WebGPU vertex-buffer slots.
 */
export const PATH_STRIDE = 7;
export function pathGeometry(input: Iterable<readonly Point[]>): GeometryBuffer {
  const paths = Array.from(input);
  let capacity = 0;
  for (const p of paths) if (p.length >= 2) capacity += p.length + 2;
  const data = new Float32Array(capacity * PATH_STRIDE);
  let cursor = 0, segments = 0;
  const put = (p: Point, distance: number, flags: number) => {
    const hx = Math.fround(p[0]), hy = Math.fround(p[1]), hd = Math.fround(distance);
    data[cursor++] = hx; data[cursor++] = hy;
    data[cursor++] = p[0]-hx; data[cursor++] = p[1]-hy;
    data[cursor++] = hd; data[cursor++] = distance-hd; data[cursor++] = flags;
  };
  for (const path of paths) {
    if (path.length < 2) continue;
    if (path.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))
      throw new Error('Non-finite path coordinate; geometry was not silently discarded.');
    const n = path.length;
    const closed = n > 2 && path[0][0] === path[n-1][0] && path[0][1] === path[n-1][1];
    put(closed ? path[n-2] : path[0], 0, 4);
    let distance = 0;
    for (let i = 0; i < n; i++) {
      const length = i+1 < n ? Math.hypot(path[i+1][0]-path[i][0], path[i+1][1]-path[i][1]) : 0;
      let flags = i === n-1 || length === 0 ? 4 : 0;
      if (flags !== 4) {
        segments++;
        if (!closed && i === 0) flags += 1;
        if (!closed && i === n-2) flags += 2;
      }
      put(path[i], distance, flags);
      distance += length;
    }
    put(closed ? path[1] : path[n-1], distance, 4);
  }
  return { kind: 'path', vertices: data, count: Math.max(0, cursor/PATH_STRIDE-3), segmentCount: segments };
}

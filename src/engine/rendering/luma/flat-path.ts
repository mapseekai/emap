import type { GeometryBuffer } from '../../../integrations/luma/types';
import { PATH_STRIDE } from './path-geometry';
import { AffineTransform } from '../../../domain/geo/transform';
import {
  validateScreenPathRequest,
  emptyScreenPathStats,
  type ScreenPathRequest,
  type ScreenPathStats,
} from './screen-paths';
/** Already validated flat paths. Keep exactly the legacy neighbor padding,
 * closed-path flags, cumulative dash distances and conservative range bounds. */
export function flatPathGeometry(
  xy: Float64Array,
  offsets: Uint32Array,
  trackMembers = false,
): GeometryBuffer {
  const members: number[] = [];
  let capacity = 0;
  for (let r = 0; r + 1 < offsets.length; r++) {
    const n = offsets[r + 1] - offsets[r];
    if (n >= 2) capacity += n + 2;
  }
  const count = Math.max(0, capacity - 3),
    data = new Float32Array(capacity * PATH_STRIDE),
    blockSize = 1024;
  const bounds = new Float64Array(Math.ceil(count / blockSize) * 4),
    segments = new Uint32Array(bounds.length / 4);
  for (let i = 0; i < segments.length; i++)
    bounds.set([Infinity, Infinity, -Infinity, -Infinity], i * 4);
  let cursor = 0,
    total = 0,
    first = 0;
  const put = (id: number, d: number, flags: number) => {
    const x = xy[id * 2],
      y = xy[id * 2 + 1],
      hx = Math.fround(x),
      hy = Math.fround(y),
      hd = Math.fround(d);
    data[cursor++] = hx;
    data[cursor++] = hy;
    data[cursor++] = x - hx;
    data[cursor++] = y - hy;
    data[cursor++] = hd;
    data[cursor++] = d - hd;
    data[cursor++] = flags;
  };
  for (let r = 0; r + 1 < offsets.length; r++) {
    const a = offsets[r],
      b = offsets[r + 1],
      n = b - a;
    if (n < 2) continue;
    if (trackMembers) members.push(r, first, n - 1);
    const closed = n > 2 && xy[a * 2] === xy[(b - 1) * 2] && xy[a * 2 + 1] === xy[(b - 1) * 2 + 1];
    put(closed ? b - 2 : a, 0, 4);
    let distance = 0;
    for (let j = a; j < b; j++) {
      const length =
        j + 1 < b
          ? Math.hypot(xy[(j + 1) * 2] - xy[j * 2], xy[(j + 1) * 2 + 1] - xy[j * 2 + 1])
          : 0;
      let flags = j === b - 1 || length === 0 ? 4 : 0;
      if (flags !== 4) {
        total++;
        if (!closed && j === a) flags += 1;
        if (!closed && j === b - 2) flags += 2;
        const block = Math.floor((first + j - a) / blockSize),
          k = block * 4;
        segments[block]++;
        const prev = j > a ? j - 1 : closed ? b - 2 : j,
          next = j + 2 < b ? j + 2 : closed ? a + 1 : j + 1;
        bounds[k] = Math.min(bounds[k], xy[prev * 2], xy[j * 2], xy[(j + 1) * 2], xy[next * 2]);
        bounds[k + 1] = Math.min(
          bounds[k + 1],
          xy[prev * 2 + 1],
          xy[j * 2 + 1],
          xy[(j + 1) * 2 + 1],
          xy[next * 2 + 1],
        );
        bounds[k + 2] = Math.max(
          bounds[k + 2],
          xy[prev * 2],
          xy[j * 2],
          xy[(j + 1) * 2],
          xy[next * 2],
        );
        bounds[k + 3] = Math.max(
          bounds[k + 3],
          xy[prev * 2 + 1],
          xy[j * 2 + 1],
          xy[(j + 1) * 2 + 1],
          xy[next * 2 + 1],
        );
      }
      put(j, distance, flags);
      distance += length;
    }
    put(closed ? a + 1 : b - 1, distance, 4);
    first += n + 2;
  }
  return {
    kind: 'path',
    vertices: data,
    count,
    segmentCount: total,
    pathRanges: { blockSize, bounds, segments },
    ...(trackMembers ? { memberRanges: Uint32Array.from(members) } : {}),
  };
}
export function flatPointGeometry(xy: Float64Array): GeometryBuffer {
  const vertices = new Float32Array(xy.length * 2);
  for (let i = 0; i < xy.length; i += 2) {
    const x = xy[i],
      y = xy[i + 1],
      hx = Math.fround(x),
      hy = Math.fround(y),
      k = i * 2;
    vertices[k] = hx;
    vertices[k + 1] = hy;
    vertices[k + 2] = x - hx;
    vertices[k + 3] = y - hy;
  }
  return { kind: 'point', vertices, count: xy.length / 2 };
}
/** Formal affine screen-filter path. No additional x/y copies or retained XY
 * tuples. Unsupported projection/culling policies stay on the reference path. */
export function flatScreenPathGeometry(
  xy: Float64Array,
  offsets: Uint32Array,
  r: ScreenPathRequest,
  trackMembers = false,
): { geometry: GeometryBuffer; screenSpace: boolean; screenStats: ScreenPathStats } {
  validateScreenPathRequest(r);
  if (r.perspective || r.smallArcs || r.cull)
    throw new Error('Flat screen preparation requires preselected affine paths');
  const view = new AffineTransform(
    r.view[0] * r.pixelRatio,
    r.view[1] * r.pixelRatio,
    r.view[2] * r.pixelRatio,
    r.view[3] * r.pixelRatio,
  );
  const positions = new Float64Array(xy.length + (offsets.length - 1) * 2),
    starts = new Uint32Array(offsets.length),
    stats = emptyScreenPathStats();
  const members: number[] = [];
  let n = 0,
    path = 0;
  for (let j = 0; j + 1 < offsets.length; j++) {
    stats.originalArcs++;
    stats.originalVertices += offsets[j + 1] - offsets[j];
    if (offsets[j] === offsets[j + 1]) continue;
    const first = n;
    starts[path++] = n / 2;
    if (trackMembers) members.push(j);
    let lastX = NaN,
      lastY = NaN;
    for (let i = offsets[j]; i < offsets[j + 1]; i++) {
      let [x, y] = view.project(xy[i * 2], xy[i * 2 + 1]);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        (r.halfPixel &&
          (x * 2 < -2147483648 || x * 2 > 2147483647 || y * 2 < -2147483648 || y * 2 > 2147483647))
      )
        return {
          geometry: flatPathGeometry(xy, offsets, trackMembers),
          screenSpace: false,
          screenStats: { ...emptyScreenPathStats(), rawFallbackChunks: 1 },
        };
      if (r.halfPixel) {
        x = ((x * 2) | 0) / 2;
        y = ((y * 2) | 0) / 2;
        if (n > first && x === lastX && y === lastY) {
          stats.duplicateVertices++;
          continue;
        }
      }
      positions[n++] = x / r.pixelRatio;
      positions[n++] = y / r.pixelRatio;
      lastX = x;
      lastY = y;
    }
    if (r.halfPixel && n - first === 2) {
      positions[n++] = (lastX + 0.1) / r.pixelRatio;
      positions[n++] = lastY / r.pixelRatio;
      stats.collapsedArcs++;
    }
  }
  starts[path] = n / 2;
  const geometry = flatPathGeometry(
    positions.subarray(0, n),
    starts.subarray(0, path + 1),
    trackMembers,
  );
  if (geometry.memberRanges)
    for (let i = 0; i < geometry.memberRanges.length; i += 3)
      geometry.memberRanges[i] = members[geometry.memberRanges[i]];
  stats.outputVertices = n / 2;
  stats.outputSegments = geometry.segmentCount ?? 0;
  return { geometry, screenSpace: true, screenStats: stats };
}

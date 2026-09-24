import earcut from 'earcut';
import Flatbush from 'flatbush';
import type { GeometryBuffer } from '../../../integrations/luma/types';
interface Ring {
  start: number;
  end: number;
  area: number;
  bounds: [number, number, number, number];
  parent: number;
  depth: number;
  edges?: InstanceType<typeof Flatbush>;
}
const EMPTY: GeometryBuffer = Object.freeze({
  kind: 'fill',
  vertices: new Float32Array(0),
  indices: new Uint32Array(0),
  count: 0,
});
function contains(r: Ring, x: number, y: number, xy: Float64Array): boolean {
  const n = r.end - r.start;
  const crosses = (i: number) => {
    const a = (r.start + i) * 2,
      b = (i ? r.start + i - 1 : r.end - 1) * 2;
    return (
      xy[a + 1] > y !== xy[b + 1] > y &&
      x < ((xy[b] - xy[a]) * (y - xy[a + 1])) / (xy[b + 1] - xy[a + 1]) + xy[a]
    );
  };
  let inside = false;
  if (n < 128) {
    for (let i = 0; i < n; i++) if (crosses(i)) inside = !inside;
  } else {
    if (!r.edges) {
      const index = new Flatbush(n);
      for (let i = 0; i < n; i++) {
        const a = (r.start + i) * 2,
          b = (i ? r.start + i - 1 : r.end - 1) * 2;
        index.add(
          Math.min(xy[a], xy[b]),
          Math.min(xy[a + 1], xy[b + 1]),
          Math.max(xy[a], xy[b]),
          Math.max(xy[a + 1], xy[b + 1]),
        );
      }
      index.finish();
      r.edges = index;
    }
    for (const i of r.edges.search(x, y, r.bounds[2], y)) if (crosses(i)) inside = !inside;
  }
  return inside;
}
/** Binary rendering boundary. Preserve the native even-odd ring classification,
 * including arbitrary ring order, winding, holes and nested islands. Coordinates
 * remain Float64 until the final hi/lo GPU packing; no per-vertex JS tuples.
 * Inputs are validated once by the bounded packet decoder.
 */
export function flatPolygonGeometry(
  xy: Float64Array,
  offsets: Uint32Array,
  begin = 0,
  end = offsets.length - 1,
): GeometryBuffer {
  const rings: Ring[] = [];
  for (let r = begin; r < end; r++) {
    const start = offsets[r],
      stop = offsets[r + 1];
    if (stop - start < 3) continue;
    const ox = xy[start * 2],
      oy = xy[start * 2 + 1];
    let area = 0;
    const bounds: Ring['bounds'] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = start; i < stop; i++) {
      const a = i * 2,
        b = (i + 1 < stop ? i + 1 : start) * 2,
        x = xy[a],
        y = xy[a + 1];
      area += (x - ox) * (xy[b + 1] - oy) - (xy[b] - ox) * (y - oy);
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
    if (area !== 0 && Number.isFinite(area))
      rings.push({ start, end: stop, area: Math.abs(area), bounds, parent: -1, depth: 0 });
  }
  if (!rings.length) return EMPTY;
  if (rings.length > 1) {
    const spatial = new Flatbush(rings.length);
    for (const r of rings) spatial.add(...r.bounds);
    spatial.finish();
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i],
        x = xy[r.start * 2],
        y = xy[r.start * 2 + 1];
      let area = Infinity;
      for (const j of spatial.search(x, y, x, y)) {
        const o = rings[j];
        if (
          o.area <= r.area ||
          o.area >= area ||
          o.bounds[0] > r.bounds[0] ||
          o.bounds[1] > r.bounds[1] ||
          o.bounds[2] < r.bounds[2] ||
          o.bounds[3] < r.bounds[3]
        )
          continue;
        if (contains(o, x, y, xy)) {
          r.parent = j;
          area = o.area;
        }
      }
    }
    for (const r of rings) for (let p = r.parent; p >= 0; p = rings[p].parent) r.depth++;
  }
  const children: Ring[][] = rings.map(() => []);
  for (const r of rings) if (r.parent >= 0) children[r.parent].push(r);
  const groups: { coordinates: Float64Array; indices: number[] }[] = [];
  let verticesCount = 0,
    indexCount = 0;
  for (let i = 0; i < rings.length; i++) {
    const shell = rings[i];
    if (shell.depth % 2) continue;
    const group = [shell, ...children[i]],
      holes: number[] = [];
    let n = 0,
      contiguous = true,
      last = shell.start;
    for (let j = 0; j < group.length; j++) {
      const r = group[j];
      if (j) holes.push(n);
      if (r.start !== last) contiguous = false;
      n += r.end - r.start;
      last = r.end;
    }
    let coordinates: Float64Array;
    if (contiguous) coordinates = xy.subarray(shell.start * 2, last * 2);
    else {
      coordinates = new Float64Array(n * 2);
      let at = 0;
      for (const r of group) {
        const part = xy.subarray(r.start * 2, r.end * 2);
        coordinates.set(part, at);
        at += part.length;
      }
    }
    const indices = earcut(coordinates, holes, 2);
    groups.push({ coordinates, indices });
    verticesCount += n;
    indexCount += indices.length;
  }
  const vertices = new Float32Array(verticesCount * 4),
    indices = new Uint32Array(indexCount);
  let v = 0,
    t = 0;
  for (const group of groups) {
    const base = v / 4;
    for (const id of group.indices) indices[t++] = base + id;
    for (let i = 0; i < group.coordinates.length; i += 2) {
      const x = group.coordinates[i],
        y = group.coordinates[i + 1],
        hx = Math.fround(x),
        hy = Math.fround(y);
      vertices[v++] = hx;
      vertices[v++] = hy;
      vertices[v++] = x - hx;
      vertices[v++] = y - hy;
    }
  }
  return { kind: 'fill', vertices, indices, count: indices.length };
}

/** Cheap single-ring stream path for large batches of simple buildings. The same
 * earcut indices and Float64 area predicate as the general even-odd renderer;
 * skips spatial ring indexing and avoids constructing a per-feature GPU mesh.
 */
export function flatSingleRingIndices(xy: Float64Array): number[] | null {
  if (xy.length < 6) return null;
  let area = 0;
  const ox = xy[0],
    oy = xy[1];
  for (let i = 0; i < xy.length; i += 2) {
    const j = i + 2 < xy.length ? i + 2 : 0;
    area += (xy[i] - ox) * (xy[j + 1] - oy) - (xy[j] - ox) * (xy[i + 1] - oy);
  }
  return area !== 0 && Number.isFinite(area) ? earcut(xy, [], 2) : null;
}

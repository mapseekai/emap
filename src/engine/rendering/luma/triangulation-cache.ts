import earcut from 'earcut';
import Flatbush from 'flatbush';

type Coordinates = ArrayLike<number>;
type Triangle = readonly [number, number, number, number, number, number];
interface Entry {
  coordinates: Float64Array;
  holes: number[];
  indices: Uint32Array;
  bytes: number;
}

function orientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const p = (bx - ax) * (cy - ay),
    q = (by - ay) * (cx - ax),
    value = p - q;
  const error = (Math.abs(p) + Math.abs(q)) * Number.EPSILON * 16;
  return Math.abs(value) <= error ? 0 : Math.sign(value);
}
function triangle(data: Coordinates, indices: Uint32Array, id: number): Triangle {
  const a = indices[id * 3] * 2,
    b = indices[id * 3 + 1] * 2,
    c = indices[id * 3 + 2] * 2;
  return [data[a], data[a + 1], data[b], data[b + 1], data[c], data[c + 1]];
}
function inside(x: number, y: number, t: Triangle): boolean {
  const a = orientation(t[0], t[1], t[2], t[3], x, y),
    b = orientation(t[2], t[3], t[4], t[5], x, y),
    c = orientation(t[4], t[5], t[0], t[1], x, y);
  return a !== 0 && a === b && a === c;
}
/** Positive-area overlap, not shared edges/vertices of adjacent triangles. */
function overlaps(a: Triangle, b: Triangle): boolean {
  for (let i = 0; i < 3; i++) {
    if (inside(a[i * 2], a[i * 2 + 1], b) || inside(b[i * 2], b[i * 2 + 1], a)) return true;
    const j = (i + 1) % 3;
    for (let k = 0; k < 3; k++) {
      const l = (k + 1) % 3;
      const p = orientation(a[i * 2], a[i * 2 + 1], a[j * 2], a[j * 2 + 1], b[k * 2], b[k * 2 + 1]);
      const q = orientation(a[i * 2], a[i * 2 + 1], a[j * 2], a[j * 2 + 1], b[l * 2], b[l * 2 + 1]);
      const r = orientation(b[k * 2], b[k * 2 + 1], b[l * 2], b[l * 2 + 1], a[i * 2], a[i * 2 + 1]);
      const s = orientation(b[k * 2], b[k * 2 + 1], b[l * 2], b[l * 2 + 1], a[j * 2], a[j * 2 + 1]);
      if (p * q < 0 && r * s < 0) return true;
    }
  }
  // Also detect coincident or contained triangles with vertices on shared boundaries.
  return (
    inside((a[0] + a[2] + a[4]) / 3, (a[1] + a[3] + a[5]) / 3, b) ||
    inside((b[0] + b[2] + b[4]) / 3, (b[1] + b[3] + b[5]) / 3, a)
  );
}

/** Reuse connectivity only when the moved triangles still form a valid mesh.
 * Orientation alone is insufficient around holes: test their new footprint against
 * every potentially overlapping unchanged triangle and against other moved triangles.
 * Ignored collinear vertices, topology/size changes and ambiguous degeneracy retriangulate.
 */
function canReuse(entry: Entry, next: Coordinates, changed: Set<number>): boolean {
  if (!changed.size) return true;
  if (changed.size > 64 || !entry.indices.length) return false;
  const affected: number[] = [],
    used = new Set<number>(),
    indices = entry.indices;
  for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) if (changed.has(indices[i + j])) used.add(indices[i + j]);
    if (changed.has(indices[i]) || changed.has(indices[i + 1]) || changed.has(indices[i + 2]))
      affected.push(i / 3);
  }
  if (!affected.length || affected.length > 1024) return false;
  for (const vertex of changed)
    if (!used.has(vertex)) {
      // Ring closure/junction duplicates are legitimate; a moved unique vertex
      // previously removed by earcut's collinear filtering is NOT reusable.
      const i = vertex * 2;
      if (
        ![...used].some(
          (v) =>
            entry.coordinates[v * 2] === entry.coordinates[i] &&
            entry.coordinates[v * 2 + 1] === entry.coordinates[i + 1] &&
            next[v * 2] === next[i] &&
            next[v * 2 + 1] === next[i + 1],
        )
      )
        return false;
    }
  for (const id of affected) {
    const old = triangle(entry.coordinates, indices, id),
      now = triangle(next, indices, id);
    const before = orientation(...old),
      after = orientation(...now);
    if (!before || before !== after) return false;
  }
  // Temporary index: bounded by the cached index count, not retained after editing.
  const spatial = new Flatbush(indices.length / 3);
  for (let id = 0; id < indices.length / 3; id++) {
    const t = triangle(entry.coordinates, indices, id);
    spatial.add(
      Math.min(t[0], t[2], t[4]),
      Math.min(t[1], t[3], t[5]),
      Math.max(t[0], t[2], t[4]),
      Math.max(t[1], t[3], t[5]),
    );
  }
  spatial.finish();
  const moving = new Set(affected);
  let tests = 0;
  for (let i = 0; i < affected.length; i++) {
    const id = affected[i],
      a = triangle(next, indices, id);
    const candidates = spatial.search(
      Math.min(a[0], a[2], a[4]),
      Math.min(a[1], a[3], a[5]),
      Math.max(a[0], a[2], a[4]),
      Math.max(a[1], a[3], a[5]),
    );
    for (const other of candidates) {
      if (moving.has(other)) continue;
      if (++tests > 200000 || overlaps(a, triangle(next, indices, other))) return false;
    }
    for (let j = 0; j < i; j++)
      if (++tests > 200000 || overlaps(a, triangle(next, indices, affected[j]))) return false;
  }
  return true;
}

/** Worker-owned bounded cache. The caller copies indices into its transfer packet,
 * so transferring a display mesh never detaches the cached triangulation.
 * This changes no source coordinates and never approximates polygon boundaries.
 */
export class TriangulationCache {
  private entries = new Map<string, Entry>();
  readonly stats = {
    timeMs: 0,
    bytes: 0,
    hits: 0,
    localUpdates: 0,
    retriangulations: 0,
    misses: 0,
    evictions: 0,
  };
  constructor(private readonly budget = 128 * 1024 ** 2) {}
  triangulate(key: string, coordinates: readonly number[], holes: readonly number[]): Uint32Array {
    const started = performance.now();
    try {
      return this.compute(key, coordinates, holes);
    } finally {
      this.stats.timeMs += performance.now() - started;
    }
  }
  private compute(
    key: string,
    coordinates: readonly number[],
    holes: readonly number[],
  ): Uint32Array {
    const old = this.entries.get(key);
    if (
      old &&
      old.coordinates.length === coordinates.length &&
      old.holes.length === holes.length &&
      old.holes.every((v, i) => v === holes[i])
    ) {
      const changed = new Set<number>();
      for (let i = 0; i < coordinates.length; i += 2)
        if (old.coordinates[i] !== coordinates[i] || old.coordinates[i + 1] !== coordinates[i + 1])
          changed.add(i / 2);
      if (!changed.size || canReuse(old, coordinates, changed)) {
        old.coordinates.set(coordinates);
        this.entries.delete(key);
        this.entries.set(key, old);
        if (changed.size) this.stats.localUpdates++;
        else this.stats.hits++;
        return old.indices;
      }
    }
    if (old) {
      this.stats.retriangulations++;
      this.stats.bytes -= old.bytes;
      this.entries.delete(key);
    } else this.stats.misses++;
    const indices = Uint32Array.from(earcut(coordinates as number[], holes as number[]));
    const bytes = coordinates.length * 8 + indices.byteLength + holes.length * 8;
    if (bytes <= this.budget) {
      while (this.stats.bytes + bytes > this.budget && this.entries.size) {
        const [first, entry] = this.entries.entries().next().value!;
        this.entries.delete(first);
        this.stats.bytes -= entry.bytes;
        this.stats.evictions++;
      }
      this.entries.set(key, {
        coordinates: Float64Array.from(coordinates),
        holes: [...holes],
        indices,
        bytes,
      });
      this.stats.bytes += bytes;
    }
    return indices;
  }
  clear(): void {
    this.entries.clear();
    this.stats.bytes = 0;
  }
}

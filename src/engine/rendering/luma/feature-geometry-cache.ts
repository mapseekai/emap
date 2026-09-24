import type { GeometryBuffer } from '../../../integrations/luma/types';
interface Bucket {
  source: string;
  namespace: string;
  entries: Map<number, Entry>;
}
interface Entry {
  bucket: Bucket;
  id: number;
  coordinates: Float64Array;
  offsets: Uint32Array;
  geometry: GeometryBuffer;
  bytes: number;
  previous: Entry | null;
  next: Entry | null;
}
function equal(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
/** Worker-owned exact tessellations. Numeric feature lookup and intrusive LRU
 * avoid per-feature JSON keys and repeatedly scanning deleted Map slots to evict.
 * Cached buffers are never transferred; coordinate/ring checks remain exact.
 */
export class FeatureGeometryCache {
  private sources = new Map<string, Map<string, Bucket>>();
  private oldest: Entry | null = null;
  private newest: Entry | null = null;
  readonly stats = { bytes: 0, entries: 0, hits: 0, misses: 0, evictions: 0 };
  constructor(
    private readonly limit = 64 * 1024 ** 2,
    private readonly maxEntries = 20_000,
  ) {}
  get(
    source: string,
    namespace: string,
    id: number,
    coordinates: Float64Array,
    offsets: Uint32Array,
    build: () => GeometryBuffer,
  ): GeometryBuffer {
    const old = this.sources.get(source)?.get(namespace)?.entries.get(id);
    if (old && equal(old.coordinates, coordinates) && equal(old.offsets, offsets)) {
      this.touch(old);
      this.stats.hits++;
      return old.geometry;
    }
    if (old) this.drop(old);
    this.stats.misses++;
    const geometry = build();
    if (!geometry.count) return geometry;
    // Conservative metadata charge, including shared bucket keys; limits are not raised.
    const bytes =
      coordinates.byteLength +
      offsets.byteLength +
      geometry.vertices.byteLength +
      (geometry.indices?.byteLength ?? 0) +
      (source.length + namespace.length) * 2 +
      256;
    if (bytes > this.limit || this.maxEntries <= 0) return geometry;
    while (this.stats.bytes + bytes > this.limit || this.stats.entries >= this.maxEntries) {
      this.drop(this.oldest!);
      this.stats.evictions++;
    }
    let namespaces = this.sources.get(source);
    if (!namespaces) this.sources.set(source, (namespaces = new Map()));
    let bucket = namespaces.get(namespace);
    if (!bucket) namespaces.set(namespace, (bucket = { source, namespace, entries: new Map() }));
    const entry: Entry = {
      bucket,
      id,
      coordinates: coordinates.slice(),
      offsets: offsets.slice(),
      geometry,
      bytes,
      previous: null,
      next: null,
    };
    bucket.entries.set(id, entry);
    this.append(entry);
    this.stats.bytes += bytes;
    this.stats.entries++;
    return geometry;
  }
  retain(sources: ReadonlySet<string>): void {
    for (const [source, namespaces] of this.sources) {
      if (sources.has(source)) continue;
      for (const bucket of namespaces.values())
        for (const entry of bucket.entries.values()) this.drop(entry);
    }
  }
  clear(): void {
    this.sources.clear();
    this.oldest = this.newest = null;
    this.stats.bytes = this.stats.entries = 0;
  }
  private append(entry: Entry): void {
    entry.previous = this.newest;
    entry.next = null;
    if (this.newest) this.newest.next = entry;
    else this.oldest = entry;
    this.newest = entry;
  }
  private unlink(entry: Entry): void {
    if (entry.previous) entry.previous.next = entry.next;
    else this.oldest = entry.next;
    if (entry.next) entry.next.previous = entry.previous;
    else this.newest = entry.previous;
    entry.previous = entry.next = null;
  }
  private touch(entry: Entry): void {
    if (this.newest === entry) return;
    this.unlink(entry);
    this.append(entry);
  }
  private drop(entry: Entry): void {
    this.unlink(entry);
    const bucket = entry.bucket;
    bucket.entries.delete(entry.id);
    if (!bucket.entries.size) {
      const namespaces = this.sources.get(bucket.source)!;
      namespaces.delete(bucket.namespace);
      if (!namespaces.size) this.sources.delete(bucket.source);
    }
    this.stats.bytes -= entry.bytes;
    this.stats.entries--;
  }
}

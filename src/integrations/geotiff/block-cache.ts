import { GeoTIFFImage } from 'geotiff';

/** All IFDs/overviews in one source share a small, explicitly bounded cache. */
export class RasterBlockCache {
  private readonly entries = new Map<string, ArrayBufferLike>();
  private retainedBytes = 0;
  private closed = false;
  private hits = 0;
  private misses = 0;
  private loadMs = 0;
  private evictions = 0;
  private evictedBytes = 0;
  private admittedBytes = 0;
  private oversizeSkips = 0;
  private peakBytes = 0;
  private peakEntries = 0;
  constructor(private readonly limit = 8 * 1024 ** 2) {}
  getDiagnostics() {
    return {
      hits: this.hits,
      misses: this.misses,
      loadMs: this.loadMs,
      evictions: this.evictions,
      evictedBytes: this.evictedBytes,
      admittedBytes: this.admittedBytes,
      oversizeSkips: this.oversizeSkips,
      bytes: this.retainedBytes,
      peakBytes: this.peakBytes,
      entries: this.entries.size,
      peakEntries: this.peakEntries,
      limitBytes: this.limit,
    };
  }
  get bytes(): number {
    return this.retainedBytes;
  }
  get size(): number {
    return this.entries.size;
  }
  get(key: string): ArrayBufferLike | undefined {
    const data = this.entries.get(key);
    if (data) {
      this.hits++;
      this.entries.delete(key);
      this.entries.set(key, data);
    }
    if (!data) this.misses++;
    return data;
  }
  addLoadMs(ms: number): void {
    this.loadMs += ms;
  }
  set(key: string, data: ArrayBufferLike): void {
    if (this.closed) return;
    if (data.byteLength > this.limit) {
      this.oversizeSkips++;
      return;
    }
    const previous = this.entries.get(key);
    if (previous) {
      this.retainedBytes -= previous.byteLength;
      this.entries.delete(key);
    }
    this.entries.set(key, data);
    this.retainedBytes += data.byteLength;
    this.admittedBytes += data.byteLength;
    while (this.retainedBytes > this.limit || this.entries.size > 4096) {
      const oldest = this.entries.keys().next().value!;
      const evicted = this.entries.get(oldest)!.byteLength;
      this.retainedBytes -= evicted;
      this.evictedBytes += evicted;
      this.entries.delete(oldest);
      this.evictions++;
    }
    this.peakBytes = Math.max(this.peakBytes, this.retainedBytes);
    this.peakEntries = Math.max(this.peakEntries, this.entries.size);
  }
  dispose(): void {
    this.closed = true;
    this.entries.clear();
    this.retainedBytes = 0;
  }
}

type ImageArguments = ConstructorParameters<typeof GeoTIFFImage>;
/** The upstream cache checks *after* source.fetch and retains promises indefinitely.
 * Check before source I/O instead, retaining only successfully decoded buffers.
 */
export class CachedGeoTIFFImage extends GeoTIFFImage {
  constructor(
    directory: ImageArguments[0],
    littleEndian: boolean,
    source: ImageArguments[3],
    private readonly cache: RasterBlockCache,
    private readonly id: number,
  ) {
    super(directory, littleEndian, false, source);
  }
  override async getTileOrStrip(
    ...args: Parameters<GeoTIFFImage['getTileOrStrip']>
  ): ReturnType<GeoTIFFImage['getTileOrStrip']> {
    const [x, y, sample, , signal] = args;
    signal?.throwIfAborted();
    const key = `${this.id}:${x}:${y}:${this.planarConfiguration === 1 ? 0 : sample}`;
    const cached = this.cache.get(key);
    if (cached) return { x, y, sample, data: cached };
    const started = performance.now();
    const result = await super.getTileOrStrip(...args);
    this.cache.addLoadMs(performance.now() - started);
    signal?.throwIfAborted();
    this.cache.set(key, result.data);
    return result;
  }
}

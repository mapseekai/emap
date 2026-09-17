import { GeoTIFFImage } from 'geotiff';

/** All IFDs/overviews in one source share a small, explicitly bounded cache. */
export class RasterBlockCache {
  private readonly entries = new Map<string, ArrayBufferLike>();
  private retainedBytes = 0;
  private closed = false;
  private hits = 0;
  private misses = 0;
  private loadMs = 0;
  constructor(private readonly limit = 8 * 1024 ** 2) {}
  getDiagnostics(): { hits: number; misses: number; loadMs: number } {
    return { hits: this.hits, misses: this.misses, loadMs: this.loadMs };
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
    if (this.closed || data.byteLength > this.limit) return;
    const previous = this.entries.get(key);
    if (previous) {
      this.retainedBytes -= previous.byteLength;
      this.entries.delete(key);
    }
    this.entries.set(key, data);
    this.retainedBytes += data.byteLength;
    while (this.retainedBytes > this.limit || this.entries.size > 4096) {
      const oldest = this.entries.keys().next().value!;
      this.retainedBytes -= this.entries.get(oldest)!.byteLength;
      this.entries.delete(oldest);
    }
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

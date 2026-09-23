import { iconMetrics, type IconOptions } from '../../map/icon';
export interface IconAsset {
  image: CanvasImageSource;
  width: number;
  height: number;
  bytes: number;
  close(): void;
}
export interface PointIcon extends ReturnType<typeof iconMetrics> {
  asset: IconAsset;
  /** Straight RGBA; alpha includes icon.opacity and the optional tint alpha. */
  color: [number, number, number, number];
  tint?: string;
}
const MAX_BYTES = 32 * 1024 ** 2,
  MAX_IMAGES = 32,
  MAX_FILE_BYTES = 8 * 1024 ** 2;
/** Decode SVG as an image, never insert untrusted markup in the document. */
export async function loadIconImage(url: string, signal: AbortSignal): Promise<IconAsset> {
  const response = await fetch(url, { signal, mode: 'cors', credentials: 'same-origin' });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Icon request failed (HTTP ${response.status}).`);
  }
  if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) {
    await response.body?.cancel();
    throw new Error('Icon file exceeds 8 MiB.');
  }
  if (!response.body) throw new Error('Icon response has no body.');
  const reader = response.body.getReader(),
    chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      signal.throwIfAborted();
      bytes += item.value.byteLength;
      if (bytes > MAX_FILE_BYTES) throw new Error('Icon file exceeds 8 MiB.');
      chunks.push(item.value as Uint8Array<ArrayBuffer>);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const blob = new Blob(chunks, {
    type: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
  });
  const objectUrl = URL.createObjectURL(blob),
    image = new Image();
  let bitmap: ImageBitmap | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        image.onload = image.onerror = null;
        signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const abort = () => {
        image.src = '';
        done(new DOMException('Icon load cancelled', 'AbortError'));
      };
      image.onload = () => done();
      image.onerror = () =>
        done(
          new Error('Image cannot be decoded (PNG, JPEG, WebP or self-contained SVG required).'),
        );
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else image.src = objectUrl;
    });
    signal.throwIfAborted();
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width > 4096 || height > 4096 || width * height * 4 > MAX_BYTES)
      throw new Error('Icon image exceeds dimension/memory limits.');
    bitmap = await createImageBitmap(image, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    signal.throwIfAborted();
    const value = bitmap;
    bitmap = undefined;
    return { image: value, width, height, bytes: width * height * 4, close: () => value.close() };
  } finally {
    bitmap?.close();
    image.src = '';
    URL.revokeObjectURL(objectUrl);
  }
}
type Entry = {
  url: string;
  controller: AbortController;
  state: 'queued' | 'loading' | 'ready' | 'failed';
  asset?: IconAsset;
  error?: string;
};
/** Per-map, reference-retained image cache. Camera/style changes do not re-fetch images. */
export class PointIconImages {
  private entries = new Map<string, Entry>();
  private symbols = new Map<string, PointIcon>();
  private optionSymbols = new WeakMap<
    IconOptions,
    { asset: IconAsset; symbol: PointIcon | null }
  >();
  private urls = new Map<string, string>();
  private symbolErrors = new Map<string, string>();
  private jobs = new Set<Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private parser: CanvasRenderingContext2D | null = null;
  private bytes = 0;
  private loads = 0;
  constructor(
    private invalidate: () => void,
    private release: (asset: IconAsset) => void = () => {},
    private report: (url: string, error: Error) => void = () => {},
    private loader = loadIconImage,
  ) {}
  private resolve(url: string): string {
    const old = this.urls.get(url);
    if (old) return old;
    const u = new URL(url, globalThis.document?.baseURI ?? 'http://localhost/');
    if (u.username || u.password) throw new Error('Icon URLs must not contain credentials.');
    if (this.urls.size >= 64) this.urls.clear();
    this.urls.set(url, u.href);
    return u.href;
  }
  get stats() {
    return {
      pending: [...this.entries.values()].filter(
        (e) => e.state === 'queued' || e.state === 'loading',
      ).length,
      images: [...this.entries.values()].filter((e) => e.asset).length,
      imageBytes: this.bytes,
      loads: this.loads,
      errors: [...this.entries.values()]
        .flatMap((e) => (e.error ? [e.error] : []))
        .concat([...this.symbolErrors.values()])
        .slice(0, 32),
    };
  }
  retain(options: readonly IconOptions[]): void {
    if (this.disposed) return;
    const desired = new Set(
      options.filter((o) => o.enabled !== false).map((o) => this.resolve(o.url)),
    );
    for (const [url, entry] of this.entries)
      if (!desired.has(url)) {
        this.drop(entry);
        this.entries.delete(url);
      }
    for (const url of desired) {
      if (this.entries.has(url)) continue;
      const entry: Entry = { url, controller: new AbortController(), state: 'queued' };
      this.entries.set(url, entry);
      if (this.entries.size > MAX_IMAGES) {
        entry.state = 'failed';
        entry.error = 'Icon cache allows at most 32 distinct active images.';
      }
    }
    if (this.symbols.size > 128) this.symbols.clear();
    if (!this.timer && [...this.entries.values()].some((e) => e.state === 'queued'))
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, 0);
  }
  private pump(): void {
    if (this.disposed) return;
    for (const entry of this.entries.values()) {
      if (this.jobs.size >= 4) break;
      if (entry.state !== 'queued') continue;
      entry.state = 'loading';
      this.loads++;
      const task = this.loader(entry.url, entry.controller.signal)
        .then((asset) => {
          if (
            this.disposed ||
            entry.controller.signal.aborted ||
            this.entries.get(entry.url) !== entry
          ) {
            asset.close();
            return;
          }
          if (asset.bytes + this.bytes > MAX_BYTES) {
            asset.close();
            throw new Error('Active icon images exceed the 32 MiB cache budget.');
          }
          entry.asset = asset;
          entry.state = 'ready';
          this.bytes += asset.bytes;
          this.invalidate();
        })
        .catch((error) => {
          if (
            entry.controller.signal.aborted ||
            this.disposed ||
            this.entries.get(entry.url) !== entry
          )
            return;
          entry.state = 'failed';
          entry.error = error instanceof Error ? error.message : String(error);
          this.report(entry.url, new Error(entry.error));
          this.invalidate();
        })
        .finally(() => {
          this.jobs.delete(task);
          this.pump();
        });
      this.jobs.add(task);
    }
  }
  get(options: IconOptions | undefined): PointIcon | null {
    if (!options || options.enabled === false) return null;
    const entry = this.entries.get(this.resolve(options.url));
    if (!entry?.asset) return null;
    const memo = this.optionSymbols.get(options);
    if (memo?.asset === entry.asset) return memo.symbol;
    const key = JSON.stringify(options),
      old = this.symbols.get(key);
    if (old?.asset === entry.asset) {
      this.optionSymbols.set(options, { asset: entry.asset, symbol: old });
      return old;
    }
    if (this.symbolErrors.has(key)) return null;
    try {
      const metrics = iconMetrics(options, entry.asset.width, entry.asset.height);
      let color: PointIcon['color'] = [1, 1, 1, options.opacity ?? 1];
      if (options.tint) {
        if (globalThis.CSS?.supports && !CSS.supports('color', options.tint))
          throw new Error('Invalid icon tint color.');
        if (!this.parser) {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          this.parser = canvas.getContext('2d', { willReadFrequently: true });
        }
        if (!this.parser) throw new Error('Icon color parser is unavailable.');
        const ctx = this.parser;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = options.tint;
        ctx.fillRect(0, 0, 1, 1);
        const c = ctx.getImageData(0, 0, 1, 1).data;
        color = [c[0] / 255, c[1] / 255, c[2] / 255, (c[3] / 255) * (options.opacity ?? 1)];
      }
      const result = { ...metrics, asset: entry.asset, color, tint: options.tint };
      if (this.symbols.size >= 128) this.symbols.delete(this.symbols.keys().next().value!);
      this.symbols.set(key, result);
      this.optionSymbols.set(options, { asset: entry.asset, symbol: result });
      return result;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (this.symbolErrors.size >= 32) this.symbolErrors.clear();
      this.symbolErrors.set(key, error.message);
      this.optionSymbols.set(options, { asset: entry.asset, symbol: null });
      queueMicrotask(() => {
        if (!this.disposed) {
          this.report(entry.url, error);
          this.invalidate();
        }
      });
      return null;
    }
  }
  retry(): void {
    for (const [url, entry] of this.entries) if (entry.state === 'failed') this.entries.delete(url);
    this.symbolErrors.clear();
    this.optionSymbols = new WeakMap();
  }
  async settled(): Promise<void> {
    while (this.timer || this.jobs.size) {
      if (this.timer) await new Promise((r) => setTimeout(r, 1));
      await Promise.all([...this.jobs]);
    }
  }
  private drop(entry: Entry): void {
    entry.controller.abort();
    if (entry.asset) {
      this.release(entry.asset);
      entry.asset.close();
      this.bytes -= entry.asset.bytes;
      for (const [key, s] of this.symbols) if (s.asset === entry.asset) this.symbols.delete(key);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const e of this.entries.values()) this.drop(e);
    this.entries.clear();
    this.symbols.clear();
    this.symbolErrors.clear();
    this.urls.clear();
    this.optionSymbols = new WeakMap();
    if (this.parser) this.parser.canvas.width = this.parser.canvas.height = 0;
    this.parser = null;
  }
}

import type {
  ShapeRequest,
  ShapedText,
  GlyphRequest,
  GeneratedGlyph,
  MsdfRequest,
  MsdfResponse,
  WorkerStats,
} from './protocol';

/** One worker per active label manager. There is no module-global font/heap ownership. */
export class MsdfClient {
  private worker: Worker | null = null;
  private serial = 0;
  private pending = new Map<
    number,
    {
      reject: (error: Error) => void;
      cleanup: () => void;
      resolve: (result: ShapedText[] | GeneratedGlyph[]) => void;
    }
  >();
  stats: WorkerStats = { fontBytes: 0, fonts: 0, glyphsGenerated: 0, shapedRuns: 0, heapBytes: 0 };
  constructor(private readonly url: URL) {}
  private ensure(): Worker {
    if (!this.worker) {
      const worker = new Worker(this.url, { name: 'emap-msdf-fonts' });
      this.worker = worker;
      worker.onmessage = ({ data }: MessageEvent<MsdfResponse>) => {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        this.pending.delete(data.id);
        pending.cleanup();
        if (data.stats) this.stats = data.stats;
        if (data.error) {
          const error = new Error(data.error);
          pending.reject(error);
          this.clear(error);
        } else pending.resolve(data.result ?? []);
      };
      worker.onerror = (event) => this.clear(new Error(`MSDF worker failed: ${event.message}`));
      worker.onmessageerror = () => this.clear(new Error('Invalid MSDF worker response.'));
    }
    return this.worker;
  }
  shape(requests: ShapeRequest[], signal: AbortSignal): Promise<ShapedText[]> {
    return this.request('shape', requests, signal) as Promise<ShapedText[]>;
  }
  glyphs(requests: GlyphRequest[], signal: AbortSignal): Promise<GeneratedGlyph[]> {
    return this.request('glyphs', requests, signal) as Promise<GeneratedGlyph[]>;
  }
  private request(
    type: 'shape' | 'glyphs',
    requests: ShapeRequest[] | GlyphRequest[],
    signal: AbortSignal,
  ): Promise<ShapedText[] | GeneratedGlyph[]> {
    signal.throwIfAborted();
    const worker = this.ensure(),
      id = ++this.serial;
    return new Promise((resolve, reject) => {
      const abort = () => {
        worker.postMessage({ id, type: 'cancel' } satisfies MsdfRequest);
        this.pending.delete(id);
        cleanup();
        reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
      };
      const timer = setTimeout(
        () => this.clear(new Error('MSDF font worker timed out. Check font resources.')),
        90000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal.addEventListener('abort', abort, { once: true });
      try {
        worker.postMessage({ id, type, requests });
      } catch (e) {
        this.pending.delete(id);
        cleanup();
        reject(e);
      }
    });
  }
  clear(error: Error = new DOMException('MSDF worker released', 'AbortError')): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) {
      p.cleanup();
      p.reject(error);
    }
    this.pending.clear();
    this.stats = { fontBytes: 0, fonts: 0, glyphsGenerated: 0, shapedRuns: 0, heapBytes: 0 };
  }
}

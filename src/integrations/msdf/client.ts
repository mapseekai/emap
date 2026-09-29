import { packetByteLength, type WorkerRuntime, type WorkerSession } from '@mapseekai/tasklane';
import {
  SessionOwner,
  taskValue,
  workerError,
  reportWorkerCleanupFailure,
  MIB,
} from '../tasklane/runtime';
import type {
  ShapeRequest,
  ShapedText,
  GlyphRequest,
  GeneratedGlyph,
  WorkerStats,
} from './protocol';

/** Session affinity preserves font handles and WASM heap ownership. */
export class MsdfClient {
  private readonly owner: SessionOwner;
  stats: WorkerStats = { fontBytes: 0, fonts: 0, glyphsGenerated: 0, shapedRuns: 0, heapBytes: 0 };
  constructor(url: URL, runtime?: WorkerRuntime) {
    this.owner = new SessionOwner('msdf', url, runtime);
  }
  shape(requests: ShapeRequest[], signal: AbortSignal): Promise<ShapedText[]> {
    return this.request('shape', requests, signal) as Promise<ShapedText[]>;
  }
  glyphs(requests: GlyphRequest[], signal: AbortSignal): Promise<GeneratedGlyph[]> {
    return this.request('glyphs', requests, signal) as Promise<GeneratedGlyph[]>;
  }
  private async request(
    type: 'shape' | 'glyphs',
    requests: ShapeRequest[] | GlyphRequest[],
    signal: AbortSignal,
  ): Promise<ShapedText[] | GeneratedGlyph[]> {
    signal.throwIfAborted();
    let session: WorkerSession | undefined;
    try {
      session = this.owner.session;
      const handle = session.enqueue('msdf', {
        budget: {
          inputBytes: packetByteLength({ type, requests }),
          scratchBytes: 256 * MIB,
          outputBytes: 64 * MIB,
        },
        signal,
        cancellation: 'cooperative',
        priority: 'interactive',
        executionTimeoutMs: 90_000,
        prepare: () => ({ payload: { type, requests } }),
      });
      return await taskValue(handle, (value) => {
        signal.throwIfAborted();
        if (!session || !this.owner.owns(session))
          throw new DOMException('MSDF generation released', 'AbortError');
        this.stats = value.stats;
        return value.result;
      });
    } catch (error) {
      if (!signal.aborted && session && this.owner.owns(session)) this.clear();
      throw workerError(error);
    }
  }
  get closed(): Promise<void> {
    return this.owner.closed;
  }
  clear(_error: Error = new DOMException('MSDF worker released', 'AbortError')): void {
    void this.owner.close().catch(reportWorkerCleanupFailure);
    this.stats = { fontBytes: 0, fonts: 0, glyphsGenerated: 0, shapedRuns: 0, heapBytes: 0 };
  }
}

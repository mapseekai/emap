import { RasterError } from '../../domain/raster/policy';
import type {
  GeoTIFFWorkerCommand,
  GeoTIFFWorkerRequest,
  GeoTIFFWorkerResponse,
} from './worker-protocol';

interface Pending {
  id: number;
  resolve?: (message: GeoTIFFWorkerResponse) => void;
  reject?: (error: unknown) => void;
  removeSignal: () => void;
  timer: ReturnType<typeof setTimeout>;
}
/** Exactly one physical job per worker. Cancellation releases callers immediately,
 * but the slot remains occupied until its acknowledgment (or hard timeout).
 * Otherwise rapid zooms can enqueue an unbounded tail of stale CPU work.
 */
export class RasterWorkerClient {
  private active?: Pending;
  private closed = false;
  private nextId = 0;
  constructor(
    private readonly worker: Worker,
    private idle?: () => void,
    private fatal?: (error: unknown) => void,
  ) {
    worker.onmessage = ({ data }: MessageEvent<GeoTIFFWorkerResponse>) => {
      const pending = this.active;
      if (!pending || data.id !== pending.id) return;
      this.active = undefined;
      clearTimeout(pending.timer);
      pending.removeSignal();
      if (data.type === 'error') {
        const error = new Error(data.message) as Error & { code?: string };
        error.name = data.name;
        error.code = data.code;
        pending.reject?.(error);
      } else pending.resolve?.(data);
      pending.resolve = undefined;
      pending.reject = undefined;
      this.idle?.();
    };
    worker.onerror = (event) =>
      this.fail(
        new RasterError(
          'RASTER_WORKER_FAILED',
          event.message || 'Cannot load GeoTIFF Worker. Check workerUrl and CSP.',
        ),
      );
    worker.onmessageerror = () =>
      this.fail(new RasterError('RASTER_WORKER_FAILED', 'Invalid GeoTIFF Worker message.'));
  }
  get busy(): boolean {
    return this.active !== undefined;
  }
  call(
    message: GeoTIFFWorkerCommand,
    signal?: AbortSignal,
    transfer: Transferable[] = [],
  ): Promise<GeoTIFFWorkerResponse> {
    signal?.throwIfAborted();
    if (this.closed)
      return Promise.reject(new RasterError('SOURCE_CLOSED', 'Raster Worker is closed.'));
    if (this.active)
      return Promise.reject(
        new RasterError('RASTER_WORKER_BUSY', 'Only one physical job per Worker is allowed.'),
      );
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const abort = () => {
        const pending = this.active;
        if (!pending || pending.id !== id) return;
        const reason = signal?.reason ?? new DOMException('Cancelled', 'AbortError');
        pending.removeSignal();
        const fail = pending.reject;
        pending.resolve = undefined;
        pending.reject = undefined;
        fail?.(reason);
        try {
          this.worker.postMessage({ id, type: 'cancel' } satisfies GeoTIFFWorkerRequest);
        } catch (error) {
          this.fail(error);
        }
      };
      const removeSignal = () => {
        signal?.removeEventListener('abort', abort);
        signal = undefined;
      };
      const timer = setTimeout(
        () =>
          this.fail(
            new RasterError(
              'RASTER_WORKER_TIMEOUT',
              'Raster Worker exceeded the bounded request timeout.',
            ),
          ),
        60000,
      );
      this.active = { id, resolve, reject, removeSignal, timer };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.worker.postMessage({ ...message, id }, transfer);
      } catch (error) {
        this.fail(error);
      }
    });
  }
  private fail(error: unknown): void {
    if (this.closed) return;
    const callback = this.fatal;
    this.dispose(error);
    callback?.(error);
  }
  dispose(error: unknown = new DOMException('Raster source disposed', 'AbortError')): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.removeSignal();
      this.active.reject?.(error);
      this.active = undefined;
    }
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.idle = undefined;
    this.fatal = undefined;
  }
}

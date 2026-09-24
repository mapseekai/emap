import {
  geometryBatchBytes,
  validateGeometryBatch,
  type GeometryBatchItem,
} from '../../engine/rendering/luma/geometry-batch';
import { collectTransferables } from '../../engine/worker/transferables';
import type { GeometryPacket } from '../../engine/rendering/luma/geometry-jobs';
import type { GeometryResult } from '../../engine/rendering/luma/geometry-packet';

/** One lazy Worker per map, at most one bounded transferable batch in flight.
 * Cancellation terminates computation, rather than leaving a stale triangulation queued.
 */
export class GeometryWorker {
  private worker: Worker | null = null;
  private pending: { reject: (error: Error) => void } | null = null;
  private sequence = 0;
  private disposed = false;
  readonly stats = {
    workers: 0,
    jobs: 0,
    messages: 0,
    batchedJobs: 0,
    maxBatchJobs: 0,
    workerMs: 0,
    inputBytes: 0,
    peakInputBytes: 0,
  };
  private sources = new Set<string>();
  readonly triangulation = { bytes: 0, entries: 0, hits: 0, misses: 0, evictions: 0 };
  retainSources(sources: ReadonlySet<string>): void {
    if (sources.size === this.sources.size && [...sources].every((s) => this.sources.has(s)))
      return;
    this.sources = new Set(sources);
    this.worker?.postMessage({ retainSources: [...sources] });
    if (!sources.size) this.triangulation.bytes = this.triangulation.entries = 0;
  }
  constructor(private readonly url: URL) {}
  async build(packet: GeometryPacket, signal: AbortSignal): Promise<GeometryResult> {
    const response = await this.send({ packet }, signal);
    return response.result!;
  }
  async buildBatch(packets: GeometryPacket[], signal: AbortSignal): Promise<GeometryBatchItem[]> {
    validateGeometryBatch(packets);
    const response = await this.send({ packets }, signal);
    return response.results!;
  }
  private send(
    payload: { packet?: GeometryPacket; packets?: GeometryPacket[] },
    signal: AbortSignal,
  ): Promise<{
    result?: GeometryResult;
    results?: GeometryBatchItem[];
  }> {
    const packets = payload.packets ?? [payload.packet!];
    signal.throwIfAborted();
    if (this.disposed) return Promise.reject(new Error('Geometry Worker disposed'));
    if (this.pending) return Promise.reject(new Error('Geometry Worker already has an active job'));
    if (!this.worker) {
      this.worker = new Worker(this.url, { name: 'emap-geometry' });
      const current = this.worker;
      this.worker.addEventListener('message', (event) => {
        if (this.worker === current && event.data.cache && !this.disposed)
          Object.assign(this.triangulation, event.data.cache);
      });
      this.stats.workers = 1;
    }
    const worker = this.worker,
      id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        worker.removeEventListener('message', message);
        worker.removeEventListener('error', error);
        worker.removeEventListener('messageerror', decodeError);
        this.pending = null;
        this.stats.inputBytes = 0;
      };
      const fail = (reason: Error) => {
        cleanup();
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.stats.workers = 0;
        this.triangulation.bytes = this.triangulation.entries = 0;
        reject(reason);
      };
      const abort = () => fail(new DOMException('Geometry preparation cancelled', 'AbortError'));
      const error = (event: ErrorEvent) =>
        fail(
          new Error(
            `Geometry Worker failed: ${event.message || 'check geometryWorkerUrl and CSP'}`,
          ),
        );
      const decodeError = () => fail(new Error('Geometry Worker response could not be decoded'));
      const message = (
        event: MessageEvent<{
          id: number;
          result?: GeometryResult;
          results?: GeometryBatchItem[];
          error?: string;
          elapsedMs?: number;
        }>,
      ) => {
        if (event.data.id !== id) return;
        const valid = payload.packets
          ? Array.isArray(event.data.results) &&
            event.data.results.length === packets.length &&
            event.data.results.every(
              (item) => !!item && !!item.result !== (typeof item.error === 'string'),
            )
          : !!event.data.result;
        if (event.data.error || !valid) {
          fail(new Error(event.data.error ?? 'Invalid geometry Worker response'));
          return;
        }
        cleanup();
        this.stats.jobs += event.data.results?.filter((item) => !!item.result).length ?? 1;
        this.stats.workerMs += event.data.elapsedMs ?? 0;
        resolve(event.data);
      };
      this.pending = { reject: fail };
      signal.addEventListener('abort', abort, { once: true });
      worker.addEventListener('message', message);
      worker.addEventListener('error', error);
      worker.addEventListener('messageerror', decodeError);
      timer = setTimeout(() => fail(new Error('Geometry Worker job timed out')), 120_000);
      const bytes = geometryBatchBytes(packets);
      this.stats.inputBytes = bytes;
      this.stats.peakInputBytes = Math.max(this.stats.peakInputBytes, bytes);
      try {
        worker.postMessage({ id, ...payload }, collectTransferables(packets));
        this.stats.messages++;
        this.stats.maxBatchJobs = Math.max(this.stats.maxBatchJobs, packets.length);
        if (packets.length > 1) this.stats.batchedJobs += packets.length;
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending?.reject(new DOMException('Geometry Worker disposed', 'AbortError'));
    this.worker?.terminate();
    this.worker = null;
    this.stats.workers = 0;
    this.triangulation.bytes = this.triangulation.entries = 0;
    this.sources.clear();
  }
}

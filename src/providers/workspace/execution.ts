import { MapshaperWorkerPool } from '../../core/mapshaper-worker-pool';
import { DEFAULT_WORKER_THRESHOLD, type MapOptions } from '../../map/types';

/** execution implementation, wired through explicit service dependencies. */
export class ExecutionServiceImpl {
  _workerPool: MapshaperWorkerPool | null = null;

  _workerMode: boolean | 'auto' = false;

  _workerThreshold: number = DEFAULT_WORKER_THRESHOLD;

  _workerRouting?: import('../../map/worker-routing').WorkerRoutingFn;

  public cancelWorkerJobs(): void {
    this._workerPool?.cancelAll();
  }

  configure(options: Omit<MapOptions, 'container'>): void {
    this._workerMode = options.useWorker ?? false;
    this._workerThreshold =
      typeof options.workerThreshold === 'number' && options.workerThreshold >= 0
        ? options.workerThreshold
        : DEFAULT_WORKER_THRESHOLD;
    this._workerRouting = options.workerRouting;
    if (this._workerMode !== false) {
      this._workerPool =
        options.workerPool ??
        new MapshaperWorkerPool({
          workerUrl: options.workerUrl ?? 'emap-worker.js',
          poolSize: options.workerPoolSize,
        });
    }
  }
  dispose(): void {
    this._workerPool?.cancelAll();
    this._workerPool?.destroy();
    this._workerPool = null;
  }
}

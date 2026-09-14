import type { MapshaperWorkerPool } from '../../core/mapshaper-worker-pool';
import type { MapOptions } from '../../map/types';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface ExecutionContract {
  /** @internal */
  _workerPool: MapshaperWorkerPool | null;
  /** @internal */
  _workerMode: boolean | 'auto';
  /** @internal */
  _workerThreshold: number;
  /** @internal */
  _workerRouting?: import('../../map/worker-routing').WorkerRoutingFn;
  cancelWorkerJobs(): void;
  configure(options: Omit<MapOptions, 'container'>): void;
  dispose(): void;
}

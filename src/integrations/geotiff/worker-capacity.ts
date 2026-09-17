import { RasterError } from '../../domain/raster/policy';

// Bound optional parallel replicas across sources in this loaded integration.
// Existing primary workers remain source-owned; at most four extra workers exist.
let extraWorkers = 0;
export function acquireParallelWorker(): (() => void) | undefined {
  if (extraWorkers >= 4) return undefined;
  extraWorkers++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      extraWorkers--;
    }
  };
}
export function rasterWorkerCount(value?: number): number {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 4))
    throw new RasterError('INVALID_RASTER_WORKERS', 'workerCount must be 1–4.');
  const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 2;
  return value ?? (cores >= 3 ? 2 : 1);
}

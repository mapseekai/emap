import type {
  RuntimeScope,
  WorkerRuntime,
  WorkerSession,
  SessionAdmissionError,
} from '@mapseekai/tasklane';
import { isWorkerRuntimeError, workerError } from '../tasklane/runtime';
import { RasterError } from '../../domain/raster/policy';

const RASTER_BLOCK_CACHE_BUDGET_BYTES = 256 * 1024 ** 2;
export interface RasterBlockCacheLease {
  resize(bytes: number): number;
  release(): void;
}

/** Runtime-wide lifetime reservations; Scope cleanup retains bytes until physical release. */
export function acquireRasterBlockCache(
  scope: RuntimeScope,
  runtime: WorkerRuntime,
  initialBytes: number,
): RasterBlockCacheLease {
  const validate = (bytes: number) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > RASTER_BLOCK_CACHE_BUDGET_BYTES)
      throw new RasterError('INVALID_RASTER_BUDGET', 'Invalid raster block-cache reservation.');
  };
  validate(initialBytes);
  let lease;
  try {
    lease = scope.resources.acquire({
      kind: 'resident',
      bytes: initialBytes,
      priority: 'interactive',
    });
  } catch (error) {
    if (!isWorkerRuntimeError(error) || error.code !== 'BUDGET_EXCEEDED') throw error;
    throw new RasterError(
      'RASTER_CACHE_BUDGET',
      'Open raster sources exceed the runtime resident budget.',
    );
  }
  return {
    resize(bytes) {
      if (lease.released) return 0;
      validate(bytes);
      const available =
        runtime.diagnostics().limits.residentBytes! -
        runtime.stats.reserved.residentBytes +
        lease.bytes;
      const granted = Math.min(bytes, available);
      lease.resize(granted);
      return granted;
    },
    release: () => lease.release(),
  };
}

export function rasterWorkerCount(value?: number): number {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 4))
    throw new RasterError('INVALID_RASTER_WORKERS', 'workerCount must be 1–4.');
  const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 2;
  return value ?? (cores >= 3 ? 2 : 1);
}

/** Waiting admissions are demand for tasklane's controller; main-thread queues are not. */
function canGrowRasterPool(runtime: WorkerRuntime): boolean {
  const diagnostics = runtime.diagnostics();
  const pool = diagnostics.pools.find((pool) => pool.name === 'geotiff');
  return (
    diagnostics.memoryPressure === 'normal' &&
    !!pool?.adaptive &&
    pool.capacity < pool.maxCapacity &&
    runtime.stats.workers < diagnostics.limits.maxWorkers
  );
}

/** Native admission owns physical capacity and only reclaims explicitly optional readers. */
export async function acquireRasterPrimary(
  scope: RuntimeScope,
  runtime: WorkerRuntime,
  signal?: AbortSignal,
): Promise<WorkerSession> {
  try {
    return await scope.acquireSession('geotiff', {
      mode: 'immediate',
      priority: 'interactive',
      signal,
    });
  } catch (error) {
    if (!isWorkerRuntimeError(error) || error.code !== 'CAPACITY_UNAVAILABLE')
      throw workerError(error);
    // Preserve fast failure when only mandatory readers occupy capacity. A
    // bounded wait lets tasklane reclaim idle replicas and confirm termination.
    const poolFull = (error as SessionAdmissionError).reasons.includes('pool-capacity');
    const reclaimable = runtime
      .diagnostics()
      .pools.some(
        (pool) =>
          (!poolFull || pool.name === 'geotiff') && (pool.reclaimableSessions > 0 || pool.idle > 0),
      );
    if (reclaimable || canGrowRasterPool(runtime)) {
      const controller = new AbortController();
      const cancel = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 5000);
      try {
        return await scope.acquireSession('geotiff', {
          mode: 'wait',
          priority: 'interactive',
          signal: controller.signal,
        });
      } catch (failure) {
        if (
          signal?.aborted ||
          (!timedOut &&
            (!isWorkerRuntimeError(failure) ||
              !['CAPACITY_UNAVAILABLE', 'QUEUE_TIMEOUT'].includes(failure.code)))
        )
          throw workerError(failure);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    }
    throw new RasterError(
      'RASTER_WORKER_CAPACITY',
      'GeoTIFF Worker capacity is occupied. Close a source or increase runtime limits.',
    );
  }
}

export async function acquireRasterReplica(
  scope: RuntimeScope,
  signal: AbortSignal,
  runtime: WorkerRuntime,
): Promise<WorkerSession | undefined> {
  try {
    return await scope.acquireSession('geotiff', {
      mode: canGrowRasterPool(runtime) ? 'wait' : 'immediate',
      timeoutMs: 5000,
      reclaimable: true,
      priority: 'interactive',
      signal,
    });
  } catch (error) {
    if (
      isWorkerRuntimeError(error) &&
      ['CAPACITY_UNAVAILABLE', 'QUEUE_TIMEOUT'].includes(error.code)
    )
      return;
    throw workerError(error);
  }
}

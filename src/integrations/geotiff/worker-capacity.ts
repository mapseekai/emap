import { RasterError } from '../../domain/raster/policy';

// Bound optional parallel replicas across sources in this loaded integration.
// Existing primary workers remain source-owned; at most four extra workers exist.
let extraWorkers = 0;
const RASTER_BLOCK_CACHE_BUDGET_BYTES = 256 * 1024 ** 2;
let reservedBlockCacheBytes = 0;

export interface RasterBlockCacheLease {
  readonly bytes: number;
  resize(bytes: number): number;
  release(): void;
}

export function acquireRasterBlockCache(initialBytes: number): RasterBlockCacheLease {
  if (
    !Number.isSafeInteger(initialBytes) ||
    initialBytes < 0 ||
    initialBytes > RASTER_BLOCK_CACHE_BUDGET_BYTES
  )
    throw new RasterError('INVALID_RASTER_BUDGET', 'Invalid raster block-cache reservation.');
  if (reservedBlockCacheBytes + initialBytes > RASTER_BLOCK_CACHE_BUDGET_BYTES)
    throw new RasterError(
      'RASTER_CACHE_BUDGET',
      'Open raster sources exceed the aggregate 256MiB block-cache budget.',
    );
  let held = initialBytes,
    released = false;
  reservedBlockCacheBytes += held;
  return {
    get bytes() {
      return held;
    },
    resize(bytes: number): number {
      if (released) return 0;
      if (
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        bytes > RASTER_BLOCK_CACHE_BUDGET_BYTES
      )
        throw new RasterError('INVALID_RASTER_BUDGET', 'Invalid raster block-cache reservation.');
      const available = RASTER_BLOCK_CACHE_BUDGET_BYTES - (reservedBlockCacheBytes - held),
        next = Math.min(bytes, available);
      reservedBlockCacheBytes += next - held;
      held = next;
      return held;
    },
    release(): void {
      if (released) return;
      released = true;
      reservedBlockCacheBytes -= held;
      held = 0;
    },
  };
}

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

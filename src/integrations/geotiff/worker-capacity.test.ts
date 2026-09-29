import { createWorkerRuntime } from '@mapseekai/tasklane';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  rasterWorkerCount,
  acquireRasterBlockCache,
  acquireRasterPrimary,
  acquireRasterReplica,
} from './worker-capacity';
import { createEmapWorkerRuntime } from '../tasklane/runtime';
import { TasklaneTestWorker } from '../../../test/helpers/tasklane-worker';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('bounded parallel worker leases', () => {
  it('makes primary and replica admissions visible to the adaptive controller and preserves mandatory readers on shrink', async () => {
    vi.stubGlobal('Worker', TasklaneTestWorker);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const runtime = createEmapWorkerRuntime({
      sizes: { geotiff: 3 },
      adaptive: {
        geotiff: { minWorkers: 1, sampleMs: 10, idleMs: 50 },
      },
    });
    const scope = runtime.createScope();
    try {
      const first = await acquireRasterPrimary(scope, runtime);
      const pendingPrimary = acquireRasterPrimary(scope, runtime);
      await vi.advanceTimersByTimeAsync(20);
      const second = await pendingPrimary;
      const pendingReplica = acquireRasterReplica(scope, new AbortController().signal, runtime);
      await vi.advanceTimersByTimeAsync(20);
      const replica = await pendingReplica;
      expect(replica?.state).toBe('bound');
      expect(runtime.diagnostics().pools.find((p) => p.name === 'geotiff')).toMatchObject({
        capacity: 3,
        workers: 3,
        cacheBytesPerWorker: 256 * 1024 ** 2,
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(replica?.reclaimed).toBe(true);
      expect(first.state).toBe('bound');
      expect(second.state).toBe('bound');
      expect(runtime.stats.workers).toBe(2);
    } finally {
      await runtime.dispose();
    }
  });
  it('chooses conservative defaults and supports explicit 1–4 workers', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    expect(rasterWorkerCount()).toBe(1);
    vi.stubGlobal('navigator', { hardwareConcurrency: 32 });
    expect(rasterWorkerCount()).toBe(2);
    expect(rasterWorkerCount(4)).toBe(4);
    for (const value of [0, 5, Infinity, NaN, 1.5])
      expect(() => rasterWorkerCount(value)).toThrow();
  });
  it('bounds aggregate decoded block caches in the owning runtime', async () => {
    const runtime = createWorkerRuntime({
      pools: {
        raster: {
          factory: () => {
            throw new Error('No worker needed');
          },
          size: 1,
        },
      },
      budgets: { residentBytes: 256 * 1024 ** 2 },
    });
    const scope = runtime.createScope();
    const first = acquireRasterBlockCache(scope, runtime, 8 * 1024 ** 2),
      second = acquireRasterBlockCache(scope, runtime, 8 * 1024 ** 2);
    try {
      expect(first.resize(200 * 1024 ** 2)).toBe(200 * 1024 ** 2);
      expect(second.resize(128 * 1024 ** 2)).toBe(56 * 1024 ** 2);
      expect(() => acquireRasterBlockCache(scope, runtime, 1)).toThrow(/RASTER_CACHE_BUDGET/);
      first.release();
      expect(second.resize(128 * 1024 ** 2)).toBe(128 * 1024 ** 2);
    } finally {
      first.release();
      second.release();
      await runtime.dispose();
    }
  });
});

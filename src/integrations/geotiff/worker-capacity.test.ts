import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  rasterWorkerCount,
  acquireParallelWorker,
  acquireRasterBlockCache,
} from './worker-capacity';
afterEach(() => vi.unstubAllGlobals());
describe('bounded parallel worker leases', () => {
  it('chooses conservative defaults and supports explicit 1–4 workers', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    expect(rasterWorkerCount()).toBe(1);
    vi.stubGlobal('navigator', { hardwareConcurrency: 32 });
    expect(rasterWorkerCount()).toBe(2);
    expect(rasterWorkerCount(4)).toBe(4);
    for (const value of [0, 5, Infinity, NaN, 1.5])
      expect(() => rasterWorkerCount(value)).toThrow();
  });
  it('caps replicas across sources and makes release idempotent', () => {
    const leases = Array.from({ length: 4 }, () => acquireParallelWorker()!);
    expect(acquireParallelWorker()).toBeUndefined();
    leases[0]();
    leases[0]();
    const replacement = acquireParallelWorker()!;
    expect(replacement).toBeTypeOf('function');
    expect(acquireParallelWorker()).toBeUndefined();
    replacement();
    leases.slice(1).forEach((release) => release());
  });
  it('bounds aggregate decoded block caches across raster sources', () => {
    const first = acquireRasterBlockCache(8 * 1024 ** 2),
      second = acquireRasterBlockCache(8 * 1024 ** 2);
    try {
      expect(first.resize(200 * 1024 ** 2)).toBe(200 * 1024 ** 2);
      expect(second.resize(128 * 1024 ** 2)).toBe(56 * 1024 ** 2);
      expect(() => acquireRasterBlockCache(1)).toThrow(/RASTER_CACHE_BUDGET/);
      first.release();
      expect(second.resize(128 * 1024 ** 2)).toBe(128 * 1024 ** 2);
    } finally {
      first.release();
      second.release();
    }
  });
});

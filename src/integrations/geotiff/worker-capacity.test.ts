import { describe, expect, it, vi, afterEach } from 'vitest';
import { rasterWorkerCount, acquireParallelWorker } from './worker-capacity';
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
});

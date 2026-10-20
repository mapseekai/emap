import { afterEach, expect, it, vi } from 'vitest';
import { output } from '@mapseekai/tasklane/host';
import { createEmapWorkerRuntime, SessionOwner, taskValue, workerError } from './runtime';
import { TasklaneTestWorker, flushTasks } from '../../../test/utils/tasklane-worker';
import type { EmapWorkerPool } from './runtime';
const runtimes: ReturnType<typeof createEmapWorkerRuntime>[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each<[EmapWorkerPool, number]>([
  ['mapshaper', 1],
  ['geometry', 4],
  ['msdf', 4],
  ['geotiff', 8],
  ['geopackage', 2],
])('uses the default %s capacity when an optional size is undefined', (name, capacity) => {
  const runtime = createEmapWorkerRuntime({ sizes: { [name]: undefined } });
  runtimes.push(runtime);
  expect(runtime.diagnostics().pools.find((pool) => pool.name === name)?.capacity).toBe(capacity);
});

it.each([
  0,
  -1,
  1.5,
  NaN,
  Infinity,
  Number.MAX_SAFE_INTEGER + 1,
])('rejects invalid pool capacity %s', (geometry) => {
  expect(() => createEmapWorkerRuntime({ sizes: { geometry } })).toThrow();
});
it('keeps fixed capacity by default and bounds opt-in adaptive GeoTIFF capacity without reclaiming primaries', async () => {
  TasklaneTestWorker.instances = [];
  vi.stubGlobal('Worker', TasklaneTestWorker);
  const fixed = createEmapWorkerRuntime({ sizes: { geotiff: 4 } });
  runtimes.push(fixed);
  expect(fixed.diagnostics().pools.find((pool) => pool.name === 'geotiff')).toMatchObject({
    capacity: 4,
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const runtime = createEmapWorkerRuntime({
    sizes: { geotiff: 4 },
    adaptive: {
      geotiff: { minWorkers: 2, minCacheBytes: 256 * 1024 ** 2, sampleMs: 10, idleMs: 50 },
    },
  });
  runtimes.push(runtime);
  const scope = runtime.createScope();
  const primary = await scope.acquireSession('geotiff');
  const secondPrimary = await scope.acquireSession('geotiff');
  expect(runtime.diagnostics().pools.find((pool) => pool.name === 'geotiff')).toMatchObject({
    capacity: 2,
    maxCapacity: 4,
  });
  const waiting = scope.acquireSession('geotiff', { reclaimable: true, mode: 'wait' });
  await vi.advanceTimersByTimeAsync(20);
  const extra = await waiting;
  expect(runtime.diagnostics().pools.find((pool) => pool.name === 'geotiff')).toMatchObject({
    capacity: 3,
    workers: 3,
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(runtime.diagnostics().pools.find((pool) => pool.name === 'geotiff')).toMatchObject({
    capacity: 2,
    workers: 2,
  });
  expect(primary.state).toBe('bound');
  expect(secondPrimary.state).toBe('bound');
  expect(extra.reclaimed).toBe(true);
  await scope.dispose();
  expect(runtime.stats.reserved.cacheBytes).toBe(0);
});
it('isolates Session resources, releases result leases, and never disposes a borrowed runtime', async () => {
  TasklaneTestWorker.instances = [];
  const released = vi.fn();
  TasklaneTestWorker.handlers = {
    geometry: (_value, ctx) => {
      if (!ctx.cache.get('resource'))
        ctx.cache.setResource('resource', { native: true }, 16, released);
      return output(new Uint8Array([1, 2]));
    },
  };
  vi.stubGlobal('Worker', TasklaneTestWorker);
  const runtime = createEmapWorkerRuntime({ urls: { geometry: 'geometry.js' } });
  runtimes.push(runtime);
  const a = new SessionOwner('geometry', 'ignored.js', runtime),
    b = new SessionOwner('geometry', 'ignored.js', runtime);
  const options = {
    budget: { inputBytes: 8, scratchBytes: 0, outputBytes: 8 },
    prepare: () => ({ payload: null }),
  };
  await Promise.all([
    taskValue(a.session.enqueue('geometry', options)),
    taskValue(b.session.enqueue('geometry', options)),
  ]);
  expect(runtime.stats.leases).toBe(0);
  expect(runtime.stats.workers).toBe(2);
  await a.close();
  expect(released).toHaveBeenCalledTimes(1);
  expect(runtime.stats.scopes).toBe(1);
  await taskValue(b.session.enqueue('geometry', options));
  expect(runtime.stats.completed).toBe(3);
  await b.close();
  await runtime.dispose();
  expect(runtime.stats.scopes).toBe(0);
  expect(runtime.stats.workers).toBe(0);
  expect(runtime.stats.reserved).toEqual({
    inputBytes: 0,
    outputBytes: 0,
    scratchBytes: 0,
    cacheBytes: 0,
    residentBytes: 0,
  });
});
it('keeps cancelled cooperative work physically occupied until its host finishes', async () => {
  TasklaneTestWorker.instances = [];
  TasklaneTestWorker.handlers = {};
  vi.stubGlobal('Worker', TasklaneTestWorker);
  const runtime = createEmapWorkerRuntime();
  runtimes.push(runtime);
  const owner = new SessionOwner('msdf', 'ignored.js', runtime),
    controller = new AbortController();
  const handle = owner.session.enqueue('msdf', {
    budget: { inputBytes: 8, outputBytes: 8, scratchBytes: 8 },
    prepare: () => ({ payload: null }),
    signal: controller.signal,
    cancellation: 'cooperative',
  });
  const rejected = expect(taskValue(handle)).rejects.toMatchObject({ name: 'AbortError' });
  await flushTasks();
  controller.abort();
  await rejected;
  expect(runtime.stats.active).toBe(1);
  expect(runtime.stats.reserved.scratchBytes).toBe(8);
  TasklaneTestWorker.instances[0].pending[0].resolve(output(null));
  await handle.settled;
  expect(runtime.stats.active).toBe(0);
  expect(runtime.stats.reserved.scratchBytes).toBe(0);
  await owner.close();
});

it('normalizes tasklane errors from independently bundled public entry points', () => {
  const cancelled = Object.assign(new Error('cancelled'), {
    name: 'RuntimeError',
    code: 'ABORTED',
  });
  expect(workerError(cancelled)).toMatchObject({ name: 'AbortError', message: 'cancelled' });
  const remote = Object.assign(new Error('task failed'), {
    name: 'RuntimeError',
    code: 'REMOTE_ERROR',
    remoteError: { name: 'RangeError', message: 'invalid input', code: 'BAD_INPUT' },
  });
  expect(workerError(remote)).toMatchObject({
    name: 'RangeError',
    message: 'invalid input',
    code: 'BAD_INPUT',
  });
  const unrelated = new Error('unrelated');
  expect(workerError(unrelated)).toBe(unrelated);
});

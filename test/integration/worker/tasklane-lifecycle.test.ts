import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { output } from '@mapseekai/tasklane/host';
import { createWorkerRuntime } from '@mapseekai/tasklane';
import { createEmapWorkerRuntime, taskValue } from '../../../src/integrations/tasklane/runtime';
import { MapshaperWorkerPool } from '../../../src/engine/core/mapshaper-worker-pool';
import { openGeoTIFF } from '../../../src/integrations/geotiff/source';
import { GEOTIFF_WORKER_PROTOCOL_VERSION } from '../../../src/integrations/geotiff/worker-protocol';
import { importGeoPackageInWorker } from '../../../src/integrations/geopackage/worker';
import { encodeWorkerData } from '../../../src/integrations/mapshaper/binary';
import { TasklaneTestWorker, flushTasks } from '../../../test/helpers/tasklane-worker';
const runtimes: any[] = [],
  sources: any[] = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function runtime(options: any = {}) {
  const r = createEmapWorkerRuntime(options);
  runtimes.push(r);
  return r;
}
const file = () => new File([new Uint8Array(8)], 'image.tif');
const metadata = {
  filename: 'image.tif',
  fileSize: 8,
  lastModified: 12,
  crs: 'EPSG:4326',
  bounds: [0, 0, 1024, 256],
  origin: [0, 256],
  resolution: [1, -1],
  noData: null,
  alphaBand: null,
  bigTiff: false,
  levels: [
    {
      id: 0,
      width: 1024,
      height: 256,
      tileWidth: 256,
      tileHeight: 256,
      samples: 1,
      bits: [8],
      formats: [1],
      photometric: 1,
      subfileType: 0,
    },
  ],
};
function rasterResponse(p: any) {
  return output(
    p.type === 'open'
      ? {
          id: 0,
          type: 'metadata',
          metadata,
          directoryBytes: 1000,
          protocolVersion: GEOTIFF_WORKER_PROTOCOL_VERSION,
        }
      : p.type === 'read'
        ? { id: 0, type: 'result', result: { width: 1, height: 1, data: [new Uint8Array([7])] } }
        : { id: 0, type: 'configured' },
  );
}
async function open(r: any, count = 2) {
  const s = await openGeoTIFF(file(), {
    workerRuntime: r,
    workerUrl: 'https://example.test/raster.js',
    workerCount: count,
  });
  sources.push(s);
  await flushTasks();
  return s;
}
beforeEach(() => {
  TasklaneTestWorker.instances = [];
  TasklaneTestWorker.handlers = { raster: rasterResponse };
  TasklaneTestWorker.cloneMessages = true;
  vi.stubGlobal('Worker', TasklaneTestWorker);
});
afterEach(async () => {
  for (const s of sources.splice(0)) s.dispose();
  await Promise.allSettled(runtimes.splice(0).map((r) => r.dispose()));
  await flushTasks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('continuous Mapshaper queue must not block available interactive headroom', async () => {
  const r = runtime();
  const pool = new MapshaperWorkerPool({ workerUrl: 'worker.js', workerRuntime: r });
  const jobs = [
    pool.run('-clean', { datasets: [] }).catch((e) => e),
    pool.run('-clean', { datasets: [] }).catch((e) => e),
  ];
  await flushTasks();
  const scope = r.createScope('interactive'),
    session = scope.session('geometry');
  const opts = {
    priority: 'interactive' as const,
    budget: { inputBytes: 8, outputBytes: 8, scratchBytes: 8 },
    prepare: () => ({ payload: null }),
  };
  const first = taskValue(session.enqueue('geometry', opts));
  await flushTasks();
  await delay(1100);
  TasklaneTestWorker.instances
    .find((w) => w.requests.some((q) => q.name === 'geometry'))!
    .pending[0].resolve(output(null));
  await first;
  await flushTasks();
  const second = taskValue(session.enqueue('geometry', opts)).catch((e) => e);
  await flushTasks();
  console.log('HEADROOM_AFTER_RESERVATION', r.stats);
  try {
    expect(r.stats.active).toBe(2);
  } finally {
    pool.destroy();
    await pool.closed;
    await scope.dispose();
    await Promise.all([...jobs, second]);
  }
});
it('global worker limit should trigger replica reclamation instead of queue timeout', async () => {
  const r = runtime({ limits: { maxWorkers: 2, queueTimeoutMs: 40 } });
  await open(r);
  const result = await open(r, 1).then(
    () => ({ ok: true }),
    (e) => ({ ok: false, code: e.code }),
  );
  console.log('GLOBAL_WORKER_LIMIT', result, r.stats);
  expect(result).toEqual({ ok: true });
});
it('native admission reclaims ordinary idle Workers in another pool', async () => {
  TasklaneTestWorker.handlers.geometry = () => output(null);
  const r = runtime({ limits: { maxWorkers: 1, queueTimeoutMs: 80 } });
  const scope = r.createScope('temporary-geometry');
  await taskValue(
    scope.enqueue('geometry', {
      pool: 'geometry',
      budget: { inputBytes: 8, outputBytes: 8, scratchBytes: 0 },
      prepare: () => ({ payload: null }),
    }),
  );
  await flushTasks();
  const source = await open(r, 1);
  expect(r.stats.workers).toBe(1);
  expect(
    (await source.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] })).data[0][0],
  ).toBe(7);
  await scope.dispose();
});
it('a full primary-only raster pool fails without queuing behind unrelated idle Workers', async () => {
  TasklaneTestWorker.handlers.geometry = () => output(null);
  const r = runtime({ sizes: { geotiff: 1 }, limits: { queueTimeoutMs: 80 } });
  const scope = r.createScope('temporary-geometry');
  await taskValue(
    scope.enqueue('geometry', {
      pool: 'geometry',
      budget: { inputBytes: 8, outputBytes: 8, scratchBytes: 0 },
      prepare: () => ({ payload: null }),
    }),
  );
  await open(r, 1);
  const pending = open(r, 1).catch((error) => error);
  await flushTasks();
  expect(r.stats.queued).toBe(0);
  expect(r.diagnostics().pools.find((pool) => pool.name === 'geotiff')?.waitingSessions).toBe(0);
  expect(await pending).toMatchObject({ code: 'RASTER_WORKER_CAPACITY' });
  await scope.dispose();
});
it('rebuilds an optional reader after native reclamation and returns resident credits on close', async () => {
  const r = runtime({ sizes: { geotiff: 2 }, limits: { queueTimeoutMs: 80 } });
  const first = await open(r, 2);
  const second = await open(r, 1);
  expect(r.stats.sessionsReclaimed).toBe(1);
  expect(first.getProcessingStats?.().workers).toBe(1);
  second.dispose();
  await second.settled;
  await Promise.all(
    [0, 256].map((x) => first.readWindow({ level: 0, window: [x, 0, x + 1, 1], samples: [0] })),
  );
  await flushTasks();
  expect(first.getProcessingStats?.().workers).toBe(2);
  expect(r.stats.workers).toBe(2);
  expect(r.stats.reserved.residentBytes).toBeGreaterThan(0);
  first.dispose();
  await first.settled;
  expect(r.stats.resourceLeases).toBe(0);
  expect(r.stats.reserved.residentBytes).toBe(0);
  expect(r.stats.workers).toBe(0);
});
it('failed replica cleanup must not strand affinity reads of the existing source', async () => {
  let opens = 0,
    cleanupCalls = 0;
  TasklaneTestWorker.handlers.raster = (p: any, ctx: any) => {
    if (p.type === 'open' && ++opens === 2)
      ctx.cache.setResource('reader', { id: 2 }, 16, () => {
        if (++cleanupCalls === 1) throw new Error('transient replica cleanup failure');
      });
    return rasterResponse(p);
  };
  const r = runtime({ sizes: { geotiff: 2 }, limits: { queueTimeoutMs: 80 } }),
    original = await open(r);
  const newcomer = await open(r, 1).then(
    () => ({ ok: true }),
    (e) => ({ ok: false, message: e.message }),
  );
  const ctl = new AbortController();
  const read = original
    .readWindow({ level: 0, window: [256, 0, 257, 1], samples: [0] }, ctl.signal)
    .then(
      () => ({ ok: true }),
      (e) => ({ ok: false, code: e.code }),
    );
  const result = await Promise.race([read, delay(50).then(() => ({ pending: true }))]);
  console.log('FAILED_RECLAIM', {
    newcomer,
    result,
    cleanupCalls,
    processing: original.getProcessingStats?.(),
  });
  ctl.abort();
  await read;
  expect(result).toEqual({ ok: true });
});
it('borrowed GeoPackage runtime should use its actual Worker directory for default WASM', async () => {
  let supplied: string | undefined;
  TasklaneTestWorker.handlers.import = (p: any) => {
    supplied = p.options.wasmUrl;
    throw new Error('captured');
  };
  const r = runtime({
    urls: { geopackage: 'https://example.test/actual/emap-geopackage-worker.js' },
  });
  await importGeoPackageInWorker(new Uint8Array(1), {
    workerRuntime: r,
    workerUrl: 'https://example.test/ignored/worker.js',
  }).catch(() => {});
  console.log('BORROWED_WASM_URL', { worker: TasklaneTestWorker.instances[0].url, wasm: supplied });
  expect(supplied).toBe('https://example.test/actual/sql-wasm.wasm');
});
it('array accessors should be rejected without executing application code', () => {
  let invoked = 0;
  const values: any[] = [];
  Object.defineProperty(values, '0', {
    enumerable: true,
    get() {
      invoked++;
      return 42;
    },
  });
  let failure: unknown;
  try {
    encodeWorkerData({ values });
  } catch (e) {
    failure = e;
  }
  console.log('ARRAY_ACCESSOR', { invoked, rejected: !!failure });
  expect(invoked).toBe(0);
  expect(failure).toBeInstanceOf(TypeError);
});
it('geometry cache disposal must expose or retry failed Worker cleanup', async () => {
  const { GeometryWorker } = await import('../../../src/integrations/luma/geometry-worker');
  const { GeometryChunkCache } = await import('../../../src/integrations/luma/geometry-cache');
  let calls = 0;
  TasklaneTestWorker.handlers.geometry = (_p: any, ctx: any) => {
    ctx.cache.setResource('geometry', { value: 1 }, 16, () => {
      if (++calls === 1) throw new Error('transient geometry cleanup failure');
    });
    return output({
      result: { geometries: [], screenSpace: false },
      cache: { bytes: 0, entries: 0 },
    });
  };
  const r = runtime(),
    worker = new GeometryWorker(new URL('https://example.test/geometry.js'), r);
  await worker.build(
    {
      kind: 'point',
      coordinates: Float64Array.of(1, 2),
      offsets: Uint32Array.of(0, 1),
      features: Uint32Array.of(0, 1),
    },
    new AbortController().signal,
  );
  const cache = new GeometryChunkCache({} as any, {
    workerUrl: new URL('https://example.test/geometry.js'),
    transport: worker,
    invalidate() {},
    report() {},
  });
  cache.dispose();
  await worker.closed.catch(() => {});
  cache.dispose();
  await flushTasks();
  console.log('UPPER_LAYER_CLEANUP', { calls, scopes: r.stats.scopes, workers: r.stats.workers });
  try {
    expect(calls).toBe(2);
    expect(r.stats.scopes).toBe(0);
  } finally {
    worker.dispose();
    await worker.closed;
  }
});
it('partial Session construction failures should not leak scopes', async () => {
  const { MsdfClient } = await import('../../../src/integrations/msdf/client');
  const r = createWorkerRuntime({
    pools: {
      geometry: {
        size: 1,
        factory: () => {
          throw new Error('must not spawn');
        },
      },
    },
  });
  runtimes.push(r);
  const c = new MsdfClient(new URL('https://example.test/msdf.js'), r);
  for (let i = 0; i < 3; i++) await c.shape([], new AbortController().signal).catch(() => {});
  c.clear();
  await c.closed;
  console.log('PARTIAL_SESSION_LEAK', { scopes: r.stats.scopes });
  expect(r.stats.scopes).toBe(0);
});

it('higher-priority work bypasses a runnable lower-priority budget reservation', async () => {
  const { workerFactory } = await import('../../../src/integrations/tasklane/runtime');
  const r = createWorkerRuntime({
    pools: {
      geometry: {
        size: 2,
        allowHardCancel: true,
        factory: workerFactory('worker.js', TasklaneTestWorker as unknown as typeof Worker),
      },
    },
    budgets: { inputBytes: 16, outputBytes: 16, scratchBytes: 8, cacheBytes: 0 },
    budgetWaitMs: 10,
  });
  runtimes.push(r);
  const scope = r.createScope('priorities');
  const enqueue = (size: number, priority: 'foreground' | 'interactive', group: string) =>
    taskValue(
      scope.enqueue('geometry', {
        pool: 'geometry',
        priority,
        group,
        cancellation: 'terminate',
        budget: { inputBytes: size, outputBytes: size, scratchBytes: 0 },
        prepare: () => ({ payload: null }),
      }),
    );
  const a = enqueue(8, 'foreground', 'a').catch((e) => e);
  await flushTasks();
  const b = enqueue(16, 'foreground', 'b').catch((e) => e);
  const first = enqueue(8, 'interactive', 'first');
  await flushTasks();
  await delay(25);
  TasklaneTestWorker.instances[1].pending[0].resolve(output(null));
  await first;
  await flushTasks();
  const next = enqueue(8, 'interactive', 'next').catch((e) => e);
  await flushTasks();
  try {
    expect(r.stats.active).toBe(2);
  } finally {
    await scope.dispose();
    await Promise.all([a, b, next]);
  }
});

it('raster admission accounts for another pool occupying the global worker limit', async () => {
  TasklaneTestWorker.handlers.geometry = () => output(null);
  const r = runtime({ limits: { maxWorkers: 3, queueTimeoutMs: 60 } });
  const scope = r.createScope('geometry-owner');
  await taskValue(
    scope.session('geometry').enqueue('geometry', {
      budget: { inputBytes: 8, outputBytes: 8, scratchBytes: 0 },
      prepare: () => ({ payload: null }),
    }),
  );
  const first = await open(r, 2);
  const second = await open(r, 1);
  expect(r.stats.workers).toBe(3);
  expect(r.stats.queued).toBe(0);
  expect(
    (await first.readWindow({ level: 0, window: [256, 0, 257, 1], samples: [0] })).data[0][0],
  ).toBe(7);
  expect(
    (await second.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] })).data[0][0],
  ).toBe(7);
});
it('global cache reservations also constrain persistent raster admission', async () => {
  TasklaneTestWorker.handlers.msdf = () => output(null);
  const r = runtime({ limits: { budgets: { cacheBytes: 2 * 1024 ** 3 }, queueTimeoutMs: 60 } });
  const scope = r.createScope('font-owners');
  for (let i = 0; i < 4; i++)
    await taskValue(
      scope.session('msdf').enqueue('msdf', {
        budget: { inputBytes: 8, outputBytes: 8, scratchBytes: 0 },
        prepare: () => ({ payload: null }),
      }),
    );
  for (let i = 0; i < 4; i++) await open(r, 1);
  await expect(open(r, 1)).rejects.toMatchObject({ code: 'RASTER_WORKER_CAPACITY' });
  expect(r.stats.queued).toBe(0);
});

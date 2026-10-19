import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { output } from '@mapseekai/tasklane/host';
import { createEmapWorkerRuntime, taskValue } from '../../../src/integrations/tasklane/runtime';
import { MapshaperWorkerPool } from '../../../src/engine/core/mapshaper-worker-pool';
import { MsdfClient } from '../../../src/integrations/msdf/client';
import { openGeoTIFF } from '../../../src/integrations/geotiff/source';
import { GEOTIFF_WORKER_PROTOCOL_VERSION } from '../../../src/integrations/geotiff/worker-protocol';
import { encodeWorkerData, decodeWorkerData } from '../../../src/integrations/mapshaper/binary';
import { getDefaultMapshaperAdapter } from '../../../src/integrations/mapshaper/adapter';
import { TasklaneTestWorker, flushTasks } from '../../../test/helpers/tasklane-worker';
const runtimes: any[] = [];
const sources: any[] = [];
function runtime(limits: any = {}) {
  const r = createEmapWorkerRuntime({ limits });
  runtimes.push(r);
  return r;
}
beforeEach(() => {
  TasklaneTestWorker.instances = [];
  TasklaneTestWorker.handlers = {};
  TasklaneTestWorker.cloneMessages = true;
  vi.stubGlobal('Worker', TasklaneTestWorker);
});
afterEach(async () => {
  for (const s of sources.splice(0)) s.dispose();
  await Promise.allSettled(runtimes.splice(0).map((r) => r.dispose()));
  await flushTasks();
  vi.unstubAllGlobals();
});
it('binary transport preserves Date attributes and undefined properties', async () => {
  const input = {
    records: [{ when: new Date('2026-09-25T00:00:00Z'), missing: undefined }],
    info: {},
  };
  const result = await decodeWorkerData(encodeWorkerData(input));
  expect(result).toEqual(input);
});
it('shared runtime admits interactive work while Mapshaper runs', async () => {
  const r = runtime();
  const pool = new MapshaperWorkerPool({ workerUrl: 'worker.js', workerRuntime: r });
  const map = pool.run('-clean', { datasets: [] });
  map.catch(() => {});
  await flushTasks();
  const scope = r.createScope('interactive');
  const session = scope.session('geometry');
  const small = taskValue(
    session.enqueue('geometry', {
      priority: 'interactive',
      budget: { inputBytes: 8, outputBytes: 8, scratchBytes: 8 },
      prepare: () => ({ payload: null }),
    }),
  );
  small.catch(() => {});
  await flushTasks();
  try {
    expect(r.stats.active).toBe(2);
  } finally {
    pool.destroy();
    await pool.closed;
    await scope.dispose();
    await Promise.allSettled([map, small]);
  }
});
it('MSDF recovers after abort followed by physical worker failure', async () => {
  const r = runtime();
  const client = new MsdfClient(new URL('https://example.test/msdf.js'), r);
  const ctl = new AbortController();
  const first = client.shape([], ctl.signal).catch((e) => e);
  await flushTasks();
  const worker = TasklaneTestWorker.instances[0];
  ctl.abort();
  await first;
  worker.crash('failure after cooperative abort');
  await flushTasks();
  TasklaneTestWorker.handlers.msdf = () =>
    output({
      result: [],
      stats: { fontBytes: 0, fonts: 0, glyphsGenerated: 0, shapedRuns: 0, heapBytes: 0 },
    });
  const next = await client.shape([], new AbortController().signal).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, code: error.code, message: error.message }),
  );
  client.clear();
  expect(next).toMatchObject({ ok: true });
});
const metadata = {
  filename: 'image.tif',
  fileSize: 8,
  lastModified: 12,
  crs: 'EPSG:4326',
  bounds: [0, 0, 1, 1],
  origin: [0, 1],
  resolution: [1, -1],
  noData: null,
  alphaBand: null,
  bigTiff: false,
  levels: [
    {
      id: 0,
      width: 1,
      height: 1,
      tileWidth: 1,
      tileHeight: 1,
      samples: 1,
      bits: [8],
      formats: [1],
      photometric: 1,
      subfileType: 0,
    },
  ],
};
it('rejects exhausted primary capacity immediately without queueing', async () => {
  TasklaneTestWorker.handlers.raster = (p: any) =>
    output(
      p.type === 'open'
        ? {
            id: 0,
            type: 'metadata',
            metadata,
            directoryBytes: 1000,
            protocolVersion: GEOTIFF_WORKER_PROTOCOL_VERSION,
          }
        : { id: 0, type: 'configured' },
    );
  const r = runtime({ queueTimeoutMs: 40 });
  const observations = [];
  for (let i = 0; i < 9; i++) {
    const result = await openGeoTIFF(
      new File([new Uint8Array(8)], 'image.tif', { lastModified: 12 }),
      { workerRuntime: r, workerUrl: 'https://example.test/raster.js', workerCount: 1 },
    ).then(
      (source) => {
        sources.push(source);
        return { i, ok: true };
      },
      (error) => ({ i, ok: false, code: error.code, message: error.message }),
    );
    observations.push(result);
  }
  expect(observations.slice(0, 8).every((v) => v.ok)).toBe(true);
  expect(observations[8]).toMatchObject({ ok: false, code: 'RASTER_WORKER_CAPACITY' });
  expect(r.stats.queued).toBe(0);
});
it('reports whether ordinary Mapshaper date fields are already packed as binary', async () => {
  const a = getDefaultMapshaperAdapter();
  const dataset = {
    layers: [
      {
        name: 'dates',
        geometry_type: 'point',
        shapes: [[[0, 0]]],
        data: a.createDataTable([{ when: new Date('2026-09-25T00:00:00Z') }]),
      },
    ],
    info: {},
  };
  const packed = await a.exportDatasetsToPack([dataset] as any, { compact: false });
  const result = await a.restoreSessionData(await decodeWorkerData(encodeWorkerData(packed)));
  expect(result.datasets[0].layers[0].data?.getRecords?.()[0].when).toEqual(
    new Date('2026-09-25T00:00:00Z'),
  );
});

it('pre-migration structured-clone path preserves Mapshaper Date values', async () => {
  const a = getDefaultMapshaperAdapter();
  const when = new Date('2026-09-25T00:00:00Z');
  const dataset = {
    layers: [
      {
        name: 'dates',
        geometry_type: 'point',
        shapes: [[[0, 0]]],
        data: a.createDataTable([{ when }]),
      },
    ],
    info: {},
  };
  const packed = await a.exportDatasetsToPack([dataset] as any, { compact: false });
  const restored = await a.restoreSessionData(structuredClone(packed));
  expect(restored.datasets[0].layers[0].data?.getRecords?.()[0].when).toEqual(when);
});
it('GeometryWorker recovers after an idle worker failure', async () => {
  const { GeometryWorker } = await import('../../../src/integrations/luma/geometry-worker');
  const r = runtime();
  TasklaneTestWorker.handlers.geometry = () =>
    output({ result: { geometries: [], screenSpace: false }, cache: { bytes: 0, entries: 0 } });
  const c = new GeometryWorker(new URL('https://example.test/geometry.js'), r);
  const packet = () => ({
    kind: 'point' as const,
    coordinates: Float64Array.from([1, 2]),
    offsets: Uint32Array.from([0, 1]),
    features: Uint32Array.from([0, 1]),
  });
  await c.build(packet(), new AbortController().signal);
  TasklaneTestWorker.instances[0].crash('idle failure');
  await flushTasks();
  const results = [];
  for (let i = 0; i < 2; i++)
    results.push(
      await c.build(packet(), new AbortController().signal).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, code: e.code }),
      ),
    );
  c.dispose();
  expect(results.every((v) => v.ok)).toBe(true);
});
it('fifth GeoTIFF source opens with default two-worker policy', async () => {
  TasklaneTestWorker.handlers.raster = (p: any) =>
    output(
      p.type === 'open'
        ? {
            id: 0,
            type: 'metadata',
            metadata,
            directoryBytes: 1000,
            protocolVersion: GEOTIFF_WORKER_PROTOCOL_VERSION,
          }
        : { id: 0, type: 'configured' },
    );
  const r = runtime({ queueTimeoutMs: 40 });
  const results = [];
  for (let i = 0; i < 5; i++) {
    results.push(
      await openGeoTIFF(new File([new Uint8Array(8)], 'image.tif', { lastModified: 12 }), {
        workerRuntime: r,
        workerUrl: 'https://example.test/raster.js',
        workerCount: 2,
      }).then(
        (s) => {
          sources.push(s);
          return { i, ok: true };
        },
        (e) => ({ i, ok: false, code: e.code }),
      ),
    );
    await flushTasks();
  }
  expect(results.every((v) => v.ok)).toBe(true);
});

it('SessionOwner retries failed cleanup instead of retaining an unreachable scope', async () => {
  const { SessionOwner } = await import('../../../src/integrations/tasklane/runtime');
  let calls = 0;
  TasklaneTestWorker.handlers.msdf = (_p: any, ctx: any) => {
    ctx.cache.setResource('resource', { value: 1 }, 16, () => {
      if (++calls === 1) throw new Error('transient cleanup failure');
    });
    return output(null);
  };
  const r = runtime();
  const owner = new SessionOwner('msdf', 'ignored.js', r);
  await taskValue(
    owner.session.enqueue('msdf', {
      budget: { inputBytes: 8, outputBytes: 8, scratchBytes: 8 },
      prepare: () => ({ payload: null }),
    }),
  );
  const first = await owner.close().then(
    () => ({ ok: true }),
    (error) => ({ ok: false, message: error.message }),
  );
  expect(first.ok).toBe(false);
  const second = await owner.close().then(
    () => ({ ok: true }),
    (error) => ({ ok: false, message: error.message }),
  );
  expect(second.ok).toBe(true);
  expect(calls).toBe(2);
  expect(r.stats.scopes).toBe(0);
});
it('RasterWorkerClient reports idle session loss through its fatal callback', async () => {
  const { RasterWorkerClient } = await import('../../../src/integrations/geotiff/worker-client');
  TasklaneTestWorker.handlers.raster = () => output({ id: 0, type: 'configured' });
  const r = runtime();
  const scope = r.createScope('raster');
  const fatal = vi.fn();
  const client = new RasterWorkerClient(scope.session('geotiff'), undefined, fatal);
  await client.call({ type: 'configure', cacheBytes: 0 });
  TasklaneTestWorker.instances[0].crash('raster idle failure');
  await flushTasks();
  const failures = [];
  for (let i = 0; i < 2; i++)
    failures.push(
      await client.call({ type: 'configure', cacheBytes: 0 }).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, code: e.code }),
      ),
    );
  client.dispose();
  expect(fatal).toHaveBeenCalledOnce();
});

it('admits three full interactive reservations alongside maximum-size Mapshaper work', async () => {
  const r = runtime();
  const pool = new MapshaperWorkerPool({ workerUrl: 'worker.js', workerRuntime: r });
  const jobs: Promise<unknown>[] = [pool.run('-clean', { datasets: [] }).catch((error) => error)];
  await flushTasks();
  const scope = r.createScope('interactive-headroom');
  try {
    for (const [name, task] of [
      ['geometry', 'geometry'],
      ['msdf', 'msdf'],
      ['geotiff', 'raster'],
    ]) {
      jobs.push(
        taskValue(
          scope.session(name).enqueue(task, {
            priority: 'interactive',
            budget: {
              inputBytes: 64 * 1024 ** 2,
              outputBytes: 256 * 1024 ** 2,
              scratchBytes: 256 * 1024 ** 2,
            },
            prepare: () => ({ payload: null }),
          }),
        ).catch((error) => error),
      );
    }
    await flushTasks();
    expect(r.stats.active).toBe(4);
    expect(r.stats.queued).toBe(0);
  } finally {
    pool.destroy();
    await pool.closed;
    await scope.dispose();
    await Promise.all(jobs);
  }
});

it('preserves other budget defaults when only cacheBytes is overridden', async () => {
  const r = runtime({ budgets: { cacheBytes: 4 * 1024 ** 3 } });
  const pool = new MapshaperWorkerPool({ workerUrl: 'worker.js', workerRuntime: r });
  const work = pool.run('-clean', { datasets: [] }).catch((error) => error);
  try {
    await flushTasks();
    expect(r.stats.active).toBe(1);
  } finally {
    pool.destroy();
    await pool.closed;
    await work;
  }
});
it('admits eight concurrent primary readers without optional replicas starving them', async () => {
  TasklaneTestWorker.handlers.raster = (p: any) =>
    output(
      p.type === 'open'
        ? {
            id: 0,
            type: 'metadata',
            metadata,
            directoryBytes: 1000,
            protocolVersion: GEOTIFF_WORKER_PROTOCOL_VERSION,
          }
        : { id: 0, type: 'configured' },
    );
  const r = runtime({ queueTimeoutMs: 100 });
  const opened = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const source = await openGeoTIFF(new File([new Uint8Array(8)], 'image.tif'), {
        workerRuntime: r,
        workerUrl: 'https://example.test/raster.js',
        workerCount: 2,
      });
      sources.push(source);
      return source;
    }),
  );
  expect(opened).toHaveLength(8);
  expect(r.stats.workers).toBe(8);
  expect(r.stats.queued).toBe(0);
});

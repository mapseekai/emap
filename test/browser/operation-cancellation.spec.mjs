import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { basename, resolve } from 'node:path';

const probe = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import * as duckdb from '@duckdb/duckdb-wasm';
      import { createDuckDbRuntimeFromJsDelivr } from './src/integrations/duckdb/runtime.ts';
      export { runPipeline } from './src/integrations/duckdb/core/pipeline.ts';
      export { tableFromArrays } from 'apache-arrow';
      export let database;
      export let streamId;
      export const cancellationAcks = [];
      export function createRuntime(onHeader) {
        class ObservedDatabase extends duckdb.AsyncDuckDB {
          constructor(...args) { super(...args); database = this; }
          async startPendingQuery(id, ...args) {
            const header = await super.startPendingQuery(id, ...args);
            if (header !== null) { streamId = id; onHeader?.(); }
            return header;
          }
          async pollPendingQuery(id) {
            const header = await super.pollPendingQuery(id);
            if (header !== null) { streamId = id; onHeader?.(); }
            return header;
          }
          async cancelPendingQuery(id) {
            const acknowledgement = await super.cancelPendingQuery(id);
            cancellationAcks.push(acknowledgement);
            return acknowledgement;
          }
        }
        const bundle = (name) => ({ mainModule: location.origin + '/duckdb-assets/duckdb-' + name + '.wasm',
          mainWorker: location.origin + '/duckdb-assets/duckdb-browser-' + name + '.worker.js' });
        return createDuckDbRuntimeFromJsDelivr({ duckdb: { ...duckdb, AsyncDuckDB: ObservedDatabase,
          getJsDelivrBundles: () => ({ mvp: bundle('mvp'), eh: bundle('eh') }) } });
      }`,
  },
  bundle: true, format: 'esm', platform: 'browser', write: false,
  external: ['fs', 'path', 'zlib', 'os'],
}).outputFiles[0].text;

test.beforeEach(async ({ page }) => {
  await page.route('**/cancellation-probe.mjs', (route) => route.fulfill({ body: probe, contentType: 'text/javascript' }));
  await page.route('**/cancellation-probe.html', (route) => route.fulfill({ body: '<!doctype html><title>Cancellation probe</title>', contentType: 'text/html' }));
  await page.route('**/duckdb-assets/*', (route) => {
    const name = basename(new URL(route.request().url()).pathname);
    return route.fulfill({ path: resolve('node_modules/@duckdb/duckdb-wasm/dist', name), contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
});

test('real Mapshaper Worker can be terminated per task while another job and a retry complete', async ({ page }) => {
  await page.route(/\/(?:emap|emap-worker|mapshaper-vendor)\.js$/, (route) => route.fulfill({ path: resolve('dist', basename(new URL(route.request().url()).pathname)), contentType: 'text/javascript' }));
  await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  const result = await page.evaluate(async () => {
    const source = new emap.TopologySource('cancel');
    source.setDataset({ layers: [{ name: 'points', geometry_type: 'point', shapes: [[[0, 0]]], data: new mapshaper.internal.DataTable([{ value: 1 }]) }] });
    const packed = await mapshaper.internal.exportDatasetsToPack([source.getDataset()], { compact: false });
    const runtime = emap.createEmapWorkerRuntime({ urls: { mapshaper: new URL('../emap-worker.js', location.href).href }, sizes: { mapshaper: 2 } });
    const pool = new emap.MapshaperWorkerPool({ workerRuntime: runtime, workerUrl: 'unused', poolSize: 2, jobTimeoutMs: 10000 });
    try {
      await pool.run('-each "value = value + 1"', packed);
      const controller = new AbortController();
      const job = pool.runWithId('-each "value = (function(){ while(true){} })()"', packed, undefined, controller.signal);
      const failure = job.promise.then(() => 'completed', (error) => error.name);
      const other = pool.run('-each "value = value + 2"', packed);
      while (runtime.diagnostics().pools[0].running === 0) await new Promise((resolve) => setTimeout(resolve, 10));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const start = performance.now();
      controller.abort();
      await pool.cancel(job.id);
      const cancelled = await failure;
      const otherData = await mapshaper.internal.restoreSessionData(await other);
      const retryData = await mapshaper.internal.restoreSessionData(await pool.run('-each "value = value + 3"', packed, undefined, new AbortController().signal));
      return { cancelled, cancelMs: performance.now() - start, other: otherData.datasets[0].layers[0].data.getRecords()[0].value, retry: retryData.datasets[0].layers[0].data.getRecords()[0].value, leases: runtime.stats.leases, terminations: runtime.stats.workerTerminations, sourceValue: source.getDataset().layers[0].data.getRecords()[0].value };
    } finally { pool.destroy(); await pool.closed; await runtime.dispose(); }
  });
  expect(result).toMatchObject({ cancelled: 'AbortError', other: 3, retry: 4, sourceValue: 1, leases: 0, terminations: 1 });
  expect(result.cancelMs).toBeLessThan(5000);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('real DuckDB-Wasm pending query cancellation cleans tables and leaves other connections usable', async ({ page }) => {
  await page.goto('/cancellation-probe.html');
  const result = await page.evaluate(async () => {
    const { createRuntime, runPipeline, tableFromArrays } = await import('/cancellation-probe.mjs');
    const runtime = await createRuntime();
    const other = await runtime.connect();
    try {
      const controller = new AbortController();
      let queryStarted;
      const started = new Promise((resolve) => { queryStarted = resolve; });
      const operation = runPipeline({
        runtime, signal: controller.signal, label: 'browser cancel', requiresSpatial: false,
        inputs: [{ table: tableFromArrays({ value: [1] }), prefix: 'browser_cancel' }],
        buildSql: ([name]) => { queryStarted(); return 'SELECT sum(sqrt(i::DOUBLE)) FROM "' + name + '", range(1000000000) t(i)'; },
      });
      const failure = operation.then(() => 'completed', (error) => error.name);
      await started;
      await new Promise((resolve) => setTimeout(resolve, 100));
      const before = performance.now();
      const otherQuery = other.query('SELECT 7 AS value', new AbortController().signal);
      controller.abort();
      const cancelled = await failure;
      const cancelMs = performance.now() - before;
      const otherResult = await otherQuery;
      const remaining = await other.query("SELECT count(*)::INT AS count FROM duckdb_tables() WHERE table_name LIKE 'browser_cancel_%'");
      const retry = await runPipeline({ runtime, signal: new AbortController().signal, label: 'retry', requiresSpatial: false, inputs: [], buildSql: () => 'SELECT 9 AS value' });
      return { cancelled, cancelMs, other: Number(otherResult.getChild('value').get(0)), retry: Number(retry.getChild('value').get(0)), tables: Number(remaining.getChild('count').get(0)) };
    } finally { await other.close(); await runtime.close(); }
  });
  expect(result).toMatchObject({ cancelled: 'AbortError', other: 7, retry: 9, tables: 0 });
  expect(result.cancelMs).toBeLessThan(5000);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('direct DuckDB-Wasm cancellation releases unread remote streams and preserves connection state for repeated runs', async ({ page }) => {
  await page.goto('/cancellation-probe.html');
  const result = await page.evaluate(async () => {
    const probe = await import('/cancellation-probe.mjs');
    let active;
    const runtime = await probe.createRuntime(() => {
      if (!active) return;
      const controller = active;
      active = undefined;
      controller.abort();
    });
    const conn = await runtime.connect();
    const other = await runtime.connect();
    const streams = [], failures = [], retries = [], times = [];
    try {
      await conn.query('CREATE TEMP TABLE retained AS SELECT 41 AS value');
      for (let cycle = 0; cycle < 2; cycle++) {
        const controller = new AbortController();
        active = controller;
        const before = performance.now();
        failures.push(await conn.query('SELECT sqrt(i::DOUBLE) FROM range(1000000000) t(i)', controller.signal)
          .then(() => 'delivered', (error) => error.name));
        times.push(performance.now() - before);
        streams.push((await probe.database.fetchQueryResults(probe.streamId))?.length ?? 0);
        const retry = await conn.query('SELECT value FROM retained', new AbortController().signal);
        retries.push(Number(retry.getChild('value').get(0)));
      }
      const sibling = await other.query('SELECT 7 AS value', new AbortController().signal);
      return { streams, failures, retries, times, other: Number(sibling.getChild('value').get(0)), acknowledgements: probe.cancellationAcks };
    } finally {
      await conn.close();
      await other.close();
      await runtime.close();
    }
  });
  expect(result).toMatchObject({ streams: [0, 0], failures: ['AbortError', 'AbortError'], retries: [41, 41], other: 7 });
  expect(result.acknowledgements).toContain(false);
  expect(Math.max(...result.times)).toBeLessThan(5000);
  await expect.poll(() => page.workers().length).toBe(0);
});

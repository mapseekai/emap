import { test, expect } from '@playwright/test';
import { basename, resolve } from 'node:path';

test('native reader cache reports and trimming preserve pixels and release resident leases', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  // Serve the actual public ESM entry and shared chunks, alongside the built IIFE runtime.
  await page.route(/\/(?:emap[^/]*|mapshaper-vendor)\.mjs$/, route => route.fulfill({
    path: resolve('dist', basename(new URL(route.request().url()).pathname)),
    contentType: 'text/javascript',
  }));
  await page.goto('/mapseekai/emap/examples/luma-benchmark/');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  const result = await page.evaluate(async () => {
    const { openGeoTIFF } = await import('../emap-geotiff.mjs');
    const runtime = emap.createEmapWorkerRuntime({ urls: {
      geotiff: new URL('../emap-geotiff-worker.js', location.href).href,
    } });
    let source;
    try {
      const blob = await (await fetch('../fixtures/example-geotiff.tif')).blob();
      source = await openGeoTIFF(new File([blob], 'example-geotiff.tif'), { workerRuntime: runtime, workerCount: 1 });
      const request = { level: 0, window: [0, 0, 32, 32], samples: [0] };
      const before = await source.readWindow(request);
      await source.readWindow(request);
      const warm = runtime.diagnostics().pools.find(pool => pool.name === 'geotiff');
      const trim = await runtime.trim({ pool: 'geotiff', workersPerPool: 1, cacheBytesPerWorker: 128 * 1024 ** 2, reclaimSessions: false });
      const shrunk = runtime.diagnostics().pools.find(pool => pool.name === 'geotiff');
      const after = await source.readWindow(request);
      source.dispose(); await source.settled;
      return {
        hits: warm.resourceCacheStats.hits, misses: warm.resourceCacheStats.misses,
        warmBytes: warm.resources.reduce((sum, r) => sum + r.usedBytes, 0),
        shrunkBytes: shrunk.resources.reduce((sum, r) => sum + r.usedBytes, 0),
        trimFailures: trim.failures,
        equal: before.data.every((band, i) => band.every((v, j) => v === after.data[i][j])),
        workers: runtime.stats.workers, resources: runtime.stats.resourceLeases,
        resident: runtime.stats.reserved.residentBytes,
      };
    } finally { source?.dispose(); await source?.settled; await runtime.dispose(); }
  });
  expect(result.hits).toBeGreaterThan(0);
  expect(result.misses).toBeGreaterThan(0);
  expect(result.warmBytes).toBeGreaterThan(0);
  expect(result).toMatchObject({ shrunkBytes: 0, trimFailures: [], equal: true, workers: 0, resources: 0, resident: 0 });
  expect(errors).toEqual([]);
});

test('Mapshaper binary tasks preserve 50000 point shapes and release borrowed runtime ownership', async ({page}) => {
  await page.goto('/mapseekai/emap/examples/luma-benchmark/');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  const result = await page.evaluate(async () => {
    const source = new emap.TopologySource('worker-fixture');
    await source.setData({filename:'points.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features:Array.from({length:50000},(_,i)=>({type:'Feature',properties:{value:i},geometry:{type:'Point',coordinates:[i/10000,-i/10000]}}))}))});
    const packed = await mapshaper.internal.exportDatasetsToPack([source.getDataset()],{compact:false});
    // Public pool accepts mapshaper sessions; emap ops perform the equivalent CRS sanitization.
    packed.datasets[0].info.crs_string = '+proj=longlat +datum=WGS84 +no_defs';
    const runtime = emap.createEmapWorkerRuntime({urls:{mapshaper:new URL('../emap-worker.js',location.href).href},sizes:{mapshaper:2}});
    const pool = new emap.MapshaperWorkerPool({workerUrl:'unused.js',workerRuntime:runtime,poolSize:2});
    try {
      const outputs = await Promise.all([pool.run('-each "value = value + 1"',packed),pool.run('-each "value = value + 2"',packed)]);
      const restored = await Promise.all(outputs.map(value=>mapshaper.internal.restoreSessionData(value)));
      pool.destroy(); await pool.closed;
      const stillOpen = runtime.createScope('still-open'); await stillOpen.dispose();
      return {counts:restored.map(value=>value.datasets[0].layers[0].shapes.length),last:restored.map(value=>value.datasets[0].layers[0].data.getRecords().at(-1).value),coordinate:restored[0].datasets[0].layers[0].shapes.at(-1)[0],scopes:runtime.stats.scopes,leases:runtime.stats.leases,completed:runtime.stats.completed};
    } finally { pool.destroy(); await pool.closed; await runtime.dispose(); }
  });
  expect(result.counts).toEqual([50000,50000]);
  expect(result.last).toEqual([50000,50001]);
  expect(result.coordinate).toEqual([4.9999,-4.9999]);
  expect(result).toMatchObject({scopes:0,leases:0,completed:2});
  await expect.poll(()=>page.workers().length).toBe(0);
});

test('public map operations retain CRS sanitization, worker events and map-owned disposal', async ({page}) => {
  await page.goto('/mapseekai/emap/examples/web-worker/');
  await expect(page.locator('#clean-btn')).toBeEnabled();
  await page.selectOption('#mode','on');
  await page.locator('#rebuild-btn').click();
  await expect(page.locator('#event-log')).toContainText('useWorker=true');
  await expect(page.locator('#clean-btn')).toBeEnabled();
  await page.locator('#clear-log-btn').click();
  await page.locator('#clean-btn').click();
  await expect(page.locator('#event-log')).toContainText('→ ok');
  await expect(page.locator('#event-log .ok')).toHaveCount(1);
  await expect(page.locator('#event-log .err')).toHaveCount(0);
  expect(page.workers().filter(worker=>worker.url().endsWith('/emap-worker.js'))).toHaveLength(1);
  await page.selectOption('#mode','off');
  await page.locator('#rebuild-btn').click();
  await expect(page.locator('#event-log')).toContainText('useWorker=false');
  await expect.poll(()=>page.workers().filter(worker=>worker.url().endsWith('/emap-worker.js')).length).toBe(0);
});

test('real classic Mapshaper Worker preserves Date fields',async({page})=>{
 await page.goto('/mapseekai/emap/examples/luma-benchmark/');
 await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
 const result=await page.evaluate(async()=>{
  const when=new Date('2026-09-25T00:00:00Z');
  const dataset={layers:[{name:'dates',geometry_type:'point',shapes:[[[0,0]]],data:new mapshaper.internal.DataTable([{when,value:1}])}],info:{crs_string:'+proj=longlat +datum=WGS84 +no_defs'}};
  const packed=await mapshaper.internal.exportDatasetsToPack([dataset],{compact:false});
  const old=await mapshaper.internal.restoreSessionData(structuredClone(packed));
  const oldDate=old.datasets[0].layers[0].data.getRecords()[0].when;
  const runtime=emap.createEmapWorkerRuntime({urls:{mapshaper:new URL('../emap-worker.js',location.href).href}});
  const pool=new emap.MapshaperWorkerPool({workerUrl:'unused.js',workerRuntime:runtime});
  try{
   const response=await pool.run('-each "value = value + 1"',packed);
   const restored=await mapshaper.internal.restoreSessionData(response);const record=restored.datasets[0].layers[0].data.getRecords()[0];
   return {before:{date:oldDate instanceof Date,value:oldDate instanceof Date?oldDate.toISOString():oldDate},after:{date:record.when instanceof Date,value:record.when instanceof Date?record.when.toISOString():record.when},operationResult:record.value};
  }finally{pool.destroy();await pool.closed;await runtime.dispose();}
 });
 console.log('BROWSER_DATE_ROUNDTRIP',JSON.stringify(result));
 expect(result.before).toEqual({date:true,value:'2026-09-25T00:00:00.000Z'});
 expect(result.operationResult).toBe(2);
 expect(result.after).toEqual(result.before);
});

test('large native arc buffers cross the real Worker without detaching the source', async ({ page }) => {
  await page.goto('/mapseekai/emap/examples/luma-benchmark/');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  const result = await page.evaluate(async () => {
    const source = new emap.TopologySource('large-arcs');
    const coordinates = Array.from({ length: 40000 }, (_, i) => [i / 100000, Math.sin(i / 200) / 100]);
    await source.setData({ filename: 'arcs.geojson', content: new TextEncoder().encode(JSON.stringify({
      type: 'FeatureCollection', features: [{ type: 'Feature', properties: { value: 1 }, geometry: { type: 'LineString', coordinates } }],
    })) });
    const packed = await mapshaper.internal.exportDatasetsToPack([source.getDataset()], { compact: false });
    packed.datasets[0].info.crs_string = '+proj=longlat +datum=WGS84 +no_defs';
    const before = source.getArcs().getVertexData().xx;
    const runtime = emap.createEmapWorkerRuntime({ urls: { mapshaper: new URL('../emap-worker.js', location.href).href } });
    const pool = new emap.MapshaperWorkerPool({ workerUrl: 'unused.js', workerRuntime: runtime });
    try {
      const response = await pool.run('-each "value = value + 1"', packed);
      const restored = await mapshaper.internal.restoreSessionData(response);
      const dataset = restored.datasets[0];
      return { sourceBytes: before.byteLength, count: dataset.arcs.getPointCount(), last: dataset.arcs.getVertexData().xx.at(-1), value: dataset.layers[0].data.getRecords()[0].value, leases: runtime.stats.leases };
    } finally { pool.destroy(); await pool.closed; await runtime.dispose(); }
  });
  expect(result).toEqual({ sourceBytes: 320000, count: 40000, last: 0.39999, value: 2, leases: 0 });
});

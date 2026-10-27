import { test, expect } from '@playwright/test';

const route = '/mapseekai/emap/examples/geopackage-viewer/?parameters=open';

test('GeoPackage worker imports all vector tables into one rendered source without external assets', async ({ page }) => {
  const errors = [];
  const wasmUrls = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('.wasm')) wasmUrls.push(request.url()); });
  await page.goto(route);
  await expect(page.locator('#datasets')).toHaveText('1');
  await expect(page.locator('#layers')).toHaveText('4');
  await expect(page.locator('#features')).toHaveText('6');
  await expect(page.locator('#status')).toContainText('Web Worker');
  const result = await page.evaluate(() => {
    const state = window.geopackageDemo;
    const dataset = state.source.getDataset();
    const points = dataset.layers.find(layer => layer.name === 'places');
    return {
      names: dataset.layers.map(layer => layer.name),
      hasTypedArcs: state.source.getArcs().getVertexData().xx instanceof Float64Array,
      crs: state.source.getCRS(),
      id: points.data.getRecords().at(-1).fid,
      point: points.shapes.at(-1)[0],
      metadata: dataset.info.geopackage.tables.length,
      canvasCount: document.querySelectorAll('#map canvas').length,
      sourceSame: state.map.getSource('gpkg') === state.source,
      error: state.error,
    };
  });
  expect(result.names).toEqual(['areas', 'empty_lines', 'places', 'roads']);
  expect(result.hasTypedArcs).toBe(true);
  expect(result.id).toBe('9223372036854775807');
  expect(result.point[0]).toBeCloseTo(116.3456789012345, 10);
  expect(result.point[1]).toBeCloseTo(39.9312345678901, 10);
  expect(result.metadata).toBe(4);
  expect(result.canvasCount).toBeGreaterThan(0);
  expect(result.sourceSame).toBe(true);
  expect(result.error).toBeNull();
  expect(wasmUrls.some(url => url === new URL('../sql-wasm.wasm', page.url()).href)).toBe(true);
  expect(wasmUrls.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(errors).toEqual([]);
});

test('main-thread import matches worker output and repeated imports do not accumulate layers', async ({ page }) => {
  await page.goto(route);
  await expect(page.locator('#layers')).toHaveText('4');
  const before = await page.evaluate(() => window.geopackageDemo.source.getLayers().map(layer => ({ name: layer.name, shapes: layer.shapes, records: layer.data.getRecords() })));
  await page.locator('#worker').uncheck();
  await page.locator('#sample').click();
  await expect(page.locator('#status')).toContainText('主线程 · 完成');
  const after = await page.evaluate(() => window.geopackageDemo.source.getLayers().map(layer => ({ name: layer.name, shapes: layer.shapes, records: layer.data.getRecords() })));
  expect(after).toEqual(before);
  await expect(page.locator('#datasets')).toHaveText('1');
  await expect(page.locator('#layers')).toHaveText('4');
  await page.locator('#worker').check();
  await page.locator('#sample').click();
  await expect(page.locator('#status')).toContainText('Web Worker · 完成');
  await expect(page.locator('#layers')).toHaveText('4');
});

test('cancelling a worker import does not overwrite the previous dataset', async ({ page }) => {
  await page.goto(route);
  await expect(page.locator('#layers')).toHaveText('4');
  // Cancel a genuinely running worker, not a task that has not started yet.
  let pauseReached, releaseResponse, routeFinished;
  const paused = new Promise(resolve => { pauseReached = resolve; });
  const resume = new Promise(resolve => { releaseResponse = resolve; });
  const finished = new Promise(resolve => { routeFinished = resolve; });
  await page.route('**/sql-wasm.wasm', async route => {
    pauseReached();
    try { await resume; await route.continue(); }
    catch { /* cancellation closed the worker request */ }
    finally { routeFinished(); }
  });
  const previous = await page.evaluate(() => window.geopackageDemo.source.getLayers().map(layer => ({ name: layer.name, shapes: layer.shapes, records: layer.data.getRecords() })));
  try {
    await page.locator('#sample').click();
    await paused;
    await expect(page.locator('#cancel')).toBeEnabled();
    await page.locator('#cancel').click();
    await expect(page.locator('#status')).toContainText('已取消');
    releaseResponse();
    await finished;
    await expect(page.locator('#layers')).toHaveText('4');
    await expect(page.locator('#datasets')).toHaveText('1');
    await expect(page.locator('#status')).toContainText('已取消');
    const current = await page.evaluate(() => window.geopackageDemo.source.getLayers().map(layer => ({ name: layer.name, shapes: layer.shapes, records: layer.data.getRecords() })));
    expect(current).toEqual(previous);
  } finally { releaseResponse(); }
});

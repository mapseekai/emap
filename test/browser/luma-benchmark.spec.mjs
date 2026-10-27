import { test, expect } from '@playwright/test';
import { join } from 'node:path';
const gpu=process.env.EMAP_GPU_BACKEND??'webgl';
const route='/mapseekai/emap/examples/luma-benchmark/?parameters=open&gpu='+gpu;
const directory=process.env.EMAP_BENCHMARK_DATA_DIR;
async function ready(page) {
  await page.goto(route);
  await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
}
async function load(page,filename) {
  await page.locator('#file-input').setInputFiles(join(directory,filename));
  await page.locator('#load-file').click();
  await page.waitForFunction(()=>window.lumaBenchmark?.state==='ready' || window.lumaBenchmark?.state==='error',null,{timeout:180000});
  expect(await page.locator('#status').getAttribute('data-state')).toBe('ready');
}
test('starts idle with no generated scene and makes the renderer explicit',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
  expect(await page.evaluate(()=>window.lumaBenchmark.scene)).toBeNull();
  await expect(page.locator('#backend')).toHaveValue('luma');
  expect(await page.evaluate(()=>window.lumaBenchmark.gpuStats.uploads)).toBe(0);
  expect(page.workers()).toHaveLength(0);expect(errors).toEqual([]);
});
test('keeps the user file picker and does not start a benchmark without data',async({page})=>{
  await ready(page);await expect(page.locator('#file-input')).toBeVisible();
  expect(await page.evaluate(()=>window.lumaBenchmark.run(1))).toBeNull();
  await page.locator('#load-file').click();await expect(page.locator('#status')).toContainText('请选择');
});
test('can dispose an empty GPU session without leaving geometry resources',async({page})=>{
  await ready(page);await page.evaluate(()=>window.lumaBenchmark.dispose());
  expect(await page.evaluate(()=>window.lumaBenchmark.gpuStats.liveBufferBytes)).toBe(0);
});
test.describe('authorized real-file lifecycle',()=>{
  test.skip(!directory,'Set EMAP_BENCHMARK_DATA_DIR to the authorized folder; no generated fallback.');
  test.setTimeout(240000);
  test('cancels the 1.83 GiB stream and remains usable for the real point file',async({page})=>{
    await ready(page);await page.locator('#file-input').setInputFiles(join(directory,'big.geojson'));
    await page.locator('#load-file').click();await page.waitForTimeout(100);
    await page.locator('#cancel').click();
    await expect.poll(()=>page.workers().length).toBe(0);
    await load(page,'points.geojson');
    expect(await page.evaluate(()=>window.lumaBenchmark.scene.name)).toBe('points.geojson');
    await page.evaluate(()=>window.lumaBenchmark.dispose());
    await expect.poll(()=>page.workers().length).toBe(0);
  });
  test('real LUCC has pixels, stable cached navigation and no geometry uploads in warm A/B',async({page})=>{
    await ready(page);await load(page,'lucc.geojson');
    await page.evaluate(()=>window.lumaBenchmark.setView(Math.exp(-3.2)));
    const report=await page.evaluate(()=>window.lumaBenchmark.run(8));
    expect(report.scene.name).toBe('lucc.geojson');expect(report.scene.features).toBeGreaterThan(9000);
    expect(report.warmNavigation.geometryUploads).toBe(0);
    expect(report.geometryMode).toBe('full');expect(report.backend).toBe(gpu);
    expect(report.geometry.omitted).toBe(0);expect(report.geometry.fallbackChunks).toBe(0);
    expect(report.geometry.missingChunks).toBe(0);
    expect((await page.evaluate(()=>window.lumaBenchmark.capturePixels())).paintedPixels).toBeGreaterThan(0);
    await page.evaluate(()=>window.lumaBenchmark.dispose());
    expect(await page.evaluate(()=>window.lumaBenchmark.gpuStats.liveBufferBytes)).toBe(0);
  });
});

import {test,expect} from '@playwright/test';
import {join} from 'node:path';
const directory=process.env.EMAP_BENCHMARK_DATA_DIR;
test.describe('existing PointLod in luma using complete authorized point files',()=>{
 test.skip(!directory,'Set EMAP_BENCHMARK_DATA_DIR; no generated throughput dataset.');test.setTimeout(180000);
 for(const gpu of ['webgl','webgpu'])for(const filename of ['points.geojson','pppp.geojson'])test(`${gpu} ${filename}: 3px default, warm reuse, off, cell change, near full, disposal`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open&gpu='+gpu);await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
  await expect(page.locator('#point-lod-enabled')).toBeChecked();await expect(page.locator('#point-lod-cell')).toHaveValue('3');
  await page.locator('#file-input').setInputFiles(join(directory,filename));await page.locator('#load-file').click();
  await page.waitForFunction(()=>['ready','error'].includes(window.lumaBenchmark.state));
  expect(await page.evaluate(()=>window.lumaBenchmark.state)).toBe('ready');
  await page.evaluate(()=>window.lumaBenchmark.setView(Math.exp(-3.2)));
  const first=await page.evaluate(()=>({stats:window.lumaBenchmark.lodStats,lod:window.lumaBenchmark.pointLodStats,
    count:window.lumaBenchmark.scene.vertexCount,original:window.lumaBenchmark.scene.dataset.layers[0].shapes[0]}));
  expect(first.lod.cellSize).toBe(3);expect(first.stats.geometryMode).toBe('point-lod');expect(first.stats.displayVertices).toBeLessThan(first.count/100);
  const report=await page.evaluate(()=>window.lumaBenchmark.run(8));expect(report.pointLod.enabled).toBe(true);
  expect(report.geometryMode).toBe('point-lod');expect(report.warmNavigation.geometryUploads).toBe(0);
  // Pan through already-known world cells and change DPR: no geometry rebuild.
  const before=await page.evaluate(()=>window.lumaBenchmark.pointLodStats.uploads);
  await page.evaluate(()=>window.lumaBenchmark.setView(Math.exp(-3.2),[5,2]));
  expect(await page.evaluate(()=>window.lumaBenchmark.pointLodStats.uploads)).toBe(before);
  // Public configuration rejects invalid input without clearing the valid cache.
  expect(await page.evaluate(async()=>{try{await window.lumaBenchmark.setPointLod(true,0);return false;}catch{return true;}})).toBe(true);
  await page.evaluate(()=>window.lumaBenchmark.setPointLod(true,6));
  expect(await page.evaluate(()=>window.lumaBenchmark.lodStats.displayVertices)).toBeLessThanOrEqual(first.stats.displayVertices);
  await page.evaluate(()=>window.lumaBenchmark.setPointLod(false,3));
  expect(await page.evaluate(()=>window.lumaBenchmark.lodStats.displayVertices)).toBe(first.count);
  expect(await page.evaluate(()=>window.lumaBenchmark.pointLodStats.cacheBytes)).toBe(0);
  await page.evaluate(async()=>{await window.lumaBenchmark.setPointLod(true,3);await window.lumaBenchmark.setView(16);});
  expect(await page.evaluate(()=>window.lumaBenchmark.lodStats.geometryMode)).toBe('full');
  expect(await page.evaluate(()=>window.lumaBenchmark.scene.dataset.layers[0].shapes[0])).toEqual(first.original);
  expect((await page.evaluate(()=>window.lumaBenchmark.capturePixels())).paintedPixels).toBeGreaterThan(0);
  const box=await page.locator('#stage').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  for(let i=0;i<12;i++){await page.mouse.wheel(0,500);await page.waitForTimeout(16);}
  await page.evaluate(()=>window.lumaBenchmark.settle());
  await expect.poll(()=>page.evaluate(()=>window.lumaBenchmark.pointLodStats.pending)).toBe(0);
  // Disposal while a new grid is being prepared must not re-upload stale buffers.
  await page.evaluate(async()=>{const pending=window.lumaBenchmark.setPointLod(true,4);window.lumaBenchmark.dispose();await pending;});
  await expect.poll(()=>page.workers().length).toBe(0);
  expect(await page.evaluate(()=>window.lumaBenchmark.gpuStats.liveBufferBytes)).toBe(0);expect(errors).toEqual([]);
 });
});

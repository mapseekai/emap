import { installCanvasReadback } from './fixtures/canvas-readback.mjs';
import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.beforeEach(async ({page}) => installCanvasReadback(page));

const route = '/mapseekai/emap/examples/geotiff-viewer/';
async function ready(page, renderer) {
  await page.goto(route + (renderer ? "?renderer=" + renderer : ""));
  await expect(page.locator('#levels')).toHaveText('4');
  await expect.poll(() => page.evaluate(() => window.geotiffDemo.stats().cachedBytes)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.geotiffDemo.stats().activeReads + window.geotiffDemo.stats().queuedReads)).toBe(0);
}

test('local TIFF decodes in a classic Worker and paints the existing map canvas', async ({ page }) => {
  const errors = [], workers = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
  await ready(page);
  const result = await page.evaluate(async () => {
    const state = window.geotiffDemo;
    const pixel = await state.map.ctx.raster.queryPixel(state.currentId, 116.005, 39.995);
    const canvases = [...document.querySelectorAll('#map canvas')];
    return {
      pixel, crs: state.metadata.crs, error: state.error, stats: state.stats(),
      painted: (await Promise.all(canvases.map(async canvas => {
        const values = await window.readCanvasPixels(canvas);
        for (let i = 0; i < values.length; i += 4) if (values[i] === 180 && values[i+3] > 0) return true;
        return false;
      }))).some(Boolean),
      canvasCount: canvases.length,
    };
  });
  expect(result.pixel).toEqual([180, 0, 0]);
  expect(result.crs).toBe('EPSG:4326');
  expect(result.painted).toBe(true);
  expect(result.error).toBeNull();
  expect(result.stats.cachedBytes).toBeLessThanOrEqual(32 * 1024 ** 2);
  expect(workers.some(url => url.endsWith('/emap-geotiff-worker.js'))).toBe(true);
  expect(requests.some(request => request.method === 'POST' || request.method === 'PUT')).toBe(false);
  expect(errors).toEqual([]);
});

test('external project references contain no file bytes and removal releases caches', async ({ page }) => {
  await ready(page);
  await page.locator('#save-reference').click();
  const references = JSON.parse(await page.locator('#references').textContent());
  expect(references).toHaveLength(1);
  expect(references[0].source.storage).toBe('external-file');
  expect(Object.keys(references[0].source).sort()).toEqual(['crs', 'fileSize', 'filename', 'format', 'kind', 'lastModified', 'storage']);
  const before = await page.evaluate(() => document.querySelectorAll('#map canvas').length);
  await page.locator('#remove').click();
  await expect.poll(() => page.evaluate(() => window.geotiffDemo.stats().cachedBytes)).toBe(0);
  expect(await page.evaluate(() => window.geotiffDemo.map.ctx.raster.getLayers().length)).toBe(0);
  await page.locator('#sample').click();
  await expect(page.locator('#levels')).toHaveText('4');
  expect(await page.evaluate(() => document.querySelectorAll('#map canvas').length)).toBe(before);
});

test('pan, zoom and display style retain bounded resources', async ({ page }) => {
  await ready(page);
  await page.selectOption('#resampling', 'bilinear');
  await page.locator('#opacity').fill('0.5');
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.geotiffDemo.map.panBy([30, 10], { duration: 0 }));
    await page.waitForTimeout(50);
  }
  await page.locator('#fit').click();
  await expect.poll(() => page.evaluate(() => window.geotiffDemo.stats().activeReads + window.geotiffDemo.stats().queuedReads)).toBe(0);
  const result = await page.evaluate(() => ({ stats: window.geotiffDemo.stats(), error: window.geotiffDemo.error, references: window.geotiffDemo.map.ctx.raster.toReferences() }));
  expect(result.error).toBeNull();
  expect(result.stats.cachedBytes).toBeLessThanOrEqual(32 * 1024 ** 2);
  expect(result.references[0].style.opacity).toBe(0.5);
});

test('a sparse original file above 2GiB is rejected before any pixel decoding', async ({ page }) => {
  await ready(page);
  const directory = await mkdtemp(join(tmpdir(), 'emap-raster-gate-'));
  const filename = join(directory, 'large-no-pyramid.tif');
  try {
    const bytes = new Uint8Array(await readFile(resolve('packages/examples/public/fixtures/example-geotiff.tif')));
    const view = new DataView(bytes.buffer);
    const ifd = view.getUint32(4, true), count = view.getUint16(ifd, true);
    // Disconnect all overview directories while retaining a valid base TIFF.
    view.setUint32(ifd + 2 + count * 12, 0, true);
    const handle = await open(filename, 'w');
    try { await handle.write(bytes); await handle.truncate(2 * 1024 ** 3 + 1); } finally { await handle.close(); }
    const previous = await page.evaluate(() => window.geotiffDemo.currentId);
    await page.locator('#file-input').setInputFiles(filename);
    await page.locator('#load').click();
    await expect(page.locator('#status')).toContainText('PYRAMID_REQUIRED');
    await expect(page.locator('#pyramid-help')).toHaveAttribute('open', '');
    const result = await page.evaluate(() => ({ errorCode: window.geotiffDemo.errorCode, currentId: window.geotiffDemo.currentId, layers: window.geotiffDemo.map.ctx.raster.getLayers().length }));
    expect(result).toEqual({ errorCode: 'PYRAMID_REQUIRED', currentId: previous, layers: 1 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('reprojection preserves the original raster CRS and sampled values', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const state = window.geotiffDemo;
    state.map.ctx.projection.setCRS('EPSG:3857');
    await state.fit();
    const longitude = 116.005, latitude = 39.995;
    const x = longitude * Math.PI / 180 * 6378137;
    const y = Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) * 6378137;
    return { pixel: await state.map.ctx.raster.queryPixel(state.currentId, x, y), sourceCRS: state.metadata.crs, mapCRS: state.map.ctx.view.getCRS(), bounds: await state.map.ctx.raster.getBounds(state.currentId) };
  });
  expect(result.pixel).toEqual([180,0,0]);
  expect(result.sourceCRS).toBe('EPSG:4326');expect(result.mapCRS).toBe('EPSG:3857');
  expect(result.bounds[0]).toBeGreaterThan(12_000_000);
  await expect.poll(() => page.evaluate(() => window.geotiffDemo.stats().activeReads + window.geotiffDemo.stats().queuedReads)).toBe(0);
  expect(await page.evaluate(() => window.geotiffDemo.error)).toBeNull();
});

test('unloading native Cordis providers closes workers and revokes the render pass', async ({ page }) => {
  const errors = [];page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  expect(page.workers().filter(worker => worker.url().endsWith('emap-geotiff-worker.js')).length).toBeGreaterThanOrEqual(1);
  expect(page.workers().filter(worker => worker.url().endsWith('emap-geotiff-worker.js')).length).toBeLessThanOrEqual(2);
  const result = await page.evaluate(async () => {
    const state = window.geotiffDemo;
    const before = document.querySelectorAll('#map canvas').length;
    const service = state.map.ctx.raster;
    await state.loaderFiber.dispose();
    const afterLoader = service.getLayers().length;
    await state.rasterFiber.dispose();
    const afterRaster = service.getStats();
    return { before, afterLoader, afterRaster, canvasCount: document.querySelectorAll('#map canvas').length };
  });
  expect(result.afterLoader).toBe(0);expect(result.afterRaster.cachedBytes).toBe(0);
  expect(result.canvasCount).toBe(result.before);
  await expect.poll(() => page.workers().filter(worker => worker.url().endsWith('emap-geotiff-worker.js')).length).toBe(0);
  expect(errors).toEqual([]);
});


test('cached zoom levels do not multiply layer opacity', async ({ page }) => {
  await ready(page);
  await page.locator('#opacity').fill('0.5');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.geotiffDemo.map.zoomIn());
    await page.waitForTimeout(180);
    await expect.poll(() => page.evaluate(() => window.geotiffDemo.stats().activeReads + window.geotiffDemo.stats().queuedReads)).toBe(0);
  }
  const alpha = await page.evaluate(async () => {
    let maximum = 0;
    for (const canvas of document.querySelectorAll('#map canvas')) {
      const bytes = await window.readCanvasPixels(canvas);
      for(let i=0;i<bytes.length;i+=4) if(Math.abs(bytes[i]-180)<=2) maximum=Math.max(maximum,bytes[i+3]);
    }
    return maximum;
  });
  expect(alpha).toBeGreaterThan(100);
  expect(alpha).toBeLessThanOrEqual(129);
});


async function idleRaster(page) {
  // The metadata/queue can settle before the host's scheduled Canvas frame.
  const renderedFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await renderedFrame();
  await expect.poll(() => page.evaluate(() => {
    const state=window.geotiffDemo,s=state.stats();return Number(state.loading)+s.activeReads+s.queuedReads+s.pendingFrames+(s.interacting?1:0);
  })).toBe(0);
  await renderedFrame();
}
async function rasterPixels() {
  const canvas=document.querySelector('#map canvas');
  const bytes=await window.readCanvasPixels(canvas);
  let count=0,min=255,max=0;
  for(let i=0;i<bytes.length;i+=4)if(bytes[i+3]>0){count++;min=Math.min(min,bytes[i]);max=Math.max(max,bytes[i]);}
  return {count,min,max};
}
for(const [kind,bits,format,first] of [['uint16',16,1,1000],['int16',16,2,-2000],['float32',32,3,1200.5],['float64',64,3,-1200.125]]) {
  test(`${kind} is automatically stretched to visible 8-bit colors without changing samples`,async({page})=>{
    await ready(page);
    await page.selectOption('#sample-type',`example-geotiff-${kind}.tif`);
    await page.locator('#sample').click();
    await expect(page.locator('#metadata')).toContainText(`example-geotiff-${kind}.tif`);
    await expect.poll(()=>page.evaluate(()=>window.geotiffDemo.stats().cachedBytes)).toBeGreaterThan(0);
    await idleRaster(page);
    const result=await page.evaluate(async()=>{
      const s=window.geotiffDemo;
      return {bits:s.metadata.levels[0].bits[0],format:s.metadata.levels[0].formats[0],stats:s.metadata.statistics[0],original:await s.map.ctx.raster.queryPixel(s.currentId,116.005,39.995),error:s.error};
    });
    expect(result.bits).toBe(bits);expect(result.format).toBe(format);expect(result.original).toEqual([first]);expect(result.error).toBeNull();
    const pixels=await page.evaluate(rasterPixels);expect(pixels.count).toBeGreaterThan(1000);expect(pixels.max-pixels.min).toBeGreaterThan(220);
    const before=JSON.stringify(result.stats);
    await page.evaluate(()=>window.geotiffDemo.map.zoomIn());await page.waitForTimeout(200);await idleRaster(page);
    expect(await page.evaluate(()=>JSON.stringify(window.geotiffDemo.metadata.statistics[0]))).toBe(before);
    await page.selectOption('#stretch','minmax');await idleRaster(page);
    const sample=await page.evaluate(async()=>{const s=window.geotiffDemo;return s.map.ctx.raster.queryPixel(s.currentId,116.005,39.995);});
    expect(sample).toEqual([first]);
  });
}

test('continuous real wheel events perform no new tile reads or frame swaps until idle',async({page})=>{
  await ready(page);await idleRaster(page);
  const before=await page.evaluate(()=>window.geotiffDemo.stats());
  await page.mouse.move(700,360);
  for(let i=0;i<8;i++){
    await page.mouse.wheel(0,-25);await page.waitForTimeout(45);
    const stats=await page.evaluate(()=>window.geotiffDemo.stats());
    expect(stats.readRequests).toBe(before.readRequests);expect(stats.committedFrames).toBe(before.committedFrames);
    expect((await page.evaluate(rasterPixels)).count).toBeGreaterThan(1000);
  }
  await expect.poll(()=>page.evaluate(()=>window.geotiffDemo.stats().committedFrames)).toBeGreaterThan(before.committedFrames);
  await idleRaster(page);expect(await page.evaluate(()=>window.geotiffDemo.error)).toBeNull();
});

test('the last complete raster remains visible while a slow provider prepares replacement tiles',async({page})=>{
  await ready(page);await idleRaster(page);
  await page.evaluate(()=>{
    const state=window.geotiffDemo;
    const reference=state.map.ctx.raster.toReferences()[0].source;
    let paused=false;
    const waiting=[];
    window.pauseRasterProvider=()=>{paused=true;};
    window.resumeRasterProvider=()=>{paused=false;for(const resolve of waiting.splice(0))resolve();};
    state.map.ctx.raster.addSource('slow-provider',{
      metadata:state.metadata,
      readWindow:async(request,signal)=>{
        if(paused)await new Promise(resolve=>waiting.push(resolve));
        signal?.throwIfAborted();
        const width=request.window[2]-request.window[0],height=request.window[3]-request.window[1];
        return {width,height,data:request.samples.map(band=>new Uint8Array(width*height).fill([73,125,195][band]))};
      },
      toReference:()=>reference,
      dispose:()=>window.resumeRasterProvider(),
    });
  });
  await expect.poll(()=>page.evaluate(()=>window.geotiffDemo.stats().committedFrames)).toBeGreaterThan(1);
  await idleRaster(page);
  await page.evaluate(()=>{
    const state=window.geotiffDemo;
    state.map.ctx.raster.remove(state.currentId);state.currentId='slow-provider';
  });
  await idleRaster(page);
  const before=await page.evaluate(()=>window.geotiffDemo.stats());
  await page.evaluate(()=>{
    window.pauseRasterProvider();
    const state=window.geotiffDemo;
    const target=new (state.map.getExtent().constructor)(...state.metadata.bounds);
    target.scale(0.4);state.map.fitBounds(target,{padding:0,duration:0});
  });
  await expect.poll(()=>page.evaluate(()=>window.geotiffDemo.stats().pendingFrames)).toBeGreaterThan(0);
  expect((await page.evaluate(rasterPixels)).count).toBeGreaterThan(1000);
  expect((await page.evaluate(()=>window.geotiffDemo.stats())).committedFrames).toBe(before.committedFrames);
  await page.evaluate(()=>window.resumeRasterProvider());
  await idleRaster(page);
  expect((await page.evaluate(()=>window.geotiffDemo.stats())).committedFrames).toBeGreaterThan(before.committedFrames);
  expect(await page.evaluate(()=>window.geotiffDemo.error)).toBeNull();
});


test('RGB defaults can switch to one selected grayscale band and back without changing source values',async({page})=>{
  await ready(page);await idleRaster(page);
  await expect(page.locator('#render-mode')).toHaveValue('rgb');
  await expect(page.locator('#red-band')).toHaveValue('0');
  await expect(page.locator('#green-band')).toHaveValue('1');
  await expect(page.locator('#blue-band')).toHaveValue('2');
  const original=await page.evaluate(async()=>{const s=window.geotiffDemo;return s.map.ctx.raster.queryPixel(s.currentId,116.005,39.995);});
  const initial=await page.evaluate(()=>window.geotiffDemo.stats().committedFrames);
  await page.selectOption('#render-mode','gray');
  await expect(page.locator('#gray-band')).toBeVisible();
  await expect(page.locator('#red-band')).toBeHidden();
  await page.selectOption('#gray-band','1');
  await expect.poll(()=>page.evaluate(()=>window.geotiffDemo.map.ctx.raster.toReferences()[0].style.bands)).toEqual([1]);
  await expect.poll(()=>page.evaluate(()=>window.geotiffDemo.stats().committedFrames)).toBeGreaterThan(initial);
  await idleRaster(page);
  const pixels=await page.evaluate(async()=>{
    const canvas=document.querySelector('#map canvas'),data=await window.readCanvasPixels(canvas);
    let count=0,colored=0,min=255,max=0;
    for(let i=0;i<data.length;i+=4)if(data[i+3]>0){count++;if(data[i]!==data[i+1]||data[i]!==data[i+2])colored++;min=Math.min(min,data[i]);max=Math.max(max,data[i]);}
    return {count,colored,min,max};
  });
  expect(pixels.count).toBeGreaterThan(1000);expect(pixels.colored).toBe(0);expect(pixels.max-pixels.min).toBeGreaterThan(200);
  await page.selectOption('#render-mode','rgb');
  await page.selectOption('#red-band','2');
  await page.selectOption('#blue-band','0');
  await idleRaster(page);
  const result=await page.evaluate(async()=>{const s=window.geotiffDemo;return {bands:s.map.ctx.raster.toReferences()[0].style.bands,pixel:await s.map.ctx.raster.queryPixel(s.currentId,116.005,39.995),error:s.error};});
  expect(result.bands).toEqual([2,1,0]);expect(result.pixel).toEqual(original);expect(result.error).toBeNull();
});

test('single-band numerical files select grayscale automatically and prevent invalid RGB selection',async({page})=>{
  await ready(page);
  await page.selectOption('#sample-type','example-geotiff-float32.tif');await page.locator('#sample').click();
  await expect(page.locator('#metadata')).toContainText('example-geotiff-float32.tif');
  await expect(page.locator('#render-mode')).toHaveValue('gray');
  await expect(page.locator('#render-mode option[value="rgb"]')).toBeDisabled();
  await expect(page.locator('#gray-band option')).toHaveCount(1);
  await expect(page.locator('#gray-band')).toBeVisible();
  await idleRaster(page);
  await expect.poll(async () => (await page.evaluate(rasterPixels)).count).toBeGreaterThan(1000);
  expect(await page.evaluate(()=>window.geotiffDemo.error)).toBeNull();
  await page.selectOption('#sample-type','example-geotiff.tif');await page.locator('#sample').click();
  await expect(page.locator('#render-mode')).toHaveValue('rgb');
  await expect(page.locator('#render-mode option[value="rgb"]')).toBeEnabled();
  await expect(page.locator('#red-band option')).toHaveCount(3);
});


async function stagedRaster(page, transparent, renderer) {
  await ready(page, renderer);await idleRaster(page);
  await page.evaluate(({transparent})=>{
    const state=window.geotiffDemo, metadata={...state.metadata,noData:0};
    const reference=state.map.ctx.raster.toReferences()[0].source;
    let delayed=false,newPhase=false;const pending=[];
    const values=(request,color)=>({width:request.window[2]-request.window[0],height:request.window[3]-request.window[1],data:request.samples.map(band=>new Uint8Array((request.window[2]-request.window[0])*(request.window[3]-request.window[1])).fill(color[band]))});
    if(transparent)state.map.ctx.raster.addSource('lower-layer',{
      metadata:{...metadata,noData:null},readWindow:async request=>values(request,[15,190,35]),
      toReference:()=>reference,dispose:()=>{},
    });
    state.map.ctx.raster.addSource('progressive',{
      metadata,
      readWindow:async(request,signal)=>{
        const isNew=newPhase;
        if(delayed)await new Promise((resolve,reject)=>{
          const entry={resolve:()=>{signal?.removeEventListener('abort',abort);resolve();},reject};
          const abort=()=>{const index=pending.indexOf(entry);if(index>=0)pending.splice(index,1);reject(signal.reason);};
          signal?.addEventListener('abort',abort,{once:true});pending.push(entry);
        });
        signal?.throwIfAborted();
        return values(request,isNew?(transparent?[0,0,0]:[210,50,80]):[73,125,195]);
      },
      toReference:()=>reference,dispose:()=>{for(const entry of pending.splice(0))entry.resolve();},
    },{opacity:0.5,resampling:'bilinear'});
    state.map.ctx.raster.remove(state.currentId);state.currentId='progressive';
    window.progressiveFixture={
      hold:()=>{delayed=true;newPhase=true;},
      releaseOne:()=>pending.shift()?.resolve(),
      releaseAll:()=>{delayed=false;for(const entry of pending.splice(0))entry.resolve();},
      waiting:()=>pending.length,
    };
  },{transparent});
  await expect.poll(()=>page.evaluate(()=>window.geotiffDemo.stats().pendingFrames)).toBe(0);
  await idleRaster(page);await page.waitForTimeout(40);
  const before=await page.evaluate(()=>window.geotiffDemo.stats());
  await page.evaluate(()=>{
    window.progressiveFixture.hold();const state=window.geotiffDemo;
    const target=new (state.map.getExtent().constructor)(...state.metadata.bounds);target.scale(0.4);
    state.map.fitBounds(target,{padding:0,duration:0});
  });
  await expect.poll(()=>page.evaluate(()=>window.progressiveFixture.waiting())).toBeGreaterThan(1);
  return before;
}
async function progressivePixels() {
  // WebGPU presentation textures auto-expire; read the accepted frame in the
  // same task as submission, rather than acquiring a cleared future texture.
  window.geotiffDemo.map.render();
  const canvas=document.querySelector('#map canvas'),bytes=await window.readCanvasPixels(canvas);
  let old=0,fresh=0,background=0,maxAlpha=0;
  for(let i=0;i<bytes.length;i+=4){
    if(Math.abs(bytes[i]-73)<=2 && bytes[i+3]>0)old++;
    if(Math.abs(bytes[i]-210)<=2 && bytes[i+3]>0)fresh++;
    if(Math.abs(bytes[i]-15)<=1 && Math.abs(bytes[i+1]-190)<=1 && Math.abs(bytes[i+2]-35)<=1 && bytes[i+3]===255)background++;
    maxAlpha=Math.max(maxAlpha,bytes[i+3]);
  }
  return {old,fresh,background,maxAlpha};
}

test('a single ready block is displayed before slow siblings, with old coverage and no doubled opacity',async({page})=>{
  const before=await stagedRaster(page,false);
  const presented=await page.evaluate(()=>window.geotiffDemo.stats().presentedTiles);
  await page.evaluate(()=>window.progressiveFixture.releaseOne());
  await expect.poll(()=>page.evaluate(()=>window.geotiffDemo.stats().presentedTiles)).toBeGreaterThan(presented);
  await expect.poll(()=>page.evaluate(progressivePixels).then(p=>p.fresh)).toBeGreaterThan(1000);
  const partial=await page.evaluate(progressivePixels);
  expect(partial.old).toBeGreaterThan(1000);expect(partial.maxAlpha).toBeLessThanOrEqual(129);
  expect((await page.evaluate(()=>window.geotiffDemo.stats())).pendingFrames).toBeGreaterThan(0);
  expect((await page.evaluate(()=>window.geotiffDemo.stats())).committedFrames).toBe(before.committedFrames);
  await page.evaluate(()=>window.progressiveFixture.releaseAll());await idleRaster(page);
  expect((await page.evaluate(progressivePixels)).fresh).toBeGreaterThan(partial.fresh);
  expect(await page.evaluate(()=>window.geotiffDemo.error)).toBeNull();
});

test('a ready NoData block reveals the lower layer instead of the old raster',async({page})=>{
  await stagedRaster(page,true);
  const before=await page.evaluate(progressivePixels);
  await page.evaluate(()=>window.progressiveFixture.releaseOne());
  await expect.poll(()=>page.evaluate(progressivePixels).then(p=>p.background)).toBeGreaterThan(before.background+1000);
  expect((await page.evaluate(()=>window.geotiffDemo.stats())).pendingFrames).toBeGreaterThan(0);
  await page.evaluate(()=>window.progressiveFixture.releaseAll());await idleRaster(page);
  expect(await page.evaluate(()=>window.geotiffDemo.error)).toBeNull();
});

for(const renderer of ['canvas2d','webgl2','webgpu'])test(`${renderer}: fractional DPR and resampled mixed resolutions have no internal transparent seams`,async({browser},info)=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',deviceScaleFactor:1.5,viewport:{width:1311,height:823}});
  const page=await context.newPage();
  await installCanvasReadback(page);
  try{
    await stagedRaster(page,false,renderer);await page.evaluate(()=>window.progressiveFixture.releaseOne());
    await expect.poll(()=>page.evaluate(progressivePixels).then(p=>p.fresh)).toBeGreaterThan(1000);
    const seams=await page.evaluate(async()=>{
      window.geotiffDemo.map.render();
      const canvas=document.querySelector('#map canvas'),bytes=await window.readCanvasPixels(canvas);
      let holes=0,maxAlpha=0;
      for(let y=Math.floor(canvas.height*.35);y<canvas.height*.65;y++)for(let x=Math.floor(canvas.width*.35);x<canvas.width*.65;x++){
        const alpha=bytes[(y*canvas.width+x)*4+3];if(alpha<126)holes++;maxAlpha=Math.max(maxAlpha,alpha);
      }
      return {holes,maxAlpha};
    });
    expect(seams).toEqual({holes:0,maxAlpha:128});
    await page.screenshot({path:info.outputPath('fractional-progressive.png')});
    await page.evaluate(()=>window.progressiveFixture.releaseAll());await idleRaster(page);
  }finally{await context.close();}
});

test('Performance Diagnostics records one settled navigation with worker and host phases', async ({ page }) => {
  await ready(page);
  await page.locator('#performance-reset').click();
  await page.evaluate(() => { const s=window.geotiffDemo; s.map.ctx.raster.setStyle(s.currentId,{stretch:'minmax'}); });
  await expect.poll(() => page.evaluate(() => { const d=window.geotiffDemo.performanceDiagnostics; return Boolean(d?.stable && d.tiles > 0 && d.phasesMs.workerTotal > 0); })).toBe(true);
  const diagnostics = await page.evaluate(() => window.geotiffDemo.performanceDiagnostics);
  expect(diagnostics.elapsedMs).toBeGreaterThan(0);
  expect(diagnostics.logicalCores).toBeGreaterThan(0);
  expect(diagnostics.viewport[0]).toBeGreaterThan(0);
  expect(diagnostics.workers).toBeGreaterThan(0);
  expect(diagnostics.tiles).toBeGreaterThan(0);
  expect(diagnostics.phasesMs.workerTotal).toBeGreaterThan(0);
  expect(diagnostics.phasesMs.colorize).toBeGreaterThan(0);
  expect(diagnostics.phasesMs.canvasUpload).toBeGreaterThanOrEqual(0);
  expect(diagnostics.io.blockCache.hits + diagnostics.io.blockCache.misses).toBeGreaterThan(0);
  expect(diagnostics.planning.passes).toBeGreaterThan(0);
  expect(diagnostics.planning.plannedTiles).toBeGreaterThanOrEqual(diagnostics.planning.current.layers[0].tiles);
  expect(diagnostics.planning.current.layers[0].grid[0] * diagnostics.planning.current.layers[0].grid[1]).toBe(diagnostics.planning.current.layers[0].tiles);
  expect(diagnostics.planning.current.layers[0].tiles).toBeLessThanOrEqual(diagnostics.planning.current.tileBudgetPerLayer);
  expect(diagnostics.io.blockCache.capacityMiB).toBeGreaterThan(0);
  expect(diagnostics.io.blockCache.peakMiB).toBeLessThanOrEqual(diagnostics.io.blockCache.capacityMiB);
  expect(diagnostics.io.blockCache.evictions).toBeGreaterThanOrEqual(0);
  expect(diagnostics.io.blockCache.evictedMiB).toBeGreaterThanOrEqual(0);
  expect(JSON.parse(await page.locator('#performance-output').textContent())).toEqual(diagnostics);
});

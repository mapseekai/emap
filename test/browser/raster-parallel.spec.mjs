import { test, expect } from '@playwright/test';
const route='/mapseekai/emap/examples/geotiff-viewer/';
async function idle(page){
  await expect.poll(()=>page.evaluate(()=>{
    const s=window.geotiffDemo,v=s.stats();return Number(s.loading)+v.activeReads+v.queuedReads+v.pendingFrames+Number(v.interacting);
  })).toBe(0);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function installProbe(page){
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>8});
    const NativeWorker=Worker;
    const events={created:0,renderWorkers:[],rawResults:0,rendered:0,invalidResults:0,peak:0,active:0};
    window.rasterParallelProbe=events;
    window.Worker=class extends NativeWorker{
      identity=++events.created;
      renders=new Set();
      constructor(...args){
        super(...args);
        this.addEventListener('message',({data})=>{
          if(this.renders.delete(data.id))events.active--;
          if(data.type==='result')events.rawResults++;
          if(data.type==='rendered'){
            events.rendered++;
            if(!events.renderWorkers.includes(this.identity))events.renderWorkers.push(this.identity);
            const result=data.result;
            if(!(result.rgba instanceof Uint8ClampedArray)||result.rgba.byteLength!==result.width*result.height*4||'data' in result)events.invalidResults++;
          }
        });
      }
      postMessage(message,...args){
        if(message.type==='render'){this.renders.add(message.id);events.active++;events.peak=Math.max(events.peak,events.active);}
        super.postMessage(message,...args);
      }
    };
  });
}

test('two independent Workers decode and colorize while the UI receives only final RGBA',async({page})=>{
  await installProbe(page);await page.goto(route);
  await expect(page.locator('#levels')).toHaveText('4');await idle(page);
  const probe=await page.evaluate(()=>({events:window.rasterParallelProbe,processing:window.geotiffDemo.processing()}));
  expect(probe.events.renderWorkers).toHaveLength(2);
  expect(probe.events.rawResults).toBe(0);
  expect(probe.events.invalidResults).toBe(0);
  expect(probe.processing).toMatchObject({workers:2,busyWorkers:0,peakWorkers:2,reservedBytes:0});
  expect(probe.processing.renderedTiles).toBeGreaterThan(1);
  const threads=await Promise.all(page.workers().filter(w=>w.url().endsWith('emap-geotiff-worker.js')).map(w=>w.evaluate(()=>({name:self.name,hasDocument:typeof document!=='undefined'}))));
  expect(new Set(threads.map(t=>t.name)).size).toBe(2);
  expect(threads.every(t=>!t.hasDocument)).toBe(true);
  await page.evaluate(()=>window.geotiffDemo.map.dispose());
  await expect.poll(()=>page.workers().filter(w=>w.url().endsWith('emap-geotiff-worker.js')).length).toBe(0);
});

test('off-thread RGB, grayscale and bilinear keep original samples and bounded reservations',async({page})=>{
  await installProbe(page);await page.goto(route);
  await expect(page.locator('#levels')).toHaveText('4');await idle(page);
  for(const filename of ['example-geotiff.tif','example-geotiff-uint16.tif','example-geotiff-float32.tif']){
    await page.selectOption('#sample-type',filename);await page.locator('#sample').click();
    await expect(page.locator('#metadata')).toContainText(filename);await idle(page);
    const before=await page.evaluate(async()=>{const s=window.geotiffDemo;return s.map.ctx.raster.queryPixel(s.currentId,116.005,39.995);});
    await page.selectOption('#resampling','bilinear');await idle(page);
    await page.selectOption('#render-mode','gray');await idle(page);
    const result=await page.evaluate(async()=>{const s=window.geotiffDemo;return {error:s.error,pixel:await s.map.ctx.raster.queryPixel(s.currentId,116.005,39.995),processing:s.processing()};});
    expect(result.error).toBeNull();expect(result.pixel).toEqual(before);
    expect(result.processing.workers).toBeLessThanOrEqual(2);expect(result.processing.reservedBytes).toBeLessThanOrEqual(64*1024**2);
  }
});

test('rapid navigation and repeated removal release every pool worker',async({page})=>{
  await installProbe(page);await page.goto(route);await expect(page.locator('#levels')).toHaveText('4');await idle(page);
  for(let cycle=0;cycle<5;cycle++){
    for(let i=0;i<5;i++)await page.evaluate(()=>{const s=window.geotiffDemo;s.map.panBy([35,-10],{duration:0});});
    await page.locator('#remove').click();
    await expect.poll(()=>page.workers().filter(w=>w.url().endsWith('emap-geotiff-worker.js')).length).toBe(0);
    expect(await page.evaluate(()=>window.geotiffDemo.stats().cachedBytes)).toBe(0);
    await page.locator('#sample').click();await expect(page.locator('#levels')).toHaveText('4');await idle(page);
    expect(await page.evaluate(()=>window.geotiffDemo.error)).toBeNull();
    expect(page.workers().filter(w=>w.url().endsWith('emap-geotiff-worker.js')).length).toBeLessThanOrEqual(2);
  }
});

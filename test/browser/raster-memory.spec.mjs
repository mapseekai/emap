import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const route='/mapseekai/emap/examples/geotiff-viewer/?parameters=open';
async function ready(page){
  await page.goto(route);
  await expect(page.locator('#levels')).toHaveText('4');
  await expect.poll(()=>page.evaluate(()=>{const s=window.geotiffDemo.stats();return s.activeReads+s.queuedReads+s.pendingFrames+Number(s.interacting);})).toBe(0);
}
async function collect(cdp){
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
}

test('removed GeoTIFF metadata is collectible while its loader plugin remains mounted',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Requires explicit Chromium GC to test weak references deterministically');
  await ready(page);
  const baselineWorkers=page.workers().filter(worker=>worker.url().endsWith('emap-geotiff-worker.js')).length;
  const cdp=await page.context().newCDPSession(page);
  try{
    await page.evaluate(async()=>{
      const state=window.geotiffDemo;
      window.rasterMemoryRefs=[];
      for(let i=0;i<12;i++){
        const metadata=await state.map.ctx.geoTIFF.addFile(`memory-${i}`,state.file);
        window.rasterMemoryRefs.push(new WeakRef(metadata));
        state.map.ctx.raster.remove(`memory-${i}`);
      }
    });
    await collect(cdp);
    const alive=await page.evaluate(()=>window.rasterMemoryRefs.filter(ref=>ref.deref()).length);
    expect(alive).toBe(0);
    await expect.poll(()=>page.workers().filter(worker=>worker.url().endsWith('emap-geotiff-worker.js')).length).toBe(baselineWorkers);
  }finally{await cdp.detach();}
});


test('repeated local raster load, navigation and removal returns memory and native resources to baseline',async({page,browserName},testInfo)=>{
  test.skip(browserName!=='chromium','The heap check requires Chromium CDP');
  test.setTimeout(120000);
  await ready(page);
  await page.locator('#remove').click();
  const cdp=await page.context().newCDPSession(page);
  try{
    await page.evaluate(async()=>{
      const response=await fetch('/mapseekai/emap/examples/fixtures/example-geotiff.tif');
      window.memoryFixture=new File([await response.blob()],'memory.tif');
      window.memoryWeakRefs=[];
      const create=document.createElement.bind(document);
      window.restoreCanvasObserver=()=>{document.createElement=create;};
      document.createElement=function(name,...args){
        const node=create(name,...args);
        if(name==='canvas')window.memoryWeakRefs.push(new WeakRef(node));
        return node;
      };
      window.memoryCycle=async(index)=>{
        const state=window.geotiffDemo,map=state.map;
        const metadata=await map.ctx.geoTIFF.addFile(`cycle-${index}`,window.memoryFixture);
        window.memoryWeakRefs.push(new WeakRef(metadata));
        const Bounds=map.getExtent().constructor;
        for(const factor of [1,0.45]){
          const before=map.ctx.raster.getStats().committedFrames;
          const bounds=new Bounds(...metadata.bounds);bounds.scale(factor);
          map.fitBounds(bounds,{padding:24,duration:0});
          const start=performance.now();
          while(true){
            const s=map.ctx.raster.getStats();
            if(!s.interacting&&!s.activeReads&&!s.queuedReads&&!s.pendingFrames&&s.committedFrames>before)break;
            if(performance.now()-start>10000)throw new Error('Raster failed to reach idle during memory cycle');
            await new Promise(resolve=>setTimeout(resolve,10));
          }
        }
        map.ctx.raster.remove(`cycle-${index}`);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const stats=map.ctx.raster.getStats();
        if(stats.cachedBytes||stats.cachedTiles||stats.activeReads||stats.queuedReads||stats.pendingFrames)throw new Error('Resources remain after raster removal');
      };
    });
    for(let i=0;i<3;i++)await page.evaluate(index=>window.memoryCycle(index),i);
    const measure=async(label)=>{
      await expect.poll(()=>page.workers().filter(worker=>worker.url().endsWith('emap-geotiff-worker.js')).length).toBe(0);
      await collect(cdp);
      const heap=await cdp.send('Runtime.getHeapUsage');
      const dom=await cdp.send('Memory.getDOMCounters');
      const local=await page.evaluate(()=>({
        alive:window.memoryWeakRefs.filter(ref=>ref.deref()).length,
        tracked:window.memoryWeakRefs.length,
        listeners:Object.values(window.geotiffDemo.map.ctx.mapEvents._listeners).reduce((n,list)=>n+list.length,0),
        stats:window.geotiffDemo.stats(),
      }));
      return {label,heap,dom,...local};
    };
    const samples=[await measure('warmup-3')];
    for(let round=0;round<3;round++){
      for(let i=0;i<10;i++)await page.evaluate(index=>window.memoryCycle(index),3+round*10+i);
      samples.push(await measure(`after-${(round+1)*10}`));
    }
    await testInfo.attach('raster-memory-samples.json',{body:JSON.stringify(samples,null,2),contentType:'application/json'});
    console.log('RASTER_MEMORY_SAMPLES',JSON.stringify(samples));
    for(const sample of samples){
      expect(sample.alive).toBe(0);
      expect(sample.listeners).toBe(samples[0].listeners);
      expect(sample.dom.nodes).toBeLessThanOrEqual(samples[0].dom.nodes+10);
      expect(sample.heap.usedSize).toBeLessThan(samples[0].heap.usedSize+3*1024**2);
      expect(sample.stats.cachedBytes).toBe(0);
    }
    await page.evaluate(()=>{window.restoreCanvasObserver();delete window.memoryCycle;delete window.memoryFixture;delete window.memoryWeakRefs;delete window.restoreCanvasObserver;});
  }finally{await cdp.detach();}
});

test('restarting raster providers does not accumulate event listeners, render hooks or workers',async({page,browserName},testInfo)=>{
  test.skip(browserName!=='chromium','The object-collection assertion requires explicit Chromium GC');
  await ready(page);
  await page.locator('#remove').click();
  const cdp=await page.context().newCDPSession(page);
  try{
    const report=await page.evaluate(async()=>{
      const state=window.geotiffDemo;
      const counts=()=>({listeners:Object.values(state.map.ctx.mapEvents._listeners).reduce((n,list)=>n+list.length,0),passes:state.map.ctx.render._passes.size});
      const baseline=counts();const cycles=[];window.rasterServiceRefs=[];
      for(let i=0;i<15;i++){
        window.rasterServiceRefs.push(new WeakRef(state.map.ctx.raster));
        await state.rasterFiber.restart();await state.rasterFiber.await();await state.loaderFiber.await();
        cycles.push(counts());
      }
      return {baseline,cycles};
    });
    await collect(cdp);
    const alive=await page.evaluate(()=>window.rasterServiceRefs.filter(ref=>ref.deref()).length);
    console.log('RASTER_RESTART_MEMORY',JSON.stringify({...report,alive}));
    for(const value of report.cycles)expect(value).toEqual(report.baseline);
    expect(alive).toBe(0);
    expect(page.workers().filter(worker=>worker.url().endsWith('emap-geotiff-worker.js'))).toHaveLength(0);
    await testInfo.attach('raster-plugin-restarts.json',{body:JSON.stringify({...report,alive},null,2),contentType:'application/json'});
  }finally{await cdp.detach();}
});


test('an externally retained never-settling read cannot keep a disposed raster renderer alive',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Requires explicit Chromium GC');
  await ready(page);const cdp=await page.context().newCDPSession(page);
  try{
    await page.evaluate(()=>{
      const state=window.geotiffDemo,service=state.map.ctx.raster;
      window.neverSettlingRasterRead=new Promise(()=>{});
      window.stuckRendererRef=new WeakRef(service);
      service.addSource('uncooperative',{metadata:state.metadata,readWindow:()=>window.neverSettlingRasterRead,toReference:()=>state.map.ctx.raster.toReferences()[0].source,dispose:()=>{}});
    });
    await expect.poll(()=>page.evaluate(()=>window.geotiffDemo.stats().activeReads)).toBeGreaterThan(0);
    await page.evaluate(async()=>{await window.geotiffDemo.rasterFiber.dispose();});
    await collect(cdp);
    expect(await page.evaluate(()=>!!window.stuckRendererRef.deref())).toBe(false);
    await expect.poll(()=>page.workers().filter(worker=>worker.url().endsWith('emap-geotiff-worker.js')).length).toBe(0);
  }finally{await cdp.detach();}
});

test('map disposal closes its loaded raster and unregisters raster render resources',async({page,browserName},testInfo)=>{
  test.skip(browserName!=='chromium','Requires explicit Chromium GC');
  await ready(page);const cdp=await page.context().newCDPSession(page);
  try{
    const after=await page.evaluate(async()=>{
      const state=window.geotiffDemo,service=state.map.ctx.raster,render=state.map.ctx.render;
      window.disposedRendererRef=new WeakRef(service);
      const canvases=[...document.querySelectorAll('#map canvas')];
      await state.map.dispose();
      return {stats:service.getStats(),layers:service.getLayers().length,passes:render._passes.size,canvasSizes:canvases.map(canvas=>[canvas.width,canvas.height])};
    });
    expect(after.layers).toBe(0);expect(after.passes).toBe(0);
    expect(after.canvasSizes.every(size=>size[0]===0&&size[1]===0)).toBe(true);
    for(const name of ['cachedBytes','cachedTiles','activeReads','queuedReads','pendingFrames'])expect(after.stats[name]).toBe(0);
    await expect.poll(()=>page.workers().filter(worker=>worker.url().endsWith('emap-geotiff-worker.js')).length).toBe(0);
    await collect(cdp);
    const alive=await page.evaluate(()=>!!window.disposedRendererRef.deref());
    if(alive){
      await page.evaluate(()=>{window.disposedRendererRef.deref().__rasterLeakSentinel=true;});
      const chunks=[];const chunk=event=>chunks.push(event.chunk);
      cdp.on('HeapProfiler.addHeapSnapshotChunk',chunk);
      await cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false});
      cdp.off('HeapProfiler.addHeapSnapshotChunk',chunk);
      const snapshotPath=testInfo.outputPath('disposed-raster.heapsnapshot');
      await writeFile(snapshotPath,chunks.join(''));
      await testInfo.attach('disposed-raster.heapsnapshot',{path:snapshotPath,contentType:'application/json'});
    }
    expect(alive).toBe(false);
  }finally{await cdp.detach();}
});

import { test, expect } from '@playwright/test';
import { join } from 'node:path';
const directory = process.env.EMAP_BENCHMARK_DATA_DIR;
for (const gpu of ['webgl', 'webgpu']) for (const file of ['big.geojson','lucc.geojson']) {
  test(`${gpu} ${file}: near-to-far uses screen paths and resident fills after eviction`, async ({page}, info) => {
    test.skip(!directory, 'Requires the complete authorized real file.');test.setTimeout(180000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open&gpu='+gpu+'&pointLod=off');
    await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle',null,{timeout:60000});
    await page.locator('#file-input').setInputFiles(join(directory,file));await page.locator('#load-file').click();
    await page.waitForFunction(()=>['ready','error'].includes(window.lumaBenchmark.state),null,{timeout:120000});
    expect(await page.evaluate(()=>window.lumaBenchmark.state)).toBe('ready');
    await page.evaluate(()=>window.lumaBenchmark.setView(16));
    await page.waitForFunction(()=>{const a=window.lumaBenchmark;return a.navigationStats.ready&&!a.navigationStats.pending&&!a.screenFilterStats.pending;});
    const before=await page.evaluate(()=>({cache:window.lumaBenchmark.cacheDiagnostics,geometry:window.lumaBenchmark.lodStats,nav:window.lumaBenchmark.navigationStats}));
    expect(before.geometry.evictions).toBeGreaterThan(0);
    expect(before.geometry.cacheBytes).toBeLessThanOrEqual(before.cache.budgetBytes);
    const box=await page.locator('#stage').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    const start=Date.now();for(let i=0;i<15;i++){await page.mouse.wheel(0,400);await page.waitForTimeout(16);}
    const release=Date.now();
    await page.waitForFunction(count=>{const a=window.lumaBenchmark,n=a.navigationStats;return n.captures>count&&!n.pending&&!n.active&&!a.screenFilterStats.pending&&!a.lodStats.missingChunks&&!a.lodStats.pending;},before.nav.captures,{timeout:15000});
    const latency=Date.now()-release;
    const after=await page.evaluate(()=>({cache:window.lumaBenchmark.cacheDiagnostics,geometry:window.lumaBenchmark.lodStats,screen:window.lumaBenchmark.screenFilterStats,nav:window.lumaBenchmark.navigationStats}));
    expect(after.cache.lineBuilds).toBe(before.cache.lineBuilds);expect(after.cache.fillBuilds).toBe(before.cache.fillBuilds);
    expect(after.geometry.visibleChunks).toBe(after.geometry.totalChunks);
    expect(after.geometry.missingChunks).toBe(0);expect(after.screen.applied).toBe(true);
    // Read the bitmap captured at natural frame completion (WebGPU post-presentation reads may be blank), before an independent, raw-cache-warmed full redraw.
    const actual=await page.evaluate(async()=>{
      const bitmap=await createImageBitmap(document.querySelector('.luma-nav-preview')),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
      const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const p=ctx.getImageData(0,0,c.width,c.height).data;
      let hash=2166136261,painted=0;for(let i=0;i<p.length;i++){hash=Math.imul(hash^p[i],16777619);if(i%4===3&&p[i])painted++;}return{hash:hash>>>0,painted};
    });
    expect(actual.painted).toBeGreaterThan(0);
    await page.evaluate(()=>window.lumaBenchmark.runScreen(1));
    const reference=await page.evaluate(()=>window.lumaBenchmark.captureScreenPixels());
    expect(actual.hash).toBe(reference.hash);
    // Supersede a zoom-out with a zoom-in while filtering is queued. Latest view wins.
    await page.mouse.wheel(0,400);await page.mouse.wheel(0,-200);
    await page.waitForTimeout(250);
    await page.waitForFunction(()=>{const a=window.lumaBenchmark;return !a.navigationStats.pending&&!a.navigationStats.active&&!a.screenFilterStats.pending;},null,{timeout:15000});
    const state=await page.evaluate(()=>({view:window.lumaBenchmark.view,frame:window.lumaBenchmark.navigationStats.frame}));
    expect(state.frame).toEqual(state.view);
    await info.attach('zoom-out',{body:JSON.stringify({file,gpu,latency,gestureMs:release-start,before,after,actual,reference:{hash:reference.hash}}),contentType:'application/json'});
    await page.evaluate(()=>window.lumaBenchmark.dispose());await expect.poll(()=>page.workers().length).toBe(0);
    expect(await page.evaluate(()=>window.lumaBenchmark.gpuStats.liveBufferBytes)).toBe(0);expect(errors).toEqual([]);
  });
}

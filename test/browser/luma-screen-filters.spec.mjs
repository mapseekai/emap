import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
const directory=process.env.EMAP_BENCHMARK_DATA_DIR;
async function digest(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
async function load(page,file,backend){
 await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open&gpu='+backend+'&pointLod=off&screenFilter=on');
 await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle',null,{timeout:60000});
 await page.locator('#fast-nav').uncheck();
 await page.locator('#file-input').setInputFiles(join(directory,file));await page.locator('#load-file').click();
 await page.waitForFunction(()=>['ready','error'].includes(window.lumaBenchmark.state),null,{timeout:240000});
 expect(await page.evaluate(()=>window.lumaBenchmark.state),await page.locator('#status').textContent()).toBe('ready');
}
for(const backend of ['webgl','webgpu'])for(const file of ['big.geojson','lucc.geojson','building.geojson','points.geojson','pppp.geojson']){
 test(`${backend} ${file}: Canvas screen filters on original data`,async({page},info)=>{
  test.skip(!directory,'Provide original authorized data directory; no generated replacement.');test.setTimeout(300000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const hash=await digest(join(directory,file)),start=Date.now();await load(page,file,backend);
  const record={backend,file,sha256:hash,readyMs:Date.now()-start,source:await page.evaluate(()=>({features:window.lumaBenchmark.scene.featureCount,vertices:window.lumaBenchmark.scene.vertexCount})),views:[]};
  for(const [view,scale]of [['fit',1],['far',Math.exp(-3.2)],['near',16]]){
   await page.evaluate(scale=>window.lumaBenchmark.setView(scale),scale);
   await page.evaluate(()=>window.lumaBenchmark.warmScreen());
   const result=await page.evaluate(async()=>{
    const api=window.lumaBenchmark;
    const measure=async(draw)=>{
     for(let i=0;i<4;i++){draw();await new Promise(requestAnimationFrame);}
     const before={...api.gpuStats},gaps=[],cpu=[];let previous=await new Promise(requestAnimationFrame);
     for(let i=0;i<12;i++){const st=performance.now();draw();cpu.push(performance.now()-st);const now=await new Promise(requestAnimationFrame);gaps.push(now-previous);previous=now;}
     return{fps:1000/(gaps.reduce((a,b)=>a+b,0)/gaps.length),cpuMeanMs:cpu.reduce((a,b)=>a+b,0)/cpu.length,gaps,cpu,uploads:api.gpuStats.uploads-before.uploads,drawCalls:api.gpuStats.drawCalls-before.drawCalls,geometry:{...api.lodStats},filter:{...api.screenFilterStats}};
    };
    const raw=await measure(()=>api.draw('luma'));const screen=await measure(()=>api.drawScreen('luma'));const canvas=await measure(()=>api.drawScreen('canvas'));
    const pixels=await api.captureScreenPixels('luma');
    return {raw,screen,canvas,pixels};
   });
   result.view=view;record.views.push(result);
   expect(result.pixels.painted).toBeGreaterThan(0);expect(result.screen.uploads).toBe(0);expect(result.screen.geometry.missingChunks).toBe(0);
   if(!file.includes('points')&&file!=='pppp.geojson'){
    expect(result.screen.filter.applied).toBe(true);expect(result.screen.filter.rawFallbackChunks).toBe(0);
    if(view!=='near'){expect(result.screen.filter.duplicateVertices).toBeGreaterThan(0);expect(result.screen.geometry.submittedSegments).toBeLessThan(result.raw.geometry.submittedSegments);}
   }else{expect(result.screen.geometry.displayVertices).toBe(result.raw.geometry.displayVertices);expect(result.screen.filter.applied).toBe(false);}
  }
  if(file==='big.geojson'){
   const ab=await page.evaluate(()=>window.lumaBenchmark.runScreen(4));
   expect(ab.benchmarkMode).toBe('screen-filtered-fixed-view');expect(ab.screenFiltering.applied).toBe(true);
   expect(ab.warmNavigation.geometryUploads).toBe(0);expect(ab.results.luma.samples).toBe(8);
   await page.evaluate(()=>window.lumaBenchmark.setView(1));
   const combos=[];
   for(const [small,half]of [[false,false],[true,false],[false,true],[true,true]]){
    await page.evaluate(([a,b])=>window.lumaBenchmark.setScreenFilters(a,b),[small,half]);
    const p=await page.evaluate(()=>window.lumaBenchmark.captureScreenPixels());expect(p.painted).toBeGreaterThan(0);combos.push(p.filters);
   }
   record.switches=combos;expect(combos[1].duplicateVertices).toBe(0);expect(combos[2].tinyArcs).toBe(0);
   // A new pan/DPR must not reuse absolute screen coordinates from the previous view.
   await page.setViewportSize({width:1320,height:940});await page.evaluate(()=>window.lumaBenchmark.settle());
   const p=await page.evaluate(()=>window.lumaBenchmark.captureScreenPixels());expect(p.painted).toBeGreaterThan(0);
   await page.locator('#fast-nav').check();await page.evaluate(()=>window.lumaBenchmark.settle());
   await expect.poll(()=>page.evaluate(()=>window.lumaBenchmark.navigationStats.ready)).toBe(true);
   const box=await page.locator('#stage').boundingBox();const before=await page.evaluate(()=>window.lumaBenchmark.gpuStats.uploads);
   await page.mouse.move(box.x+200,box.y+200);await page.mouse.down();await page.mouse.move(box.x+280,box.y+230,{steps:16});
   expect(await page.evaluate(()=>window.lumaBenchmark.gpuStats.uploads)).toBe(before);
   await page.mouse.up();await page.evaluate(()=>window.lumaBenchmark.settle());
   expect((await page.evaluate(()=>window.lumaBenchmark.captureScreenPixels())).painted).toBeGreaterThan(0);
  }
  await page.screenshot({path:info.outputPath(file+'-'+backend+'-screen.png')});
  await page.evaluate(()=>window.lumaBenchmark.dispose());await expect.poll(()=>page.workers().length).toBe(0);
  expect(await page.evaluate(()=>window.lumaBenchmark.gpuStats.liveBufferBytes)).toBe(0);
  record.sourceUnchanged=hash===await digest(join(directory,file));expect(record.sourceUnchanged).toBe(true);expect(errors).toEqual([]);record.errors=errors;
  console.log('SCREEN_FILTER_REAL',JSON.stringify(record));await info.attach('screen-filter-result',{body:JSON.stringify(record,null,2),contentType:'application/json'});
 });
}

import {test,expect} from '@playwright/test';
import {installCanvasReadback} from './fixtures/canvas-readback.mjs';
const base='/mapseekai/emap/examples/';
async function scene(page,renderer,screenPathFiltering=false,icons=false){
 await installCanvasReadback(page);
 await page.goto(base+'luma-benchmark/');await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
 await page.evaluate(async({renderer,screenPathFiltering,icons})=>{
  lumaBenchmark.dispose();document.body.replaceChildren();const host=document.createElement('div');host.id='chunk-map';host.style.cssText='position:fixed;inset:0;width:800px;height:600px;background:white';document.body.append(host);
  window.chunkMap=await emap.Emap.create({container:host,renderer,screenPathFiltering,preset:'viewer'});window.chunkErrors=[];chunkMap.on('error',e=>chunkErrors.push(String(e.error)));
  const source=new emap.TopologySource('fixture');
  const features=icons?Array.from({length:50000},(_,i)=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[(i%97)/20-2,((i*31)%89)/20-2]}})):[
   {type:'Feature',properties:{name:'area'},geometry:{type:'Polygon',coordinates:[[[-3,-3],[3,-3],[3,-1],[-3,-1],[-3,-3]],[[-.5,-2.5],[-.5,-1.5],[.5,-1.5],[.5,-2.5],[-.5,-2.5]]]}},
   {type:'Feature',properties:{name:'line'},geometry:{type:'LineString',coordinates:Array.from({length:100100},(_,i)=>[-3+i/100100*6,2+Math.sin(i/4500)*.25])}},
  ];
  await source.setData({filename:'fixture.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features}))});await chunkMap.addSource('fixture',source);
  for(const [i,l] of source.getLayers().entries()){
   const type=l.geometry_type==='point'?'circle':l.geometry_type==='polygon'?'fill':'line',id=l.geometry_type==='point'?'points':l.geometry_type==='polygon'?'area':'line';
   chunkMap.addLayer({id,source:'fixture','source-layer':l.name??String(i),type,...(type==='circle'?{pointLod:false}:{}),paint:type==='fill'?{'fill-color':'#dd2244','fill-opacity':.6,'line-width':0}:type==='line'?{'line-color':'#2266dd','line-width':4}:{'circle-radius':4,'circle-color':'#22cc55'}});
  }
  if(icons){const url='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="#ee3344"/><rect width="6" height="12" fill="#2255dd"/></svg>');chunkMap.setLayerIcon('points',{url,size:18,opacity:.75});}
  chunkMap.setExtent(new emap.Bounds(-4,-4,4,4));chunkMap.render();
  window.chunkCapture=async()=>{chunkMap.render();const data=await readCanvasPixels(chunkMap.ctx.render._canvas);let hash=2166136261,painted=0;for(let i=0;i<data.length;i++){hash=Math.imul(hash^data[i],16777619);if(i%4===3&&data[i])painted++;}return {hash:hash>>>0,painted};};
  window.chunkPixel=async(x,y)=>{chunkMap.render();const c=chunkMap.ctx.render._canvas,d=await readCanvasPixels(c),p=chunkMap.getTransform().project(x,y),i=(Math.round(p[1])*c.width+Math.round(p[0]))*4;return [...d.slice(i,i+4)];};
 },{renderer,screenPathFiltering,icons});
}
async function settle(page){
 await expect.poll(()=>page.evaluate(()=>chunkErrors),{timeout:30000}).toEqual([]);
 await expect.poll(()=>page.evaluate(()=>chunkMap.ctx.render._painter.frameComplete&&chunkMap.ctx.render._painter.stats.geometryChunks.pending===0),{timeout:30000}).toBe(true);
}
async function composedPixel(page,x,y){
 const screenshot=await page.screenshot({clip:{x:0,y:0,width:800,height:600}});
 return page.evaluate(async({png,x,y})=>{const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();const c=document.createElement('canvas');c.width=800;c.height=600;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const at=chunkMap.getTransform().project(x,y);return [...ctx.getImageData(Math.round(at[0]),Math.round(at[1]),1,1).data];},{png:screenshot.toString('base64'),x,y});
}
for(const renderer of ['webgl2','webgpu']){
 test(`${renderer}: chunked Worker output matches synchronous geometry, caches pan and paint, and preserves holes`,async({page})=>{
  test.setTimeout(120000);await scene(page,renderer);await settle(page);
  expect(page.workers().some(w=>w.url().includes('emap-geometry-worker.js'))).toBe(true);
  const warm=await page.evaluate(()=>chunkMap.ctx.render._painter.stats);
  expect(warm.geometryChunks.builds).toBeGreaterThan(0);expect(warm.geometryChunks.maxMeshBytes).toBeLessThan(3*1024**2);
  expect((await page.evaluate(()=>chunkPixel(0,-2)))[3]).toBe(0);expect((await page.evaluate(()=>chunkPixel(2,-2)))[0]).toBeGreaterThan(150);
  await page.evaluate(()=>{chunkMap.ctx.view._viewport.transform.translate(30,0);chunkMap.render();});await settle(page);
  const pan=await page.evaluate(()=>chunkMap.ctx.render._painter.stats);expect(pan.geometryChunks.builds).toBe(warm.geometryChunks.builds);expect(pan.geometryChunks.cacheHits).toBeGreaterThan(0);
  await page.evaluate(()=>{chunkMap.setPaintProperty('area','fill-color','#22dd44');chunkMap.render();});await settle(page);
  expect((await page.evaluate(()=>chunkMap.ctx.render._painter.stats)).uploads).toBe(pan.uploads);
  await page.evaluate(()=>{chunkMap.setFilter('area',['==',['get','name'],'missing']);chunkMap.render();});await settle(page);expect((await page.evaluate(()=>chunkPixel(2,-2)))[3]).toBe(0);
  await page.evaluate(()=>{chunkMap.setFilter('area',null);chunkMap.render();});await settle(page);
  await page.evaluate(()=>{chunkMap.setPaintProperty('line','line-color','rgba(34,102,221,0.6)');chunkMap.setPaintProperty('line','line-dasharray',[3,5]);chunkMap.render();});await settle(page);
  const parallel=await page.evaluate(()=>chunkCapture());
  const synchronous=await page.evaluate(async()=>{const p=chunkMap.ctx.render._painter;p.chunked=()=>false;chunkMap.render();return chunkCapture();});
  expect(parallel).toEqual(synchronous);expect(parallel.painted).toBeGreaterThan(100);
  const released=await page.evaluate(async()=>{const p=chunkMap.ctx.render._painter;await chunkMap.dispose();return p.stats;});
  expect(released.geometryChunks.bytes).toBe(0);expect(released.geometryChunks.partitionBytes).toBe(0);expect(released.geometryChunks.selectionBytes).toBe(0);expect(released.liveBufferBytes).toBe(0);
  await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>chunkErrors)).toEqual([]);
 });
 test(`${renderer}: screen-path updates replay compatible geometry while a later block is pending; removal cancels work`,async({page})=>{
  test.setTimeout(120000);await scene(page,renderer,true);await settle(page);
  const before=await page.evaluate(()=>chunkMap.ctx.render._painter.stats);expect(before.geometryChunks.screenChunks).toBeGreaterThan(0);
  const pending=await page.evaluate(()=>{const p=chunkMap.ctx.render._painter,worker=p.chunks.worker,build=worker.build.bind(worker);
    const batch=worker.buildBatch.bind(worker);
    for(const [method,run] of [['build',build],['buildBatch',batch]])worker[method]=(packet,signal)=>new Promise((resolve,reject)=>{window.releaseGeometry=()=>{worker.build=build;worker.buildBatch=batch;run(packet,signal).then(resolve,reject);};});
    // A pan is now a cache hit. Cross a detail boundary to hold a genuinely new Worker task.
    chunkMap.ctx.view._viewport.transform.scale(1.15,400,300);chunkMap.ctx.view._viewport.transform.translate(20,0);chunkMap.render();return {ready:p.frameComplete,presented:p.framePresented};});
  expect(pending).toEqual({ready:false,presented:true});
  // Read the compositor while new geometry is deliberately held, without calling render().
  const retained=await composedPixel(page,2,-2);expect(retained[0]).toBeGreaterThan(180);expect(retained[1]).toBeLessThan(150);
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseGeometry==='function')).toBe(true);
  await page.evaluate(()=>releaseGeometry());await settle(page);
  await page.evaluate(()=>{chunkMap.ctx.view._viewport.transform.scale(1.5,400,300);chunkMap.render();chunkMap.removeSource('fixture');chunkMap.render();});
  await expect.poll(()=>page.evaluate(()=>chunkMap.ctx.render._painter.stats.geometryChunks.pending)).toBe(0);
  const empty=await page.evaluate(()=>chunkCapture());expect(empty.painted).toBe(0);
  expect((await page.evaluate(()=>chunkMap.ctx.render._painter.stats)).geometryChunks.bytes).toBe(0);
  await page.evaluate(()=>chunkMap.dispose());await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>chunkErrors)).toEqual([]);
 });
 test(`${renderer}: multicolour point icons retain original overlap order across chunk boundaries`,async({page})=>{
  test.setTimeout(120000);await scene(page,renderer,false,true);
  await expect.poll(()=>page.evaluate(()=>chunkMap.ctx.render._icons?.stats.images??0)).toBe(1);await settle(page);
  const asyncPixels=await page.evaluate(()=>chunkCapture());
  const syncPixels=await page.evaluate(async()=>{chunkMap.ctx.render._painter.chunked=()=>false;chunkMap.render();return chunkCapture();});
  expect(asyncPixels).toEqual(syncPixels);expect(asyncPixels.painted).toBeGreaterThan(1000);
  await page.evaluate(()=>chunkMap.dispose());await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>chunkErrors)).toEqual([]);
 });
}

for(const renderer of ['webgl2','webgpu'])test(`${renderer}: large-source edits and undo never restore stale Worker geometry`,async({page})=>{
 test.setTimeout(120000);await scene(page,renderer,false);await settle(page);
 const before=await page.evaluate(()=>chunkCapture());
 await page.evaluate(()=>{const feature=chunkMap.queryFeatures(chunkMap.getTransform().project(2,-2)).find(f=>f.geometryType==='polygon'||f.layer?.geometry_type==='polygon')??chunkMap.queryFeatures(chunkMap.getTransform().project(2,-2))[0];if(!feature)throw new Error('Polygon pick failed');chunkMap.select([feature]);if(!chunkMap.editSession.translateSelected(1,0))throw new Error('Translate failed');chunkMap.clearSelection();chunkMap.render();});
 await settle(page);expect((await page.evaluate(()=>chunkPixel(-2.5,-2)))[3]).toBe(0);expect((await page.evaluate(()=>chunkPixel(3.5,-2)))[0]).toBeGreaterThan(150);
 await page.evaluate(()=>{if(!chunkMap.undo())throw new Error('Undo failed');chunkMap.render();});await settle(page);expect(await page.evaluate(()=>chunkCapture())).toEqual(before);
 await page.evaluate(()=>chunkMap.dispose());await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>chunkErrors)).toEqual([]);
});

test('failed geometry Worker reports an error instead of synchronous fallback or retry storms',async({page})=>{
 await page.route('**/emap-geometry-worker.js',route=>route.fulfill({status:404,body:'missing'}));
 await scene(page,'webgl2',false);
 await expect.poll(()=>page.evaluate(()=>chunkErrors.length)).toBeGreaterThan(0);
 await expect.poll(()=>page.evaluate(()=>chunkMap.ctx.render._painter.stats.geometryChunks.pending)).toBe(0);
 const before=await page.evaluate(()=>chunkMap.ctx.render._painter.stats.geometryChunks);
 expect(before.builds).toBe(0);await page.waitForTimeout(200);
 const after=await page.evaluate(()=>chunkMap.ctx.render._painter.stats.geometryChunks);expect(after.builds).toBe(0);expect(after.errors).toBe(before.errors);
 await page.evaluate(()=>{chunkMap.removeSource('fixture');chunkMap.render();});
 expect((await page.evaluate(()=>chunkMap.ctx.render._painter.stats.geometryChunks)).pending).toBe(0);
 await page.evaluate(()=>chunkMap.dispose());await expect.poll(()=>page.workers().length).toBe(0);
});


for (const renderer of ['webgl2','webgpu']) test(`${renderer}: bounded small-path batches preserve translucent dash pixels and reduce submissions`,async({page})=>{
 test.setTimeout(120000);await scene(page,renderer,false);await settle(page);
 await page.evaluate(async()=>{
  chunkMap.removeSource('fixture');
  const source=new emap.TopologySource('batch-lines');
  const features=Array.from({length:100010},(_,i)=>{
   const x=(i%512)*2+i/1000000,y=Math.floor(i/512)*4;
   return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[x,y],[x+1.7,y+3]]}};
  });
  await source.setData({filename:'batch-lines.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features}))});
  await chunkMap.addSource('batch-lines',source);
  chunkMap.addLayer({id:'batch-lines',source:'batch-lines','source-layer':source.getLayers()[0].name,type:'line',paint:{'line-color':'rgba(34,102,221,0.6)','line-width':2,'line-dasharray':[3,5]}});
  chunkMap.setExtent(new emap.Bounds(-10,-10,1040,810));chunkMap.render();
 });
 await settle(page);
 const checks=await page.evaluate(()=>{
  const p=chunkMap.ctx.render._painter,requests=[...p.chunks.requests.values()].filter(r=>r.input.kind==='path');
  const stats={batches:requests.reduce((n,r)=>n+r.entries.length,0),members:requests.reduce((n,r)=>n+r.entries.reduce((m,e)=>m+e.job.members.length,0),0)};
  const before=p.stats.drawCalls;chunkMap.render();stats.draws=p.stats.drawCalls-before;return stats;
 });
 expect(checks.members).toBeGreaterThan(90000);expect(checks.draws).toBeLessThan(180);
 const batched=await page.evaluate(()=>chunkCapture());
 const reference=await page.evaluate(async()=>{chunkMap.ctx.render._painter.chunked=()=>false;chunkMap.render();return chunkCapture();});
 expect(batched).toEqual(reference);expect(batched.painted).toBeGreaterThan(1000);
 await page.evaluate(()=>chunkMap.dispose());await expect.poll(()=>page.workers().length).toBe(0);
 expect(await page.evaluate(()=>chunkErrors)).toEqual([]);
});

for(const renderer of ['webgl2','webgpu'])test(`${renderer}: bounded Worker microbatches preserve icon order and cancel a live batch on source removal`,async({page})=>{
 test.setTimeout(120000);await scene(page,renderer,false,true);
 await expect.poll(()=>page.evaluate(()=>chunkMap.ctx.render._icons?.stats.images??0)).toBe(1);await settle(page);
 const initial=await page.evaluate(()=>chunkMap.ctx.render._painter.stats.geometryChunks);
 expect(initial.batchedJobs).toBeGreaterThan(0);expect(initial.messages).toBeLessThan(initial.jobs);expect(initial.maxBatchJobs).toBeLessThanOrEqual(8);
 const batchImage=await page.evaluate(()=>chunkCapture());expect(batchImage.painted).toBeGreaterThan(1000);
 await page.evaluate(()=>{const p=chunkMap.ctx.render._painter;p.chunks.batchJobs=1;p.clearGeometryCache();chunkMap.render();});await settle(page);
 expect(await page.evaluate(()=>chunkCapture())).toEqual(batchImage);
 await page.evaluate(()=>{
  const p=chunkMap.ctx.render._painter,worker=p.chunks.worker,build=worker.buildBatch.bind(worker);
  worker.buildBatch=(packets,signal)=>{const task=build(packets,signal);window.nativeBatchStarted=packets.length;
   queueMicrotask(()=>{chunkMap.removeSource('fixture');chunkMap.render();});return task;};
  p.chunks.batchJobs=8;p.clearGeometryCache();chunkMap.render();
 });
 await expect.poll(()=>page.evaluate(()=>window.nativeBatchStarted??0)).toBeGreaterThan(1);await settle(page);
 expect((await page.evaluate(()=>chunkCapture())).painted).toBe(0);
 const released=await page.evaluate(async()=>{const p=chunkMap.ctx.render._painter;await chunkMap.dispose();return p.stats;});
 expect(released.geometryChunks.inputBytes).toBe(0);expect(released.geometryChunks.bytes).toBe(0);expect(released.liveBufferBytes).toBe(0);
 await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>chunkErrors)).toEqual([]);
});

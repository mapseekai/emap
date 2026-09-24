import { test, expect } from '@playwright/test';
import { installCanvasReadback } from './fixtures/canvas-readback.mjs';
async function boot(page,renderer) {
 await installCanvasReadback(page);
 await page.goto('/mapseekai/emap/examples/luma-benchmark/');await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
 await page.evaluate(async renderer=>{
  lumaBenchmark.dispose();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;width:800px;height:600px';document.body.append(host);
  window.strokeMap=await emap.Emap.create({container:host,renderer,preset:'viewer'});window.strokeErrors=[];strokeMap.on('error',e=>strokeErrors.push(String(e.error)));
  const features=Array.from({length:3000},(_,i)=>{const x=(i%60)*.12-3.5,y=Math.floor(i/60)*.12-3;
   return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:i%3===0?[[x,y],[x+.07,y]]:i%3===1?[[x,y],[x+.07,y],[x+.07,y+.07]]:[[x,y],[x+.07,y],[x,y]]}};});
  features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:Array.from({length:100100},(_,i)=>[i/20000,30+Math.sin(i/4500)*.01])}});
  const source=new emap.TopologySource('s');await source.setData({filename:'stroke.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features}))});
  source.getDisplayArcs=()=>null;await strokeMap.addSource('s',source);
  strokeMap.addLayer({id:'lines',type:'line',source:'s','source-layer':source.getLayers()[0].name,paint:{'line-color':'#174bd4','line-width':2}});
  strokeMap.setExtent(new emap.Bounds(-4,-4,4,4));strokeMap.render();
  window.captureStroke=async()=>{const d=await readCanvasPixels(strokeMap.ctx.render._canvas);return d;};
  window.strokeModes=(compact,pages)=>{const p=strokeMap.ctx.render._painter;p.gpu.compactStrokesEnabled=compact;p.gpu.meshPagesEnabled=pages;p.clearGeometryCache();strokeMap.render();};
 },renderer);
}
async function settle(page){await expect.poll(()=>page.evaluate(()=>strokeErrors)).toEqual([]);await expect.poll(()=>page.evaluate(()=>{const p=strokeMap.ctx.render._painter;return p.frameComplete&&p.stats.geometryChunks.pending===0;}),{timeout:60000}).toBe(true);}
for(const renderer of ['webgl2','webgpu']) {
 test(`${renderer}: compact valid strokes preserve endpoints, joined corners and pooled draw pixels`,async({page})=>{
  test.setTimeout(120000);await boot(page,renderer);await settle(page);
  const compact=await page.evaluate(()=>{const p=strokeMap.ctx.render._painter;return [...p.gpu.meshes].filter(m=>m.compactStroke).length;});expect(compact).toBeGreaterThan(0);
  for(const width of [.6,2,7]){
   await page.evaluate(w=>{strokeMap.setPaintProperty('lines','line-width',w);strokeModes(true,true);},width);await settle(page);
   await page.evaluate(async()=>{window.strokeA=await captureStroke();});
   await page.evaluate(()=>strokeModes(true,false));await settle(page);expect(await page.evaluate(async()=>{const b=await captureStroke();return b.every((v,i)=>v===strokeA[i]);})).toBe(true);
   await page.evaluate(()=>strokeModes(false,false));await settle(page);const {different,max}=await page.evaluate(async()=>{const a=strokeA,c=await captureStroke();let different=0,max=0;for(let i=0;i<a.length;i+=4){let change=false;for(let j=0;j<4;j++){const d=Math.abs(a[i+j]-c[i+j]);max=Math.max(max,d);change||=!!d;}different+=Number(change);}return {different,max};});
   console.log('STROKE_PIXELS',renderer,width,{different,max});expect(different).toBeLessThan(800*600*.002);
  }
  // Native navigation keeps the existing page slices, not a snapshot bitmap.
  await page.evaluate(()=>strokeModes(true,true));await settle(page);
  const before=await page.evaluate(()=>strokeMap.ctx.render._painter.stats.uploads);
  await page.evaluate(()=>{const p=strokeMap.ctx.render._painter,v=strokeMap.getTransform();v.translate(21,-13);window.navigationAccepted=p.renderNavigation(v);});
  expect(await page.evaluate(()=>navigationAccepted)).toBe(true);
  expect(await page.evaluate(()=>strokeMap.ctx.render._painter.stats.uploads)).toBe(before);
  // A nonuniform camera cannot reuse the affine join coefficients.
  expect(await page.evaluate(()=>{const p=strokeMap.ctx.render._painter,v=strokeMap.getTransform();v.my*=1.1;return p.renderNavigation(v);})).toBe(false);
  await page.evaluate(()=>{strokeMap.ctx.view._viewport.transform.my*=1.1;strokeMap.render();});await settle(page);
  expect(await page.evaluate(()=>[...strokeMap.ctx.render._painter.chunks.requests.values()].some(r=>r.input.compactStroke))).toBe(false);
  await page.evaluate(()=>{strokeMap.setPaintProperty('lines','line-color','rgba(23,75,212,.5)');strokeMap.setPaintProperty('lines','line-dasharray',[3,5]);strokeModes(true,true);});await settle(page);
  expect(await page.evaluate(()=>[...strokeMap.ctx.render._painter.gpu.meshes].some(m=>m.compactStroke))).toBe(false);
  const after=await page.evaluate(async()=>{const p=strokeMap.ctx.render._painter;await strokeMap.dispose();return p.stats;});
  expect(after.liveBufferBytes).toBe(0);expect(after.geometryPages.allocatedBytes).toBe(0);expect(after.geometryChunks.bytes).toBe(0);expect(await page.evaluate(()=>strokeErrors)).toEqual([]);
 });
}

for(const renderer of ['webgl2','webgpu']) {
 test(`${renderer}: compact stroke pages preserve CSS widths and raw-path coverage at DPR 2`,async({browser})=>{
  const context=await browser.newContext({viewport:{width:1000,height:800},deviceScaleFactor:2});
  try{
   const page=await context.newPage();await boot(page,renderer);await settle(page);
   expect(await page.evaluate(()=>strokeMap.ctx.render._canvas.width)).toBe(1600);
   await page.evaluate(async()=>{window.strokeA=await captureStroke();});
   await page.evaluate(()=>strokeModes(false,false));await settle(page);
   const difference=await page.evaluate(async()=>{const b=await captureStroke(),a=strokeA;let changed=0;for(let i=0;i<b.length;i+=4)if(b[i]!==a[i]||b[i+1]!==a[i+1]||b[i+2]!==a[i+2]||b[i+3]!==a[i+3])changed++;return changed;});
   expect(difference).toBeLessThan(1600*1200*.002);
   await page.evaluate(()=>strokeMap.dispose());expect(await page.evaluate(()=>strokeErrors)).toEqual([]);
  }finally{await context.close();}
 });
}

for(const renderer of ['webgl2','webgpu']) {
 test(`${renderer}: filtering and restoring compact pages never replays retired content`,async({page})=>{
  test.setTimeout(120000);await boot(page,renderer);await settle(page);
  const before=await page.evaluate(async()=>{
   window.originalStroke=await captureStroke();
   return strokeMap.ctx.render._painter.stats.geometryPages;
  });
  expect(before.pages).toBeGreaterThan(0);
  for(let i=0;i<3;i++){
   await page.evaluate(()=>{strokeMap.setFilter('lines',['==',['get','absent'],'hidden']);strokeMap.render();});await settle(page);
   expect(await page.evaluate(async()=>{const pixels=await captureStroke();return pixels.some((v,i)=>i%4===3&&v!==0);})).toBe(false);
   expect(await page.evaluate(()=>strokeMap.ctx.render._painter.stats.geometryPages.allocatedBytes)).toBe(0);
   await page.evaluate(()=>{strokeMap.setFilter('lines',null);strokeMap.render();});await settle(page);
   expect(await page.evaluate(async()=>{const pixels=await captureStroke();return pixels.every((v,i)=>v===originalStroke[i]);})).toBe(true);
  }
  await page.evaluate(()=>{strokeMap.removeSource('s');strokeMap.render();});await settle(page);
  const empty=await page.evaluate(()=>strokeMap.ctx.render._painter.stats);
  expect(empty.geometryPages.pages).toBe(0);expect(empty.liveBufferBytes).toBe(0);
  await page.evaluate(()=>strokeMap.dispose());
  await expect.poll(()=>page.workers().length).toBe(0);
  expect(await page.evaluate(()=>strokeErrors)).toEqual([]);
 });
}

for(const renderer of ['webgl2','webgpu'])test(`${renderer}: lossless XY stroke packing equals explicit high/low buffers`,async({page})=>{
  test.setTimeout(90000);await boot(page,renderer);await settle(page);
  await page.evaluate(async()=>{strokeMap.render();window.xyPixels=await captureStroke();});
  expect(await page.evaluate(()=>[...strokeMap.ctx.render._painter.gpu.meshes].some(m=>m.compactStrokeXY))).toBe(true);
  await page.evaluate(()=>{
    const p=strokeMap.ctx.render._painter,worker=p.chunks.worker,build=worker.build.bind(worker);
    worker.build=async(...args)=>{
      const result=await build(...args);
      result.geometries=result.geometries.map(g=>{
        if(!g.compactStrokeXY)return g;
        const vertices=new Float32Array(g.count*16);
        for(let i=0;i<g.count;i++){
          const a=i*12,b=i*16;
          vertices[b]=g.vertices[a];vertices[b+1]=g.vertices[a+1];
          vertices[b+4]=g.vertices[a+2];vertices[b+5]=g.vertices[a+3];
          vertices.set(g.vertices.subarray(a+4,a+12),b+8);
        }
        return {...g,vertices,compactStrokeXY:false};
      });return result;
    };
    p.clearGeometryCache();strokeMap.render();
  });await settle(page);
  expect(await page.evaluate(async()=>{strokeMap.render();return (await captureStroke()).every((v,i)=>v===xyPixels[i]);})).toBe(true);
  await page.evaluate(()=>strokeMap.dispose());expect(await page.evaluate(()=>strokeErrors)).toEqual([]);
});

for(const renderer of ['webgl2','webgpu'])test(`${renderer}: screen stroke ranges cull resident offscreen instances without changing pixels or uploads`,async({page})=>{
 test.setTimeout(120000);await boot(page,renderer);await settle(page);
 await page.evaluate(async()=>{
  strokeMap.removeSource('s');const source=new emap.TopologySource('ranges');
  const features=Array.from({length:40000},(_,i)=>{const x=i%200,y=Math.floor(i/200);return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[x,y],[x+.75,y+.5]]}};});
  features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:Array.from({length:100100},(_,i)=>[10000+i/20000,10000])}});
  await source.setData({filename:'ranges.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features}))});source.getDisplayArcs=()=>null;
  await strokeMap.addSource('ranges',source);strokeMap.addLayer({id:'ranges',type:'line',source:'ranges','source-layer':source.getLayers()[0].name,paint:{'line-color':'#174bd4','line-width':2}});
  strokeMap.setExtent(new emap.Bounds(-1,-1,201,201));strokeMap.render();
 });await settle(page);
 const optimized=await page.evaluate(async()=>{
  const p=strokeMap.ctx.render._painter,v=strokeMap.getTransform(),uploads=p.stats.uploads;v.scale(8,400,300);
  if(!p.renderNavigation(v))throw new Error('Navigation refused');window.rangeView=v;window.rangedPixels=await captureStroke();
  return {candidates:p.stats.pathFrameCandidates,submitted:p.stats.pathFrameSubmitted,uploads:p.stats.uploads-uploads};
 });
 expect(optimized.candidates).toBeGreaterThan(10000);expect(optimized.submitted).toBeLessThan(optimized.candidates/2);expect(optimized.uploads).toBe(0);
 const equal=await page.evaluate(async()=>{const p=strokeMap.ctx.render._painter;
  for(const e of p.chunks.entries.values())e.ranges=e.ranges.map(()=>undefined);
  p.renderNavigation(rangeView);const b=await captureStroke();return b.every((n,i)=>n===rangedPixels[i]);
 });expect(equal).toBe(true);
 await page.evaluate(()=>strokeMap.dispose());expect(await page.evaluate(()=>strokeErrors)).toEqual([]);
});

for(const renderer of ['webgl2','webgpu'])test(`${renderer}: nonuniform raw navigation does not reuse similarity-only stroke envelopes`,async({page})=>{
 test.setTimeout(90000);await boot(page,renderer);await settle(page);
 await page.evaluate(async()=>{
  strokeMap.removeSource('s');const source=new emap.TopologySource('raw-ranges');
  const coordinates=Array.from({length:100100},(_,i)=>[-3+i/100100*6,Math.sin(i/350)*.3]);
  await source.setData({filename:'raw-ranges.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates}}]}))});
  source.getDisplayArcs=()=>null;await strokeMap.addSource('raw-ranges',source);
  strokeMap.addLayer({id:'raw-ranges',type:'line',source:'raw-ranges','source-layer':source.getLayers()[0].name,paint:{'line-color':'#174bd4','line-width':2}});
  strokeMap.setExtent(new emap.Bounds(-4,-4,4,4));strokeMap.render();
 });await settle(page);
 const actual=await page.evaluate(()=>{
  const p=strokeMap.ctx.render._painter,g=p.gpu;
  const indexed=[...p.chunks.entries.values()].some(e=>e.screenSpace&&e.ranges.some(r=>r?.data.envelopeHalfWidths));
  const draw=g.drawMeshSequence.bind(g);let calls=0,envelopes=0;
  g.drawMeshSequence=(ds,paint)=>{calls++;if(paint.screenSpace)envelopes+=ds.filter(d=>d.ranges!==undefined).length;draw(ds,paint);};
  try{const v=strokeMap.getTransform();v.my*=1.7;return {indexed,accepted:p.renderNavigation(v),calls,envelopes};}
  finally{g.drawMeshSequence=draw;}
 });
 expect(actual.indexed).toBe(true);expect(actual.accepted).toBe(true);expect(actual.calls).toBeGreaterThan(0);expect(actual.envelopes).toBe(0);
 await page.evaluate(()=>strokeMap.dispose());expect(await page.evaluate(()=>strokeErrors)).toEqual([]);
});

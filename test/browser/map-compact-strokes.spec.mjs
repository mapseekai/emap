import { test, expect } from '@playwright/test';
import { installCanvasReadback } from './fixtures/canvas-readback.mjs';
async function boot(page,renderer,exact=false,precision=false) {
 await installCanvasReadback(page);
 await page.goto('/mapseekai/emap/examples/luma-benchmark/');await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
 await page.evaluate(async({renderer,exact,precision})=>{
  lumaBenchmark.dispose();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;width:800px;height:600px';document.body.append(host);
  // These cases exercise the opt-in screen-space stroke formats.
  window.strokeMap=await emap.Emap.create({container:host,renderer,preset:'viewer',screenPathFiltering:true});window.strokeErrors=[];strokeMap.on('error',e=>strokeErrors.push(String(e.error)));
  if(precision){
   window.strokePrecision={nonzeroLow:0,endpoints:0,maxError:0};
   const worker=strokeMap.ctx.render._painter.chunks.worker,build=worker.build.bind(worker),batch=worker.buildBatch.bind(worker);
   const reference=packet=>{
    const values=new Map(),view=packet.screen&&new emap.AffineTransform(...packet.screen.view);
    if(view)for(let i=0;i<packet.coordinates.length;i+=2){
     const p=view.project(packet.coordinates[i],packet.coordinates[i+1]),key=[Math.fround(p[0]),Math.fround(p[1])].join(':');
     if(!values.has(key))values.set(key,[]);values.get(key).push(p);
    }
    return values;
   };
   const inspect=(result,values)=>{
    for(const g of result.geometries)if(g.compactStroke&&!g.compactStrokeXY){
     for(let i=0;i<g.count;i++)for(const offset of [0,4]){
      const at=i*16+offset,x=g.vertices[at],y=g.vertices[at+1],lx=g.vertices[at+2],ly=g.vertices[at+3];
      const expected=values.get([x,y].join(':'))??[];
      const error=Math.min(...expected.map(p=>Math.max(Math.abs(x+lx-p[0]),Math.abs(y+ly-p[1]))));
      strokePrecision.nonzeroLow+=Number(lx!==0)+Number(ly!==0);strokePrecision.endpoints++;
      strokePrecision.maxError=Math.max(strokePrecision.maxError,error);
     }
    }
   };
   worker.build=async(packet,signal)=>{const expected=reference(packet),result=await build(packet,signal);inspect(result,expected);return result;};
   worker.buildBatch=async(packets,signal)=>{const expected=packets.map(reference),results=await batch(packets,signal);for(let i=0;i<results.length;i++)if(results[i].result)inspect(results[i].result,expected[i]);return results;};
  }
  const step=exact?1/8:.12,segment=exact?1/16:.07;
  const features=Array.from({length:3000},(_,i)=>{const x=(i%60)*step-3.5,y=Math.floor(i/60)*step-3;
   return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:i%3===0?[[x,y],[x+segment,y]]:i%3===1?[[x,y],[x+segment,y],[x+segment,y+segment]]:[[x,y],[x+segment,y],[x,y]]}};});
  features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:Array.from({length:100100},(_,i)=>exact?[i/16384-4,32]:[i/20000,30+Math.sin(i/4500)*.01])}});
  const source=new emap.TopologySource('s');await source.setData({filename:'stroke.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features}))});
  source.getDisplayArcs=()=>null;await strokeMap.addSource('s',source);
  strokeMap.addLayer({id:'lines',type:'line',source:'s','source-layer':source.getLayers()[0].name,paint:{'line-color':'#174bd4','line-width':2}});
  // Dyadic inputs and a power-of-two detail frame give the XY case zero low words.
  const edge=exact?4.6875:4;
  strokeMap.setExtent(new emap.Bounds(-edge,-edge,edge,edge));strokeMap.render();
  window.captureStroke=async()=>{const d=await readCanvasPixels(strokeMap.ctx.render._canvas);return d;};
  window.strokeModes=(compact,pages)=>{const p=strokeMap.ctx.render._painter;p.gpu.compactStrokesEnabled=compact;p.gpu.meshPagesEnabled=pages;p.clearGeometryCache();strokeMap.render();};
 },{renderer,exact,precision});
}
async function settle(page){await expect.poll(()=>page.evaluate(()=>strokeErrors)).toEqual([]);await expect.poll(()=>page.evaluate(()=>{const p=strokeMap.ctx.render._painter;return p.frameComplete&&p.stats.geometryChunks.pending===0;}),{timeout:60000}).toBe(true);}
async function strokeScreenshot(page,baseline=false,difference=false){
 await page.evaluate(async()=>{await strokeMap.ctx.render._painter.gpu.waitForIdle();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
 const png=await page.screenshot({clip:{x:0,y:0,width:800,height:600}});
 return page.evaluate(async({png,baseline,difference})=>{
  const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,800,600).data;
  if(baseline){
   window.strokeScreenshotPixels=pixels;
   // The empty corner gives the background chroma, including thin MSAA coverage.
   const redChroma=pixels[2]-pixels[0],greenChroma=pixels[2]-pixels[1];
   return pixels.some((v,i)=>i%4===0&&pixels[i+2]-v>redChroma&&pixels[i+2]-pixels[i+1]>greenChroma);
  }
  if(difference){let changed=0;for(let i=0;i<pixels.length;i+=4)if([0,1,2,3].some(j=>pixels[i+j]!==strokeScreenshotPixels[i+j]))changed++;return changed;}
  return pixels.every((v,i)=>v===strokeScreenshotPixels[i]);
 },{png:png.toString('base64'),baseline,difference});
}
for(const renderer of ['webgl2','webgpu']) {
 test(`${renderer}: compact valid strokes preserve endpoints, joined corners and pooled draw pixels`,async({page})=>{
  test.setTimeout(120000);await boot(page,renderer,false,true);await settle(page);
  const compact=await page.evaluate(()=>{const p=strokeMap.ctx.render._painter;return [...p.gpu.meshes].filter(m=>m.compactStroke).length;});expect(compact).toBeGreaterThan(0);
  // Decimal coordinates legitimately need nonzero low words, unlike the XY case.
  const precision=await page.evaluate(()=>strokePrecision);
  console.log('STROKE_PRECISION',renderer,JSON.stringify(precision));
  expect(precision.nonzeroLow).toBeGreaterThan(0);expect(precision.endpoints).toBeGreaterThan(0);
  expect(precision.maxError).toBeLessThan(1e-9);
  for(const width of [.6,2,7]){
   await page.evaluate(w=>{strokeMap.setPaintProperty('lines','line-width',w);strokeModes(true,true);},width);await settle(page);
   await page.evaluate(async()=>{window.strokeA=await captureStroke();});
   expect(await strokeScreenshot(page,true)).toBe(true);
   await page.evaluate(()=>strokeModes(true,false));await settle(page);expect(await page.evaluate(async()=>{const b=await captureStroke();return b.every((v,i)=>v===strokeA[i]);})).toBe(true);
   expect(await strokeScreenshot(page)).toBe(true);
   await page.evaluate(()=>strokeModes(false,false));await settle(page);const {different,max}=await page.evaluate(async()=>{const a=strokeA,c=await captureStroke();let different=0,max=0;for(let i=0;i<a.length;i+=4){let change=false;for(let j=0;j<4;j++){const d=Math.abs(a[i+j]-c[i+j]);max=Math.max(max,d);change||=!!d;}different+=Number(change);}return {different,max};});
   console.log('STROKE_PIXELS',renderer,width,{different,max});expect(different).toBeLessThan(800*600*.002);
   expect(await strokeScreenshot(page,false,true)).toBeLessThan(800*600*.002);
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
  test.setTimeout(90000);await boot(page,renderer,true);await settle(page);
  await page.evaluate(async()=>{strokeMap.render();window.xyPixels=await captureStroke();});
  // A retained WebGPU frame can have an empty Canvas readback after presentation.
  // Also require visible ink and exact compositor pixels for the ABI comparison.
  expect(await strokeScreenshot(page,true)).toBe(true);
  expect(await page.evaluate(()=>[...strokeMap.ctx.render._painter.gpu.meshes].some(m=>m.compactStrokeXY))).toBe(true);
  await page.evaluate(()=>{
    const p=strokeMap.ctx.render._painter,worker=p.chunks.worker,build=worker.build.bind(worker),batch=worker.buildBatch.bind(worker);
    window.expandedXY=0;
    const expand=result=>{
      result.geometries=result.geometries.map(g=>{
        if(!g.compactStrokeXY)return g;
        expandedXY++;
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
    worker.build=async(...args)=>expand(await build(...args));
    worker.buildBatch=async(...args)=>{
      const results=await batch(...args);
      for(const item of results)if(item.result)expand(item.result);
      return results;
    };
    p.clearGeometryCache();strokeMap.render();
  });await settle(page);
  expect(await page.evaluate(()=>expandedXY)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>[...strokeMap.ctx.render._painter.gpu.meshes].some(m=>m.compactStrokeXY))).toBe(false);
  expect(await page.evaluate(async()=>{strokeMap.render();return (await captureStroke()).every((v,i)=>v===xyPixels[i]);})).toBe(true);
  expect(await strokeScreenshot(page)).toBe(true);
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

test('webgpu: stroke sample masks preserve discard coverage and depth across paint barriers', async ({ browser }) => {
  test.setTimeout(180000);
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: dpr });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await boot(page, 'webgpu');
      await settle(page);
      await page.evaluate(async () => {
        const source = new emap.TopologySource('barriers');
        await source.setData({ filename: 'barriers.geojson', content: new TextEncoder().encode(JSON.stringify({
          type: 'FeatureCollection', features: [
            { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-2,-2],[2,-2],[2,2],[-2,2],[-2,-2]]] } },
            { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0,0] } },
          ],
        })) });
        for (const [index, layer] of source.getLayers().entries()) layer.name = `barrier-${index}`;
        await strokeMap.addSource('barriers', source);
        for (const layer of source.getLayers()) strokeMap.addLayer({
          id: layer.name, source: 'barriers', 'source-layer': layer.name,
          type: layer.geometry_type === 'point' ? 'circle' : 'fill',
          paint: layer.geometry_type === 'point'
            ? { 'circle-color': '#ed5828', 'circle-radius': 40 }
            : { 'fill-color': '#d73783', 'fill-opacity': .4 },
        });
        const line = strokeMap.getSource('s').getLayers()[0].name;
        strokeMap.addLayer({ id: 'translucent', type: 'line', source: 's', 'source-layer': line, paint: { 'line-color': '#18a848', 'line-opacity': .4, 'line-width': 8 } });
        strokeMap.addLayer({ id: 'opaque-after-barriers', type: 'line', source: 's', 'source-layer': line, paint: { 'line-color': '#981f6d', 'line-width': 3 } });
        const p = strokeMap.ctx.render._painter;
        const gpu = p.gpu;
        window.coveragePipelines = [];
        for (const [kind, entry] of gpu.pipelines) {
          if (!kind.startsWith('path-msaa')) continue;
          // Compare sample-mask rejection with discard for the same envelope,
          // including the bounded whole-segment capsule mode.
          const input = kind.includes('compact') ? 'CompactOut' : 'PathOut';
          const source = entry.shaders[0].source.split('@fragment')[0] + `
            @fragment fn fragmentMain(p:${input})->@location(0) vec4<f32> {
              let q=vec2<f32>(p.local.x,p.local.y-clamp(p.local.y,0.0,p.len));
              let outside=(p.local.y<0.0 || p.local.y>p.len) && select(dot(p.corner,p.corner)>1.0,dot(q,q)>1.0,p.capsule>0.5);
              if (outside) { discard; }
              return premultiply(1.0);
            }`;
          const module = gpu.device.handle.createShaderModule({ code: source });
          const descriptor = entry.pipeline.descriptor;
          const compiling = gpu.device.handle.createRenderPipelineAsync({ ...descriptor, fragment: { ...descriptor.fragment, module } });
          gpu.device.submit();
          const [logs, reference] = await Promise.all([module.getCompilationInfo(), compiling]);
          if (logs.messages.some(m => m.type === 'error')) throw new Error('Discard oracle failed to compile');
          coveragePipelines.push({ pipeline: entry.pipeline, optimized: entry.pipeline.handle, reference });
        }
        window.captureCoverage = async reference => {
          gpu.commandCache?.clear();
          for (const entry of coveragePipelines) entry.pipeline.handle = reference ? entry.reference : entry.optimized;
          // The debug-only pipeline swap must submit even when the semantic scene is unchanged.
          for (let i = 0; i < 3; i++) {
            const frames = gpu.stats.frames;
            if (!p.renderNavigation(strokeMap.ctx.view._viewport.transform) || gpu.stats.frames !== frames + 1)
              throw new Error('Coverage oracle requires one resident GPU submission');
          }
          return captureStroke();
        };
      });
      for (const compact of [false, true]) for (const width of [.6, 3, 8]) {
        await page.evaluate(({ compact, width }) => {
          strokeMap.setPaintProperty('lines', 'line-width', width);
          strokeModes(compact, true);
        }, { compact, width });
        await settle(page);
        const diff = await page.evaluate(async () => {
          const reference = await captureCoverage(true), actual = await captureCoverage(false);
          let different = 0, painted = 0, fractional = 0;
          for (let i = 0; i < actual.length; i++) {
            if (actual[i] !== reference[i]) different++;
            if (i % 4 === 3 && actual[i]) { painted++; if (actual[i] < 255) fractional++; }
          }
          return { different, painted, fractional };
        });
        expect(diff.different, JSON.stringify({ dpr, compact, width })).toBe(0);
        expect(diff.painted).toBeGreaterThan(1000);
        expect(diff.fractional).toBeGreaterThan(0);
      }
      await page.evaluate(() => { coveragePipelines = []; return strokeMap.dispose(); });
      expect(await page.evaluate(() => strokeErrors)).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }
});

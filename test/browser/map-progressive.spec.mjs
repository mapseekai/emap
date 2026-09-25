import { test, expect } from '@playwright/test';
const base='/mapseekai/emap/examples/';
async function boot(page,renderer,screenPathFiltering=false){
 await page.goto(base+'luma-benchmark/');await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
 await page.evaluate(async({renderer,screenPathFiltering})=>{
  lumaBenchmark.dispose();document.body.replaceChildren();
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;width:800px;height:600px;background:#fff';document.body.append(host);
  window.progressMap=await emap.Emap.create({container:host,renderer,screenPathFiltering,preset:'viewer'});
  window.progressErrors=[];progressMap.on('error',e=>progressErrors.push(String(e.error)));
  window.square=(x,y,w=1)=>[[x,y],[x+w,y],[x+w,y+w],[x,y+w],[x,y]];
  window.feature=(geometry,properties={})=>({type:'Feature',properties,geometry});
  window.largeLine=()=>feature({type:'LineString',coordinates:Array.from({length:100100},(_,i)=>[i/10000,20+Math.sin(i/4000)])});
  window.addProgressSource=async(id,features)=>{
   const source=new emap.TopologySource(id);
   await source.setData({filename:id+'.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features}))});
   // This test fixes display precision; it is not a production bypass.
   source.getDisplayArcs=()=>null;
   await progressMap.addSource(id,source);return source;
  };
 },{renderer,screenPathFiltering});
}
async function settled(page){
 await expect.poll(()=>page.evaluate(()=>progressErrors),{timeout:30000}).toEqual([]);
 await expect.poll(()=>page.evaluate(()=>{const p=progressMap.ctx.render._painter;return p.frameComplete&&p.stats.geometryChunks.pending===0&&progressMap.ctx.render._pendingRender===0;}),{timeout:30000}).toBe(true);
}
async function pixels(page,mode='hash',at=[0,0]){
 const png=await page.screenshot({clip:{x:0,y:0,width:800,height:600}});
 return page.evaluate(async({png,mode,at})=>{
  const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
  const c=document.createElement('canvas');c.width=800;c.height=600;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
  if(mode==='pixel'){const p=progressMap.getTransform().project(...at);return [...ctx.getImageData(Math.round(p[0]),Math.round(p[1]),1,1).data];}
  const d=ctx.getImageData(0,0,800,600).data;let hash=2166136261,n=0,y0=600,y1=-1;
  for(let i=0;i<d.length;i++){hash=Math.imul(hash^d[i],16777619);if(i%4===0&&d[i]>150&&d[i+1]<100&&d[i+2]>150){n++;const y=Math.floor(i/4/800);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
  return mode==='text'?{n,height:y1-y0+1}:{hash:hash>>>0};
 },{png:png.toString('base64'),mode,at});
}
async function dispose(page){
 const stats=await page.evaluate(async()=>{const p=progressMap.ctx.render._painter;await progressMap.dispose();return p.stats;});
 expect(stats.liveBufferBytes).toBe(0);expect(stats.geometryChunks.bytes).toBe(0);
 expect(stats.geometryChunks.triangulation?.bytes??0).toBe(0);
 await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>progressErrors)).toEqual([]);
}
for(const renderer of ['webgl2','webgpu']){
 test(`${renderer}: first partial frame appears before the last job and recomposition never doubles alpha`,async({page})=>{
  test.setTimeout(90000);await boot(page,renderer);
  await page.evaluate(async()=>{
   const cache=progressMap.ctx.render._painter.chunks,build=cache.worker.build.bind(cache.worker);
   const batch=cache.worker.buildBatch.bind(cache.worker);
   const hold=async(packets)=>{if(packets.some(packet=>packet.sourceId==='upper'))await new Promise(resolve=>{window.releaseUpper=resolve;});};
   cache.worker.build=async(packet,signal)=>{await hold([packet]);return build(packet,signal);};
   cache.worker.buildBatch=async(packets,signal)=>{await hold(packets);return batch(packets,signal);};
   for(const [id,color] of [['lower','#ff0000'],['upper','#0000ff']]){
    const source=await addProgressSource(id,[feature({type:'Polygon',coordinates:[square(-3,-3,6)]}),largeLine()]);
    const layer=source.getLayers().find(l=>l.geometry_type==='polygon');
    progressMap.addLayer({id,source:id,'source-layer':layer.name,type:'fill',paint:{'fill-color':color,'fill-opacity':.5,'line-width':0}});
   }
   progressMap.setExtent(new emap.Bounds(-4,-4,4,4));progressMap.render();
  });
  await expect.poll(()=>page.evaluate(()=>typeof releaseUpper==='function')).toBe(true);
  await expect.poll(()=>page.evaluate(()=>progressMap.ctx.render._painter.stats.presentation.partial)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>progressMap.ctx.render._painter.frameComplete)).toBe(false);
  const first=await pixels(page,'pixel');expect(first[0]).toBe(255);expect(first[1]).toBeGreaterThan(120);expect(first[1]).toBeLessThan(135);
  await page.evaluate(()=>releaseUpper());await settled(page);
  const final=await pixels(page,'pixel');expect(final[2]).toBeGreaterThan(180);expect(final[0]).toBeGreaterThan(120);expect(final[0]).toBeLessThan(135);
  expect(final[1]).toBeGreaterThan(55);expect(final[1]).toBeLessThan(75);
  await page.evaluate(()=>{for(let i=0;i<5;i++)progressMap.render();});expect(await pixels(page,'pixel')).toEqual(final);
  await dispose(page);
 });
 test(`${renderer}: a huge multipart polygon culls internal triangles without new geometry uploads or missing pixels`,async({page})=>{
  test.setTimeout(120000);await boot(page,renderer);
  await page.evaluate(async()=>{
   const polygons=[];for(let y=0;y<150;y++)for(let x=0;x<150;x++)polygons.push([square(x,y,.8)]);
   const source=await addProgressSource('grid',[feature({type:'MultiPolygon',coordinates:polygons})]);
   progressMap.addLayer({id:'grid',source:'grid',type:'fill',paint:{'fill-color':'#2255cc','fill-opacity':.6,'line-width':0}});
   progressMap.setExtent(new emap.Bounds(0,0,150,150));progressMap.render();
  });await settled(page);
  const before=await page.evaluate(()=>progressMap.ctx.render._painter.stats);
  expect(before.geometryChunks.builds).toBeGreaterThan(0);
  await page.evaluate(()=>{progressMap.setExtent(new emap.Bounds(70,70,80,80));progressMap.render();});await settled(page);
  const near=await page.evaluate(()=>progressMap.ctx.render._painter.stats);
  expect(near.fillFrameCandidates).toBeGreaterThan(10000);expect(near.fillFrameSubmitted).toBeLessThan(near.fillFrameCandidates*.15);
  expect(near.uploads).toBe(before.uploads);const culled=await pixels(page);
  await page.evaluate(()=>{const c=progressMap.ctx.render._painter.chunks;for(const e of c.entries.values())for(const r of e.fillRanges)if(r)r.select=()=>({ranges:null,triangles:r.count/3,rejected:0});progressMap.render();});
  expect(await pixels(page)).toEqual(culled);
  await dispose(page);
 });
 test(`${renderer}: changed cold batch membership reuses unchanged feature triangulations`,async({page})=>{
  await boot(page,renderer);
  await page.evaluate(async()=>{
   const features=Array.from({length:100},(_,i)=>feature({type:'Polygon',coordinates:[square((i%10)/10,Math.floor(i/10)/10,.07)]},{id:i}));
   const source=await addProgressSource('features',[...features,largeLine()]);const layer=source.getLayers().find(l=>l.geometry_type==='polygon');
   progressMap.addLayer({id:'area',source:'features','source-layer':layer.name,type:'fill',paint:{'fill-color':'#2255cc','line-width':0}});
   progressMap.setExtent(new emap.Bounds(-1,-1,2,2));progressMap.render();
  });await settled(page);
  const first=await page.evaluate(()=>progressMap.ctx.render._painter.stats.geometryChunks);
  await page.evaluate(()=>{progressMap.setFilter('area',['>=',['get','id'],30]);progressMap.render();});await settled(page);
  const next=await page.evaluate(()=>progressMap.ctx.render._painter.stats.geometryChunks);
  expect(next.builds).toBeGreaterThan(first.builds);expect(next.triangulation.hits).toBeGreaterThan(first.triangulation.hits);
  expect(next.triangulation.bytes).toBeLessThanOrEqual(64*1024**2);
  await dispose(page);
 });
 test(`${renderer}: new coverage and labels arrive while the real pointer gesture is still active`,async({page})=>{
  test.setTimeout(90000);await boot(page,renderer,true);
  await page.evaluate(async()=>{
   const features=[];for(let y=0;y<10;y++)for(let x=0;x<32;x++)features.push(feature({type:'Polygon',coordinates:[square(x,y,.9)]}));
   const source=await addProgressSource('land',[...features,largeLine()]);const layer=source.getLayers().find(l=>l.geometry_type==='polygon');
   progressMap.addLayer({id:'land',source:'land','source-layer':layer.name,type:'fill',paint:{'fill-color':'#22bb66','line-width':0}});
   await addProgressSource('labels',[feature({type:'Point',coordinates:[5,4]},{name:'Old'}),feature({type:'Point',coordinates:[14,4]},{name:'New'})]);
   progressMap.addLayer({id:'labels',source:'labels',type:'circle',symbol:{layout:{'text-field':['get','name'],'text-size':18},paint:{'text-color':'#ff00ff'}}});
   progressMap.setExtent(new emap.Bounds(0,0,10,10));progressMap.render();
  });await settled(page);await expect.poll(()=>page.evaluate(()=>progressMap.ctx.render._labels?.stats.placed??0)).toBeGreaterThan(0);
  const before=await page.evaluate(()=>progressMap.ctx.render._painter.stats.geometryChunks.builds);
  await page.mouse.move(700,520);await page.mouse.down();for(let i=1;i<=20;i++){await page.mouse.move(700-i*25,520);await page.waitForTimeout(16);}
  await expect.poll(()=>page.evaluate(()=>progressMap.ctx.render._painter.stats.geometryChunks.builds),{timeout:30000}).toBeGreaterThan(before);
  await expect.poll(()=>page.evaluate(()=>progressMap.ctx.render._labels.placements.some(l=>l.text==='New')),{timeout:30000}).toBe(true);
  expect(await page.evaluate(()=>progressMap.ctx.render._navSnapshotTransform!==null)).toBe(true);
  expect(await page.evaluate(()=>progressMap.ctx.render._canvas.style.transform)).toBe('');
  const green=await pixels(page,'pixel',[14.4,2.4]);expect(green[1]).toBeGreaterThan(130);expect(green[0]).toBeLessThan(80);
  await page.mouse.up();await settled(page);await dispose(page);
 });
 test(`${renderer}: native navigation keeps actual MSDF pixel height and point-label offsets at the requested size`,async({page})=>{
  await boot(page,renderer);
  await page.evaluate(async()=>{
   await addProgressSource('point',[feature({type:'Point',coordinates:[0,0]},{name:'Label'})]);
   progressMap.addLayer({id:'point',source:'point',type:'circle',symbol:{layout:{'text-field':['get','name'],'text-size':24},paint:{'text-color':'#ff00ff','text-halo-width':0}}});
   progressMap.setExtent(new emap.Bounds(-4,-4,4,4));progressMap.render();
  });await expect.poll(()=>page.evaluate(()=>progressMap.ctx.render._labels?.stats.placed??0)).toBe(1);await settled(page);
  const before=await pixels(page,'text'),uploads=await page.evaluate(()=>progressMap.ctx.render._painter.stats.text.textureUploads);
  await page.evaluate(()=>{const r=progressMap.ctx.render;r.beginNavigation();progressMap.ctx.view._viewport.transform.scale(2,400,300);r.updateNavigation();});
  await expect.poll(()=>page.evaluate(()=>progressMap.ctx.render._painter.stats.presentation.replays)).toBeGreaterThan(0);
  const after=await pixels(page,'text');expect(after.n).toBeGreaterThan(10);expect(Math.abs(after.height-before.height)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>progressMap.ctx.render._painter.stats.text.textureUploads)).toBe(uploads);
  expect(await page.evaluate(()=>progressMap.ctx.render._canvas.style.transform)).toBe('');
  await page.evaluate(()=>progressMap.ctx.render.endNavigation());await settled(page);await dispose(page);
 });
}

for(const renderer of ['webgl2','webgpu'])test(`${renderer}: cached screen strokes reproject correctly during a zoom while replacement work is held`,async({page})=>{
 await boot(page,renderer,true);
 await page.evaluate(async()=>{
  await addProgressSource('stroke',[feature({type:'LineString',coordinates:Array.from({length:100100},(_,i)=>[-5+i/10000,0])})]);
  progressMap.addLayer({id:'stroke',source:'stroke',type:'line',paint:{'line-color':'#2266dd','line-width':6}});
  progressMap.setExtent(new emap.Bounds(-4,-4,4,4));progressMap.render();
 });await settled(page);
 expect(await page.evaluate(()=>progressMap.ctx.render._painter.stats.geometryChunks.screenChunks)).toBeGreaterThan(0);
 await page.evaluate(()=>{
  const r=progressMap.ctx.render,worker=r._painter.chunks.worker,build=worker.build.bind(worker);
  const batch=worker.buildBatch.bind(worker);
  for(const [method,run] of [['build',build],['buildBatch',batch]])worker[method]=(packet,signal)=>new Promise((resolve,reject)=>{window.releaseStroke=()=>{worker.build=build;worker.buildBatch=batch;run(packet,signal).then(resolve,reject);};});
  r.beginNavigation();r.deps.view._viewport.transform.scale(2,400,300);r.deps.view._viewport.transform.translate(50,30);r.updateNavigation();
 });
 await expect.poll(()=>page.evaluate(()=>progressMap.ctx.render._painter.stats.presentation.replays)).toBeGreaterThan(0);
 const blue=await pixels(page,'pixel',[0,0]);expect(blue[2]).toBeGreaterThan(180);expect(blue[0]).toBeLessThan(70);
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseStroke==='function')).toBe(true);
 const held=await pixels(page,'pixel',[0,0]);expect(held).toEqual(blue);
 expect(await page.evaluate(()=>progressMap.ctx.render._canvas.style.transform)).toBe('');
 await page.evaluate(()=>{releaseStroke();progressMap.ctx.render.endNavigation();});await settled(page);await dispose(page);
});


for (const renderer of ['webgl2', 'webgpu']) test(`${renderer}: cold near-view fill uploads omit offscreen storage without changing pixels or source features`, async ({page}) => {
  test.setTimeout(120000);
  await boot(page, renderer);
  await page.evaluate(async () => {
    const polygons=[];
    for(let y=0;y<150;y++)for(let x=0;x<150;x++)polygons.push([square(x,y,.8),square(x+.2,y+.2,.2)]);
    await addProgressSource('storage',[feature({type:'MultiPolygon',coordinates:polygons})]);
    progressMap.addLayer({id:'storage',source:'storage',type:'fill',paint:{'fill-color':'#2255cc','fill-opacity':.6,'line-width':0}});
    progressMap.setExtent(new emap.Bounds(70,70,80,80));progressMap.render();
  });
  await settled(page);
  const clipped=await pixels(page);
  const small=await page.evaluate(()=>progressMap.ctx.render._painter.stats);
  expect(small.geometryChunks.uploadCulledBytes).toBeGreaterThan(1024*1024);
  await page.evaluate(()=>{
    const p=progressMap.ctx.render._painter,c=p.chunks;
    window.originalStorageRequest=c.request.bind(c);
    c.request=(input,owner)=>originalStorageRequest({...input,storageBounds:undefined},owner);
    p.clearGeometryCache({sourceId:'storage'});progressMap.render();
  });
  await settled(page);
  expect(await pixels(page)).toEqual(clipped);
  expect((await page.evaluate(()=>progressMap.ctx.render._painter.stats)).liveBufferBytes).toBeGreaterThan(small.liveBufferBytes*5);
  await page.evaluate(()=>{
    const p=progressMap.ctx.render._painter;p.chunks.request=originalStorageRequest;
    p.clearGeometryCache({sourceId:'storage'});
    progressMap.setExtent(new emap.Bounds(120,120,130,130));progressMap.render();
  });
  await settled(page);
  expect((await pixels(page,'pixel',[125.6,125.6]))[2]).toBeGreaterThan(180);
  expect(await page.evaluate(()=>progressMap.getSource('storage').getLayers()[0].shapes.length)).toBe(1);
  expect((await page.evaluate(()=>progressMap.ctx.render._painter.stats)).liveBufferBytes).toBeLessThan(small.liveBufferBytes*2);
  await dispose(page);
});

for(const renderer of ['webgl2','webgpu'])test(`${renderer}: pans within resident source coverage do not regenerate screen geometry`,async({page})=>{
 await boot(page,renderer,true);
 await page.evaluate(async()=>{
  const source=await addProgressSource('stable',[largeLine()]);
  progressMap.addLayer({id:'stable',source:'stable',type:'line',paint:{'line-color':'#2255cc','line-width':2}});
  progressMap.setExtent(new emap.Bounds(-30,-30,30,30));progressMap.render();
 });await settled(page);
 const before=await page.evaluate(()=>progressMap.ctx.render._painter.stats);
 for(const [dx,dy] of [[12,7],[-19.25,3.5],[7.25,-10.5]]){
  await page.evaluate(([dx,dy])=>{progressMap.ctx.view._viewport.transform.translate(dx,dy);progressMap.render();},[dx,dy]);await settled(page);
 }
 const after=await page.evaluate(()=>progressMap.ctx.render._painter.stats);
 expect(after.geometryChunks.builds).toBe(before.geometryChunks.builds);
 expect(after.uploads).toBe(before.uploads);
 await dispose(page);
});


for (const renderer of ['webgl2','webgpu']) test(`${renderer}: odd uint16 fill uploads and nonzero indexed ranges match uint32 pixels`,async({page})=>{
 await boot(page,renderer);await settled(page);
 await page.evaluate(()=>{
  progressMap.setExtent(new emap.Bounds(0,0,10,10));progressMap.render();
  window.drawIndexProbe=(bits,ranged)=>{
   const gpu=progressMap.ctx.render._painter.gpu;
   const vertices=Float32Array.from([2,2,0,0,8,2,0,0,2,8,0,0,8,8,0,0]);
   const Type=bits===16?Uint16Array:Uint32Array;
   const mesh=gpu.createMesh({kind:'fill',vertices,indices:Type.from(ranged?[0,1,2,2,1,3]:[2,1,3]),count:ranged?6:3});
   gpu.begin(progressMap.getTransform());
   gpu.drawMesh(mesh,{color:[.9,.1,.3,.65]},undefined,ranged?[{firstIndex:3,indexCount:3}]:undefined);
   gpu.end();gpu.destroyMesh(mesh);
  };
 });
 await settled(page);
 await page.evaluate(()=>drawIndexProbe(32,false));const reference=await pixels(page);
 await page.evaluate(()=>drawIndexProbe(16,false));expect(await pixels(page)).toEqual(reference);
 await page.evaluate(()=>drawIndexProbe(16,true));expect(await pixels(page)).toEqual(reference);
 await page.evaluate(()=>drawIndexProbe(32,true));expect(await pixels(page)).toEqual(reference);
 await dispose(page);
});


for (const renderer of ['webgl2', 'webgpu']) for (const kind of ['fill', 'path']) {
 test(`${renderer}: ${kind} membership handoff never blanks or doubles existing pixels while a replacement is held`, async ({page}) => {
  test.setTimeout(90000); await boot(page,renderer,true);
  await page.evaluate(async kind => {
   const features=[1.05,1.1,1.15].map((x,id)=>feature({type:'Polygon',coordinates:[square(x,1.1,.035)]},{id}));
   const source=await addProgressSource('handoff',[...features,largeLine()]);
   const layer=source.getLayers().find(l=>l.geometry_type==='polygon');
   progressMap.addLayer({id:'handoff',source:'handoff','source-layer':layer.name,type:kind==='fill'?'fill':'line',paint:kind==='fill'?{'fill-color':'#0000ff','fill-opacity':.5,'line-width':0}:{'line-color':'#0000ff80','line-width':6}});
   const c=progressMap.ctx.render._painter.chunks;
   window.handoffSelection=[0,1];window.handoffRequest=c.request.bind(c);
   // Model successive viewport candidate selections without altering source data.
   c.request=(input,owner)=>handoffRequest(owner.id==='handoff'?{...input,ids:Uint32Array.from(handoffSelection)}:input,owner);
   window.holdHandoff=()=>{
    const worker=c.worker,build=worker.build.bind(worker),batch=worker.buildBatch.bind(worker);
    window.releaseHandoff=undefined;
    for(const [method,run] of [['build',build],['buildBatch',batch]])worker[method]=(packet,signal)=>new Promise((resolve,reject)=>{
     window.releaseHandoff=()=>{worker.build=build;worker.buildBatch=batch;run(packet,signal).then(resolve,reject);};
     signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
   };
   progressMap.setExtent(new emap.Bounds(.8,.8,1.4,1.4));progressMap.render();
  },kind);
  await settled(page);
  const at=kind==='fill'?[1.1175,1.1175]:[1.1175,1.1];
  const before=await pixels(page,'pixel',at);
  expect(before[2]).toBe(255);expect(before[0]).toBeGreaterThan(120);expect(before[0]).toBeLessThan(135);
  const count=await page.evaluate(()=>[...progressMap.ctx.render._painter.chunks.requests.values()][0].entries.length);
  expect(count).toBe(1);
  await page.evaluate(()=>{
   holdHandoff();handoffSelection=[1,2];
   const t=progressMap.ctx.view._viewport.transform;t.translate(6,3);t.scale(1.02,400,300);progressMap.render();
  });
  await expect.poll(()=>page.evaluate(()=>typeof releaseHandoff==='function')).toBe(true);
  await page.evaluate(()=>progressMap.render());
  expect(await page.evaluate(()=>progressMap.ctx.render._painter.frameComplete)).toBe(false);
  expect(await pixels(page,'pixel',at)).toEqual(before);
  // Camera-only replay must retain the same incomplete handoff too.
  await page.evaluate(()=>{const p=progressMap.ctx.render._painter;const t=progressMap.getTransform();t.translate(3,2);Object.assign(progressMap.ctx.view._viewport.transform,t);p.renderNavigation(t);});
  expect(await pixels(page,'pixel',at)).toEqual(before);
  await page.evaluate(()=>releaseHandoff());await settled(page);
  expect(await pixels(page,'pixel',at)).toEqual(before);
  // A filter change is not navigation: it must not keep the old selected member.
  await page.evaluate(()=>{progressMap.ctx.render._painter.chunks.request=handoffRequest;holdHandoff();progressMap.setFilter('handoff',['==',['get','id'],2]);progressMap.render();});
  await expect.poll(()=>page.evaluate(()=>typeof releaseHandoff==='function')).toBe(true);
  expect(await pixels(page,'pixel',at)).toEqual([255,255,255,255]);
  await page.evaluate(()=>releaseHandoff());await settled(page);
  expect(await pixels(page,'pixel',at)).toEqual([255,255,255,255]);
  await dispose(page);
 });
}

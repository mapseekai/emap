import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { resolve, sep } from 'node:path';
import { installCanvasReadback } from './fixtures/canvas-readback.mjs';
import { test, expect } from '@playwright/test';
const base='/mapseekai/emap/examples/';
async function runtime(page) {
  await page.goto(base+'luma-benchmark/');
  await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
  await page.evaluate(()=>{lumaBenchmark.dispose();document.body.replaceChildren();});
}
async function create(page, renderer) {
  return page.evaluate(async renderer=>{
    const host=document.createElement('div');host.id='map';
    Object.assign(host.style,{position:'fixed',inset:'0',width:'800px',height:'600px',background:'white'});document.body.append(host);
    const map=await emap.Emap.create({container:host,...(renderer?{renderer}:{}),msdfWorkerUrl:'/mapseekai/emap/examples/emap-msdf-worker.js'});
    window.formalMap=map;window.renderErrors=[];map.on('error',e=>renderErrors.push(String(e.error)));
    const add=async(id,type,geometry,paint)=>{
      const source=new emap.TopologySource(id);
      await source.setData({filename:id+'.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{name:id,rank:3},geometry}]}))});
      await map.addSource(id,source);map.addLayer({id,source:id,type,paint});
    };
    await add('area','fill',{type:'Polygon',coordinates:[[[-3,-3],[3,-3],[3,-1],[-3,-1],[-3,-3]],[[-.5,-2.5],[-.5,-1.5],[.5,-1.5],[.5,-2.5],[-.5,-2.5]]]},{'fill-color':'#2266cc','fill-opacity':.75,'line-width':0});
    await add('road','line',{type:'LineString',coordinates:[[-3,2],[0,3],[3,2]]},{'line-color':'#22aa44','line-width':6});
    await add('poi','circle',{type:'Point',coordinates:[0,0]},{'circle-color':'#ee2222','circle-radius':10});
    map.setExtent(new emap.Bounds(-4,-4,4,4));map.render();
    window.mapPixel=async(x,y)=>{
      map.render();const canvas=map.ctx.render._canvas;
      const image=await createImageBitmap(canvas),c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();
      const p=map.getTransform().project(x,y),dpr=window.devicePixelRatio||1;
      return [...ctx.getImageData(Math.round(p[0]*dpr),Math.round(p[1]*dpr),1,1).data];
    };
    window.flushFormal=async()=>{for(let i=0;i<3;i++){map.render();await new Promise(r=>requestAnimationFrame(r));await map.ctx.render._labels?.settled();}};
    return {renderer:map.getRenderer(),canvases:[...host.querySelectorAll('canvas')].map(c=>c.dataset.emapRenderer)};
  },renderer);
}
for(const renderer of ['canvas2d','webgl2','webgpu'])test(`${renderer}: formal Emap geometry, symbols, cache, filters, edits and disposal`,async({page},info)=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.stack??e.message));await runtime(page);
  const created=await create(page,renderer);expect(created.renderer).toBe(renderer);expect(created.canvases).toEqual([renderer,'canvas2d']);
  await page.evaluate(()=>flushFormal());
  const pixels=await page.evaluate(async()=>({point:await mapPixel(0,0),area:await mapPixel(2,-2),hole:await mapPixel(0,-2),line:await mapPixel(0,3)}));
  expect(pixels.point[0]).toBeGreaterThan(180);expect(pixels.point[1]).toBeLessThan(90);
  expect(pixels.area[2]).toBeGreaterThan(170);expect(pixels.area[3]).toBeGreaterThan(150);expect(pixels.hole[3]).toBe(0);expect(pixels.line[1]).toBeGreaterThan(140);expect(pixels.line[0]).toBeLessThan(90);
  await page.evaluate(()=>{
    const url='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#aa22cc"/></svg>');
    formalMap.setLayerSymbol('poi',{images:{marker:{url,size:[32,32]}},layout:{'icon-image':'marker','text-field':['get','name'],'text-size':18,'text-offset':[0,1.2]},paint:{'text-color':'#dd1177'},labeling:{priority:3}});
  });
  await expect.poll(()=>page.evaluate(async()=>{await flushFormal();return formalMap.ctx.render._icons?.stats.images??0;})).toBe(1);
  await expect.poll(()=>page.evaluate(async()=>{await flushFormal();return formalMap.ctx.render._labels?.stats.placed??0;})).toBe(1);
  const symbolPixels=await page.evaluate(async()=>{
    const icon=await mapPixel(0,0), bitmap=await createImageBitmap(formalMap.ctx.render._canvas);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let text=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]>200&&pixels[i+1]<60&&pixels[i+2]>90&&pixels[i+2]<145&&pixels[i+3]>100)text++;
    canvas.width=canvas.height=0;return {icon,text};
  });
  expect(symbolPixels.icon[2]).toBeGreaterThan(180);expect(symbolPixels.icon[0]).toBeGreaterThan(140);
  expect(symbolPixels.text).toBeGreaterThan(5);
  const warm=await page.evaluate(()=>formalMap.ctx.render._painter.stats??null);
  await page.evaluate(async()=>{formalMap.setSymbolLayoutProperty('poi','text-size',22);formalMap.setSymbolPaintProperty('poi','icon-opacity',.6);await flushFormal();});
  if(renderer!=='canvas2d'){
    const next=await page.evaluate(()=>formalMap.ctx.render._painter.stats);
    expect(next.uploads).toBe(warm.uploads);expect(next.textureUploads).toBe(warm.textureUploads);
    expect(next.text.textureUploads).toBe(warm.text.textureUploads);
  }
  await page.evaluate(()=>formalMap.removeLayerSymbol('poi'));await page.evaluate(()=>flushFormal());
  const restored=await page.evaluate(()=>mapPixel(0,0));expect(restored[0]).toBeGreaterThan(180);
  await page.evaluate(()=>formalMap.setFilter('poi',['==',['get','name'],'missing']));await page.evaluate(()=>flushFormal());
  expect((await page.evaluate(()=>mapPixel(0,0)))[3]).toBe(0);
  await page.evaluate(()=>formalMap.setFilter('poi',null));
  await page.evaluate(()=>formalMap.setLayerVisibility('area','none'));await page.evaluate(()=>flushFormal());
  expect((await page.evaluate(()=>mapPixel(2,-2)))[3]).toBe(0);
  // Drive the real formal edit/history APIs, then the actual vertex-edit pointer handler.
  await page.evaluate(async()=>{
    const map=formalMap,feature=map.queryFeatures(map.getTransform().project(0,0))[0];
    if(!feature)throw new Error('Point picking failed');
    map.select([feature]);if(!map.editSession.translateSelected(1,0))throw new Error('Translate failed');
    map.clearSelection();await flushFormal();
  });
  expect((await page.evaluate(()=>mapPixel(1,0)))[0]).toBeGreaterThan(180);
  expect((await page.evaluate(()=>mapPixel(0,0)))[3]).toBe(0);
  await page.evaluate(async()=>{if(!formalMap.undo())throw new Error('Undo failed');await flushFormal();});
  expect((await page.evaluate(()=>mapPixel(0,0)))[0]).toBeGreaterThan(180);
  await page.evaluate(async()=>{if(!formalMap.redo())throw new Error('Redo failed');formalMap.undo();await flushFormal();formalMap.vertexEdit.enable();});
  // The formal VertexEditHandler edits topological line/polygon nodes; points use
  // editSession.translateSelected (exercised above), not the path-vertex handler.
  const node=await page.evaluate(()=>{
    const d=formalMap.getSource('road').getArcs().getVertexData();
    return {pixel:formalMap.getTransform().project(d.xx[1],d.yy[1]),before:[...d.xx,...d.yy]};
  });
  await page.mouse.move(...node.pixel);await page.mouse.down();await page.mouse.move(node.pixel[0]+24,node.pixel[1]+32,{steps:5});
  const live=await page.evaluate(async()=>{const d=formalMap.getSource('road').getArcs().getVertexData();return mapPixel(d.xx[1],d.yy[1]);});
  expect(live[1]).toBeGreaterThan(140); // Main geometry, not only the Canvas edit preview, follows a live drag.
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>{const d=formalMap.getSource('road').getArcs().getVertexData();return [...d.xx,...d.yy];})).not.toEqual(node.before);
  await page.evaluate(()=>{formalMap.vertexEdit.disable();formalMap.undo();});await page.evaluate(()=>flushFormal());
  expect(await page.evaluate(()=>{const d=formalMap.getSource('road').getArcs().getVertexData();return [...d.xx,...d.yy];})).toEqual(node.before);
  expect((await page.evaluate(()=>mapPixel(0,0)))[0]).toBeGreaterThan(180);
  const initial=await page.evaluate(()=>formalMap.getCenter());
  await page.mouse.move(700,540);await page.mouse.down();await page.mouse.move(760,560,{steps:5});await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>formalMap.getCenter())).not.toEqual(initial);
  expect(await page.evaluate(()=>renderErrors)).toEqual([]);
  await page.screenshot({path:info.outputPath('formal-'+renderer+'.png')});
  const released=await page.evaluate(async()=>{const p=formalMap.ctx.render._painter;await formalMap.dispose();return {canvases:document.querySelectorAll('#map canvas').length,stats:p.stats??null};});
  expect(released.canvases).toBe(0);if(released.stats){expect(released.stats.liveBufferBytes).toBe(0);expect(released.stats.liveTextureBytes).toBe(0);}
  await expect.poll(()=>page.workers().length).toBe(0);expect(errors).toEqual([]);
});
test('default is WebGL2 and unavailable backend rejects instead of silently using Canvas2D',async({page})=>{
  await runtime(page);expect((await create(page,undefined)).renderer).toBe('webgl2');await page.evaluate(()=>formalMap.dispose());
  const result=await page.evaluate(async()=>{
    const host=document.createElement('div');document.body.append(host);
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args);};
    let error='';try{await emap.Emap.create({container:host});}catch(e){error=String(e);}
    finally{HTMLCanvasElement.prototype.getContext=original;}
    return {error,canvases:host.querySelectorAll('canvas').length};
  });
  expect(result.error).not.toBe('');expect(result.canvases).toBe(0);
});

for(const renderer of ['canvas2d','webgl2','webgpu'])test(`${renderer}: formal GeoTIFF pass retains source order, pixels and texture reuse`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.stack??e.message));await installCanvasReadback(page);
  await page.goto(base+'geotiff-viewer/?renderer='+renderer);
  await expect(page.locator('#levels')).toHaveText('4');
  await expect.poll(()=>page.evaluate(()=>{const s=geotiffDemo.stats();return s.activeReads+s.queuedReads+s.pendingFrames;})).toBe(0);
  expect(await page.evaluate(()=>geotiffDemo.map.getRenderer())).toBe(renderer);
  await page.evaluate(()=>{geotiffDemo.map.render();window.rasterMapPixel=async()=>{
    const map=geotiffDemo.map;map.render();const c=map.ctx.render._canvas,data=await window.readCanvasPixels(c);
    const [x,y]=map.getTransform().project(116.005,39.995),pr=devicePixelRatio||1,i=(Math.round(y*pr)*c.width+Math.round(x*pr))*4;
    return [...data.slice(i,i+4)];
  };});
  await expect.poll(()=>page.evaluate(()=>rasterMapPixel())).toEqual([180,0,0,255]);
  const warm=await page.evaluate(()=>geotiffDemo.map.ctx.render._painter.stats?.textureUploads);
  await page.evaluate(()=>{for(let i=0;i<5;i++)geotiffDemo.map.render();});
  if(renderer!=='canvas2d')expect(await page.evaluate(()=>geotiffDemo.map.ctx.render._painter.stats.textureUploads)).toBe(warm);
  await page.evaluate(async()=>{
    const map=geotiffDemo.map,source=new emap.TopologySource('overlay-point');
    await source.setData({filename:'overlay.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[116.005,39.995]}}]}))});
    await map.addSource('overlay-point',source);map.addLayer({id:'overlay-point',source:'overlay-point',type:'circle',paint:{'circle-color':'#22cc44','circle-radius':12}});
    map.ctx.render.setSourceOrder(['overlay-point',geotiffDemo.currentId]);map.render();
  });
  await expect.poll(()=>page.evaluate(()=>rasterMapPixel())).toEqual([34,204,68,255]);
  await page.evaluate(()=>{geotiffDemo.map.ctx.render.setSourceOrder([geotiffDemo.currentId,'overlay-point']);geotiffDemo.map.render();});
  await expect.poll(()=>page.evaluate(()=>rasterMapPixel())).toEqual([180,0,0,255]);
  await page.evaluate(async()=>{geotiffDemo.map.removeSource('overlay-point');geotiffDemo.map.ctx.raster.remove(geotiffDemo.currentId);geotiffDemo.map.render();await geotiffDemo.map.dispose();});
  await expect.poll(()=>page.workers().length).toBe(0);expect(errors).toEqual([]);
});
test('published ESM default backend and sibling MSDF resources work without experimental imports',async({page})=>{
  const root=resolve('dist'),errors=[];page.on('pageerror',e=>errors.push(e.stack??e.message));
  // Published ESM intentionally keeps Cordis as an npm dependency. Resolve just
  // that dependency via import map, keeping emap chunks/worker URLs untouched.
  const dependency=await build({stdin:{contents:'export * from "cordis";',resolveDir:resolve('.')},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
  await page.route('**/__emap_deps/cordis.mjs',route=>route.fulfill({body:Buffer.from(dependency.outputFiles[0].contents),contentType:'text/javascript'}));
  await page.route('**/__emap_dist/**',async route=>{
    const relative=decodeURIComponent(new URL(route.request().url()).pathname.split('/__emap_dist/')[1]);const path=resolve(root,relative);
    if(!path.startsWith(root+sep)){await route.abort();return;}
    const type=path.endsWith('.wasm')?'application/wasm':path.endsWith('.json')?'application/json':path.endsWith('.woff')?'font/woff':'text/javascript';
    try{await route.fulfill({body:await readFile(path),contentType:type});}catch{await route.fulfill({status:404});}
  });
  await page.goto(base);
  await page.evaluate(async()=>{
    document.body.replaceChildren();
    const imports=document.createElement('script');imports.type='importmap';imports.textContent=JSON.stringify({imports:{cordis:'/__emap_deps/cordis.mjs'}});document.head.append(imports);
    const emap=await import('/__emap_dist/emap.mjs');
    const host=document.createElement('div');Object.assign(host.style,{width:'800px',height:'600px'});document.body.append(host);
    const map=await emap.Emap.create({container:host});window.esmMap=map;
    const source=new emap.TopologySource('esm');await source.setData({filename:'esm.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{name:'北京 ESM'},geometry:{type:'Point',coordinates:[0,0]}}]}))});
    await map.addSource('esm',source);map.addLayer({id:'esm',source:'esm',type:'circle',symbol:{layout:{'text-field':['get','name']}}});
    map.setExtent(new emap.Bounds(-1,-1,1,1));map.render();
  });
  expect(await page.evaluate(()=>esmMap.getRenderer())).toBe('webgl2');
  await expect.poll(()=>page.evaluate(async()=>{esmMap.render();await esmMap.ctx.render._labels?.settled();esmMap.render();return esmMap.ctx.render._labels?.stats.placed??0;})).toBe(1);
  expect(page.workers().some(w=>w.url().includes('/__emap_dist/emap-msdf-worker.js'))).toBe(true);
  // Published relative geometry Worker must work without experimental source imports.
  await page.evaluate(async()=>{
    const emap=await import('/__emap_dist/emap.mjs'),source=new emap.TopologySource('esm-lines');
    await source.setData({filename:'line.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:Array.from({length:100100},(_,i)=>[i/100100-.5,.2+Math.sin(i/5000)*.1])}}]}))});
    await esmMap.addSource('esm-lines',source);esmMap.addLayer({id:'esm-lines',source:'esm-lines',type:'line'});esmMap.render();
  });
  await expect.poll(()=>page.evaluate(()=>esmMap.ctx.render._painter.frameComplete&&esmMap.ctx.render._painter.stats.geometryChunks.pending===0)).toBe(true);
  expect(page.workers().some(w=>w.url().includes('/__emap_dist/emap-geometry-worker.js'))).toBe(true);
  await page.evaluate(()=>esmMap.dispose());await expect.poll(()=>page.workers().length).toBe(0);expect(errors).toEqual([]);
});


async function composedPointPixel(page) {
  // Read the compositor, not a new GPU frame. Calling map.render() here would
  // hide a broken snapshot/navigation path, especially on WebGPU.
  const image = await page.screenshot({ clip: { x: 0, y: 0, width: 800, height: 600 } });
  return page.evaluate(async data => {
    const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const [x,y]=formalMap.getTransform().project(0,0);
    const pixel=[...ctx.getImageData(Math.round(x),Math.round(y),1,1).data];
    canvas.width=canvas.height=0;return pixel;
  }, image.toString('base64'));
}
async function settleRequests(page) {
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await expect.poll(()=>page.evaluate(()=>formalMap.ctx.render._pendingRender)).toBe(0);
}
for (const renderer of ['webgl2','webgpu']) {
  test(`${renderer}: formal GPU navigation replays resident buffers at CSS size and settles the current camera`, async({page},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.stack??e.message));
    await runtime(page);await create(page,renderer);await settleRequests(page);
    const before=await page.evaluate(()=>({...formalMap.ctx.render._painter.stats,cpu:formalMap.ctx.render._scheduler.lastFrameMs}));
    expect(before.cpu).toBeLessThan(1000/30);
    await page.mouse.move(690,540);await page.mouse.down();
    for(let i=1;i<=20;i++){await page.mouse.move(690+i*4,540+i);await page.waitForTimeout(16);}
    const during=await page.evaluate(()=>({...formalMap.ctx.render._painter.stats,fast:formalMap.ctx.render._scheduler.fastActive}));
    expect(during.presentation.replays).toBeGreaterThan(before.presentation.replays);expect(during.uploads).toBe(before.uploads);
    expect(await page.evaluate(()=>formalMap.ctx.render._navSnapshotTransform!==null)).toBe(true);
    const pixel=await composedPointPixel(page);expect(pixel[0]).toBeGreaterThan(180);expect(pixel[1]).toBeLessThan(90);
    await page.screenshot({path:info.outputPath('snapshot-'+renderer+'.png')});
    await page.mouse.up();await expect.poll(()=>page.evaluate(()=>formalMap.ctx.render._scheduler.fastActive)).toBe(false);await settleRequests(page);
    expect(await page.evaluate(()=>formalMap.ctx.render._painter.stats.presentation.complete)).toBeGreaterThan(before.presentation.complete);
    expect(await page.evaluate(()=>formalMap.ctx.render._canvas.style.transform)).toBe('');
    // Wheel zoom uses the same policy, with a delayed interaction end.
    const wheel=await page.evaluate(()=>({...formalMap.ctx.render._painter.stats}));
    await page.mouse.move(500,300);
    for(let i=0;i<5;i++){await page.mouse.wheel(0,-30);await page.waitForTimeout(25);}
    const zoom=await page.evaluate(()=>({...formalMap.ctx.render._painter.stats,fast:formalMap.ctx.render._scheduler.fastActive}));
    expect(zoom.presentation.replays).toBeGreaterThan(wheel.presentation.replays);expect(zoom.uploads).toBe(wheel.uploads);
    await expect.poll(()=>page.evaluate(()=>formalMap.ctx.render._scheduler.fastActive)).toBe(false);await settleRequests(page);
    expect(await page.evaluate(()=>formalMap.ctx.render._painter.stats.presentation.complete)).toBeGreaterThan(wheel.presentation.complete);
    await page.evaluate(()=>formalMap.dispose());expect(errors).toEqual([]);
  });
  test(`${renderer}: style/filter/source invalidations replace snapshots during a live gesture`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.stack??e.message));
    await runtime(page);await create(page,renderer);await settleRequests(page);
    await page.mouse.move(680,540);await page.mouse.down();await page.mouse.move(720,550,{steps:5});await settleRequests(page);
    expect(await page.evaluate(()=>formalMap.ctx.render._navSnapshotTransform!==null)).toBe(true);
    await page.evaluate(()=>formalMap.setPaintProperty('poi','circle-color','#22dd44'));await settleRequests(page);
    let pixel=await composedPointPixel(page);expect(pixel[1]).toBeGreaterThan(180);expect(pixel[0]).toBeLessThan(90);
    const fresh=await page.evaluate(()=>({...formalMap.ctx.render._painter.stats}));
    await page.mouse.move(740,555,{steps:4});await settleRequests(page);
    expect(await page.evaluate(()=>formalMap.ctx.render._painter.stats.presentation.replays)).toBeGreaterThan(fresh.presentation.replays);
    expect(await page.evaluate(()=>formalMap.ctx.render._painter.stats.uploads)).toBe(fresh.uploads);
    pixel=await composedPointPixel(page);expect(pixel[1]).toBeGreaterThan(180);expect(pixel[0]).toBeLessThan(90);
    await page.evaluate(()=>formalMap.setFilter('poi',['==',['get','name'],'absent']));await settleRequests(page);
    expect(await composedPointPixel(page)).toEqual([255,255,255,255]);
    await page.evaluate(()=>formalMap.setFilter('poi',null));await settleRequests(page);
    expect((await composedPointPixel(page))[1]).toBeGreaterThan(180);
    await page.evaluate(()=>{formalMap.removeLayer('poi');formalMap.removeSource('poi');});await settleRequests(page);
    expect(await composedPointPixel(page)).toEqual([255,255,255,255]);
    await page.mouse.up();await settleRequests(page);
    const released=await page.evaluate(async()=>{const p=formalMap.ctx.render._painter;await formalMap.dispose();return p.stats;});
    expect(released.geometryCache.bytes).toBe(0);expect(released.liveBufferBytes).toBe(0);expect(errors).toEqual([]);
  });
}


for(const renderer of ['webgl2','webgpu'])test(`${renderer}: consecutive gestures before settle retain the painted camera reference`,async({page})=>{
  await runtime(page);await create(page,renderer);await settleRequests(page);
  const before=await page.evaluate(()=>({...formalMap.ctx.render._painter.stats}));
  await page.evaluate(()=>{
    const r=formalMap.ctx.render;r.beginNavigation();formalMap.ctx.view._viewport.pan(40,0);r.updateNavigation();
  });await settleRequests(page);
  await page.evaluate(()=>{
    // Intentionally end and begin in one task, before the queued settle RAF.
    const r=formalMap.ctx.render;r.endNavigation();r.beginNavigation();formalMap.ctx.view._viewport.pan(20,0);r.updateNavigation();
  });await settleRequests(page);
  expect(await page.evaluate(()=>formalMap.ctx.render._painter.stats.presentation.replays)).toBeGreaterThanOrEqual(before.presentation.replays+2);
  expect(await page.evaluate(()=>formalMap.ctx.render._painter.stats.uploads)).toBe(before.uploads);
  const pixel=await composedPointPixel(page);expect(pixel[0]).toBeGreaterThan(180);expect(pixel[1]).toBeLessThan(90);
  await page.evaluate(()=>formalMap.ctx.render.endNavigation());await settleRequests(page);
  expect(await page.evaluate(()=>formalMap.ctx.render._painter.stats.presentation.complete)).toBeGreaterThan(before.presentation.complete);
  await page.evaluate(()=>formalMap.dispose());
});

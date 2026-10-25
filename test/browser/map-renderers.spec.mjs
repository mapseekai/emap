import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { resolve, sep } from 'node:path';
import { installCanvasReadback } from './fixtures/canvas-readback.mjs';
import { test, expect } from '@playwright/test';
const base='/mapseekai/emap/examples/';
for(const renderer of ['canvas2d','webgl2','webgpu'])test(`${renderer}: point styles have backend-independent alpha, zero radius and hollow strokes`,async({page})=>{
  await runtime(page);await create(page,renderer);
  await page.evaluate(async()=>{
    formalMap.removeLayer('area');formalMap.removeLayer('road');formalMap.removeLayer('poi');
    const source=new emap.TopologySource('duplicates');
    await source.setData({filename:'duplicates.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features:[0,1].map(()=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[0,0]}}))}))});
    await formalMap.addSource('duplicates',source);
    formalMap.addLayer({id:'dots',source:'duplicates',type:'circle',paint:{'circle-color':'rgba(255,0,0,0.5)','circle-radius':10}});
    await flushFormal();
  });
  expect((await page.evaluate(()=>mapPixel(0,0)))[3]).toBeCloseTo(192,0);
  await page.evaluate(async()=>{formalMap.setPaintProperty('dots','circle-radius',0);await flushFormal();});
  expect((await page.evaluate(()=>mapPixel(0,0)))[3]).toBe(0);
  await page.evaluate(async()=>{
    formalMap.removeLayer('dots');
    formalMap.addLayer({id:'thick',source:'road',type:'line',paint:{'line-color':'blue','line-width':12,'line-dasharray':[6,3]}});
    formalMap.addLayer({id:'hollow',source:'poi',type:'circle',paint:{'circle-color':'red','circle-radius':10,'circle-fill':false}});
    await flushFormal();
  });
  const samples=await page.evaluate(async()=>{
    const t=formalMap.getTransform(),p=t.project(0,0);
    return Promise.all([0,8,10,14].map(dx=>{const xy=t.unproject(p[0]+dx,p[1]);return mapPixel(...xy);}));
  });
  expect(samples[0][3]).toBe(0);expect(samples[1][3]).toBe(0);expect(samples[2][0]).toBeGreaterThan(180);expect(samples[3][3]).toBe(0);
});
for(const renderer of ['webgl2','webgpu'])test(`${renderer}: missing MSDF glyphs use browser text with visible diagnostics`,async({page})=>{
  await runtime(page);await create(page,renderer);
  await page.evaluate(async()=>{
    for(const layer of formalMap.getLayers())formalMap.removeLayer(layer.id);
    const source=new emap.TopologySource('languages');
    await source.setData({filename:'languages.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features:['Hello 北京','مرحبا','नमस्ते','😀'].map((name,i)=>({type:'Feature',properties:{name},geometry:{type:'Point',coordinates:[0,3-i*2]}}))}))});
    await formalMap.addSource('languages',source);
    formalMap.addLayer({id:'languages',source:'languages',type:'circle',paint:{'circle-radius':0},label:{field:'name',fontFamily:'sans-serif',fontSize:24,haloWidth:0,allowOverlap:true}});
  });
  await expect.poll(()=>page.evaluate(async()=>{await flushFormal();return formalMap.ctx.render._labels.stats.placed;})).toBe(4);
  const result=await page.evaluate(async()=>{
    const manager=formalMap.ctx.render._labels;
    formalMap.render();const b=await createImageBitmap(formalMap.ctx.render._canvas),c=document.createElement('canvas');c.width=b.width;c.height=b.height;const ctx=c.getContext('2d');ctx.drawImage(b,0,0);b.close();
    let colorful=0;const d=ctx.getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4)if(d[i]>150&&d[i+1]>70&&d[i+2]<100&&d[i+3]>100)colorful++;
    return {stats:manager.stats,rasters:manager.frame.labels.map(l=>({text:l.text,bitmap:!('mode' in l.raster)})),colorful,errors:renderErrors};
  });
  expect(result.stats.bitmapFallbackLabels).toBe(3);
  expect(result.stats.missingGlyphs).toBeGreaterThan(0);
  expect(result.rasters.find(r=>r.text==='Hello 北京').bitmap).toBe(false);
  for(const text of ['مرحبا','नमस्ते','😀'])expect(result.rasters.find(r=>r.text===text).bitmap).toBe(true);
  expect(result.colorful).toBeGreaterThan(10);expect(result.errors).toEqual([]);
  const ordered=await page.evaluate(async()=>{
    formalMap.removeLayer('languages');
    const label=(text,color)=>({text,fontFamily:'sans-serif',fontSize:32,color,haloWidth:0,allowOverlap:true});
    formalMap.addLayer({id:'bottom',source:'poi',type:'circle',paint:{'circle-radius':0},label:label('MMMMMM','red')});
    formalMap.addLayer({id:'middle',source:'poi',type:'circle',paint:{'circle-radius':0},label:label('مرحبا','blue')});
    formalMap.addLayer({id:'top',source:'poi',type:'circle',paint:{'circle-radius':0},label:label('MMMMMM','#00ff00')});
    const pixels=async()=>{await flushFormal();formalMap.render();const b=await createImageBitmap(formalMap.ctx.render._canvas),c=document.createElement('canvas');c.width=b.width;c.height=b.height;const ctx=c.getContext('2d');ctx.drawImage(b,0,0);b.close();return ctx.getImageData(0,0,c.width,c.height).data;};
    const mixed=await pixels(),stats={...formalMap.ctx.render._painter.stats.text};await pixels();const warm={...formalMap.ctx.render._painter.stats.text};
    formalMap.setLayerVisibility('bottom','none');formalMap.setLayerVisibility('middle','none');const top=await pixels();
    let green=0,mismatches=0,blue=0;for(let i=0;i<top.length;i+=4){if(top[i+1]>250&&top[i+3]>250){green++;if(mixed[i+1]<240)mismatches++;}if(mixed[i+2]>200&&mixed[i]<30&&mixed[i+1]<30&&mixed[i+3]>100)blue++;}
    return {green,mismatches,blue,stats,warm};
  });
  expect(ordered.green).toBeGreaterThan(10);expect(ordered.blue).toBeGreaterThan(10);expect(ordered.mismatches).toBe(0);
  expect(ordered.warm.textureUploads).toBe(ordered.stats.textureUploads);expect(ordered.warm.bufferUploads).toBe(ordered.stats.bufferUploads);
  const released=await page.evaluate(async()=>{const gpu=formalMap.ctx.render._painter.gpu;await formalMap.dispose();return gpu.memoryStats.nominalKnownGpuBytes;});
  expect(released).toBe(0);
});
async function runtime(page) {
  await installCanvasReadback(page);
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
      map.render();const canvas=map.ctx.render._canvas,pixels=await readCanvasPixels(canvas);
      const p=map.getTransform().project(x,y),dpr=window.devicePixelRatio||1;
      const px=Math.round(p[0]*dpr),py=Math.round(p[1]*dpr);
      if(px<0||py<0||px>=canvas.width||py>=canvas.height)return [0,0,0,0];
      const at=(py*canvas.width+px)*4;
      return [...pixels.slice(at,at+4)];
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
    const icon=await mapPixel(0,0),pixels=await readCanvasPixels(formalMap.ctx.render._canvas);let text=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]>200&&pixels[i+1]<60&&pixels[i+2]>90&&pixels[i+2]<145&&pixels[i+3]>100)text++;
    return {icon,text};
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
for (const renderer of ['canvas2d', 'webgl2', 'webgpu']) test(`${renderer}: formal labels retain filtered and high-priority tail features`, async ({page}, info) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await installCanvasReadback(page);
  await runtime(page); await create(page, renderer);
  await page.evaluate(async () => {
    const source = new emap.TopologySource('tail-labels');
    const features = Array.from({length: 33000}, (_, rank) => ({type: 'Feature', properties: {name: 'Tail '+rank, tailName: rank >= 32768 ? 'Tail '+rank : '', rank}, geometry: {type: 'Point', coordinates: [0, 0]}}));
    await source.setData({filename: 'tail-labels.geojson', content: new TextEncoder().encode(JSON.stringify({type: 'FeatureCollection', features}))});
    await formalMap.addSource('tail-labels', source);
    formalMap.addLayer({id: 'tail-labels', source: 'tail-labels', type: 'circle', filter: ['>=', ['get', 'rank'], 32768], label: {field: 'name', priority: ['get', 'rank'], maxLabels: 1, fontSize: 18, color: '#dd1177'}});
  });
  const evidence = [];
  for (const mode of ['filtered', 'empty text', 'global priority']) {
    if (mode !== 'filtered') await page.evaluate(mode => {
      formalMap.setFilter('tail-labels', null);
      formalMap.setLayerLabel('tail-labels', {field: mode === 'empty text' ? 'tailName' : 'name', priority: ['get', 'rank'], maxLabels: 1, fontSize: 18, color: '#dd1177'});
    }, mode);
    await page.evaluate(() => flushFormal());
    const result = await page.evaluate(async () => {
      const labels = formalMap.ctx.render._labels;
      formalMap.render();
      const pixels = await readCanvasPixels(formalMap.ctx.render._canvas);
      let painted = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 200 && pixels[i+1] < 60 && pixels[i+2] > 90 && pixels[i+2] < 145 && pixels[i+3] > 100) painted++;
      return {features: labels.placements.map(l => l.featureId), candidates: labels.stats.candidates, layoutMs: labels.stats.layoutMs, painted};
    });
    expect(result.features).toEqual([32999]);
    expect(result.candidates).toBe(mode === 'global priority' ? 20000 : 232);
    expect(result.painted).toBeGreaterThan(30);
    evidence.push({mode, ...result});
  }
  await info.attach('tail-labels', {body: JSON.stringify(evidence, null, 2), contentType: 'application/json'});
  await page.screenshot({path: info.outputPath('tail-labels.png')});
  expect(await page.evaluate(() => renderErrors)).toEqual([]);
  await page.evaluate(() => formalMap.dispose());
  await expect.poll(() => page.workers().length).toBe(0);
  expect(errors).toEqual([]);
});

for (const renderer of ['canvas2d', 'webgl2', 'webgpu']) test(`${renderer}: edited self-intersections keep even-odd fill and source vertices`, async ({page}) => {
  await runtime(page); await create(page, renderer);
  await page.evaluate(async () => {
    for (const id of ['area', 'road', 'poi']) formalMap.removeLayer(id);
    const source = new emap.TopologySource('bowtie');
    await source.setData({filename: 'bowtie.geojson', content: new TextEncoder().encode(JSON.stringify({type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [[[-2,-2],[2,-2],[2,2],[-2,2],[-2,-2]]]}}))});
    await formalMap.addSource('bowtie', source);
    formalMap.addLayer({id: 'bowtie', source: 'bowtie', type: 'fill', paint: {'fill-color': '#ff0000', 'line-width': 0}});
    const vertices = source.getArcs().getVertexData();
    vertices.xx.set([-2,2,-2,2,-2]); vertices.yy.set([-2,2,2,-2,-2]);
    emap.bumpEditVersion(source.getDataset());
  });
  await settleRequests(page);
  const result = await page.evaluate(async () => {
    const vertices = formalMap.getSource('bowtie').getArcs().getVertexData();
    return {top: await mapPixel(0,1), bottom: await mapPixel(0,-1), outside: await mapPixel(1.5,0), xx: [...vertices.xx], yy: [...vertices.yy]};
  });
  expect(result.top).toEqual([255,0,0,255]); expect(result.bottom).toEqual([255,0,0,255]);
  expect(result.outside[3]).toBe(0);
  expect(result.xx).toEqual([-2,2,-2,2,-2]); expect(result.yy).toEqual([-2,2,2,-2,-2]);
  expect(await page.evaluate(() => renderErrors)).toEqual([]);
  await page.evaluate(() => formalMap.dispose());
});

for (const renderer of ['webgl2', 'webgpu']) test(`${renderer}: a failed font keeps healthy labels visible and recovers after correction`, async ({page}) => {
  test.setTimeout(120000);
  await installCanvasReadback(page);
  await runtime(page); await create(page, renderer);
  await page.evaluate(async () => {
    window.addFontLabel = async (id, x, fontFamily) => {
      const source = new emap.TopologySource(id);
      await source.setData({filename: id+'.geojson', content: new TextEncoder().encode(JSON.stringify({type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [x,0]}}))});
      await formalMap.addSource(id, source);
      formalMap.addLayer({id, source: id, type: 'circle'});
      formalMap.setLayerLabel(id, {text: id, fontFamily, color: '#00aaee', fontSize: 24, allowOverlap: true});
    };
    window.visibleFontLabels = async () => {
      await flushFormal(); formalMap.render();
      const pixels = await readCanvasPixels(formalMap.ctx.render._canvas);
      let text = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 50 && pixels[i+1] > 100 && pixels[i+2] > 200 && pixels[i+3] > 100) text++;
      return {placed: formalMap.ctx.render._labels.stats.placed, text};
    };
    await addFontLabel('healthy', -1.5, 'sans-serif');
  });
  await expect.poll(() => page.evaluate(() => visibleFontLabels())).toMatchObject({placed: 1});
  const before = await page.evaluate(() => visibleFontLabels()); expect(before.text).toBeGreaterThan(30);
  await page.evaluate(() => addFontLabel('bad-font', 1.5, 'Arial'));
  await expect.poll(() => page.evaluate(async () => {await flushFormal(); return renderErrors;})).toContainEqual(expect.stringContaining('bad-font'));
  const mixed = await page.evaluate(() => visibleFontLabels());
  expect(mixed.placed).toBe(1); expect(mixed.text).toBeGreaterThan(30);
  await page.route('**/missing-font.ttf', route => route.fulfill({status: 404, body: 'Missing font'}));
  await page.evaluate(() => {
    renderErrors.length = 0;
    formalMap.setLayerLabel('bad-font', {text: 'failed download', fontFamily: 'custom', fontUrl: '/missing-font.ttf', color: '#00aaee', fontSize: 24, allowOverlap: true});
  });
  await expect.poll(() => page.evaluate(async () => {await flushFormal(); return renderErrors;})).toContainEqual(expect.stringContaining('bad-font'));
  const missing = await page.evaluate(() => visibleFontLabels());
  expect(missing.placed).toBe(1); expect(missing.text).toBeGreaterThan(30);
  await page.evaluate(() => formalMap.setLayerLabel('bad-font', {text: 'repaired', fontFamily: 'sans-serif', color: '#00aaee', fontSize: 24, allowOverlap: true}));
  await expect.poll(() => page.evaluate(() => visibleFontLabels())).toMatchObject({placed: 2});
  expect((await page.evaluate(() => visibleFontLabels())).text).toBeGreaterThan(mixed.text);
  await page.evaluate(() => formalMap.dispose());
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
  if(renderer!=='canvas2d') {
    const direct=await page.evaluate(()=>({gpu:geotiffDemo.map.ctx.render._painter.stats,raster:geotiffDemo.stats()}));
    expect(direct.gpu.pixelTextureUploads).toBeGreaterThan(0);
    expect(direct.raster.performance.canvasPreparedTiles).toBe(0);
    expect(direct.raster.performance.pixelPreclassifiedTiles).toBeGreaterThan(0);
    expect(direct.raster.pixelCacheBytes).toBe(direct.raster.cachedBytes);
  }
  if(renderer==='webgpu') {
    await page.evaluate(async()=>{
      const map=geotiffDemo.map;map.render();
      window.rasterRecoveryPixels=await readCanvasPixels(map.ctx.render._canvas);
      window.rasterLostDevice=map.ctx.render._painter.gpu.device;
      rasterLostDevice.handle.destroy();
    });
    await expect.poll(()=>page.evaluate(async()=>{
      const map=geotiffDemo.map,gpu=map.ctx.render._painter.gpu;map.render();
      if(gpu.device===rasterLostDevice||gpu.lost)return false;
      const after=await readCanvasPixels(map.ctx.render._canvas);
      return after.length===rasterRecoveryPixels.length&&after.every((v,i)=>v===rasterRecoveryPixels[i]);
    })).toBe(true);
  }
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
  await page.route('**/__emap_esm_test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><script type="importmap">{"imports":{"cordis":"/__emap_deps/cordis.mjs"}}</script></head><body></body></html>'}));
  await page.route('**/__emap_dist/**',async route=>{
    const relative=decodeURIComponent(new URL(route.request().url()).pathname.split('/__emap_dist/')[1]);const path=resolve(root,relative);
    if(!path.startsWith(root+sep)){await route.abort();return;}
    const type=path.endsWith('.wasm')?'application/wasm':path.endsWith('.json')?'application/json':path.endsWith('.woff')?'font/woff':'text/javascript';
    try{await route.fulfill({body:await readFile(path),contentType:type});}catch{await route.fulfill({status:404});}
  });
  await page.goto('/__emap_esm_test/');
  await page.evaluate(async()=>{
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
    await page.evaluate(()=>{
      // Exercise the fast-device branch deterministically, just as the slow-device
      // test below fixes its timing input. GPU submissions and pixels remain real.
      const r=formalMap.ctx.render;
      Object.defineProperty(r._scheduler,'lastFrameMs',{configurable:true,value:0});
      Object.defineProperty(r._painter,'navigationFrameMs',{configurable:true,value:0});
    });
    const before=await page.evaluate(()=>({...formalMap.ctx.render._painter.stats,cpu:formalMap.ctx.render._scheduler.lastFrameMs}));
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
    for (const refresh of [false, true]) {
      const fresh=await page.evaluate(()=>({...formalMap.ctx.render._painter.stats,point:formalMap.getTransform().project(0,0),transform:formalMap.ctx.render._canvas.style.transform}));
      if (refresh) {
        // Reproduce the 80 ms navigation refresh racing with a new pan in one frame.
        await page.evaluate(()=>{const r=formalMap.ctx.render;r._scheduleRender('redraw');formalMap.ctx.view._viewport.pan(20,5);r.updateNavigation();});
      } else await page.mouse.move(740,555,{steps:4});
      await settleRequests(page);
      const moved=await page.evaluate(()=>({...formalMap.ctx.render._painter.stats,point:formalMap.getTransform().project(0,0),transform:formalMap.ctx.render._canvas.style.transform}));
      // A queued complete refresh can consume navigation before either fast path.
      expect(moved.presentation.replays>fresh.presentation.replays || moved.presentation.complete>fresh.presentation.complete || (moved.transform!=='' && moved.transform!==fresh.transform)).toBe(true);
      expect(moved.point[0]-fresh.point[0]).toBeCloseTo(20,0);
      expect(moved.point[1]-fresh.point[1]).toBeCloseTo(5,0);
      expect(moved.uploads).toBe(fresh.uploads);
      pixel=await composedPointPixel(page);expect(pixel[1]).toBeGreaterThan(180);expect(pixel[0]).toBeLessThan(90);
    }
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
  await page.evaluate(()=>{
    // This case asserts native replay counts, so select the fast-device policy
    // explicitly; slow snapshot navigation has its own pixel regression below.
    const r=formalMap.ctx.render;
    Object.defineProperty(r._scheduler,'lastFrameMs',{configurable:true,value:0});
    Object.defineProperty(r._painter,'navigationFrameMs',{configurable:true,value:0});
  });
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

for (const renderer of ['webgl2', 'webgpu']) test(`${renderer}: slow GPU navigation reuses the composited frame and settles without stale content`, async ({page}, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await runtime(page); await create(page, renderer); await settleRequests(page);
  await page.evaluate(() => formalMap.setLayerSymbol('poi', {
    images: {marker: {url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#ee2222"/></svg>'), size: [20, 20]}},
    // Keep the marker-center sample clear of the fixed-above-point label.
    layout: {'icon-image': 'marker', 'text-field': ['get', 'name'], 'text-offset': [0, 0]},
  }));
  await expect.poll(() => page.evaluate(async () => { await flushFormal(); return formalMap.ctx.render._icons?.stats.images; })).toBe(1);
  await expect.poll(() => page.evaluate(async () => { await flushFormal(); return formalMap.ctx.render._labels?.stats.placed; })).toBe(1);
  await settleRequests(page);
  const before = await page.evaluate(() => {
    const r = formalMap.ctx.render;
    // Deterministic slow-device policy boundary; real GPU pixels and frame submissions below.
    Object.defineProperty(r._painter, 'navigationFrameMs', {configurable: true, value: 50});
    const stats = {...r._painter.stats};
    r.beginNavigation(); formalMap.ctx.view._viewport.pan(30, 10); r.updateNavigation();
    return stats;
  });
  await expect.poll(() => page.evaluate(() => formalMap.ctx.render._canvas.style.transform)).not.toBe('');
  expect(await page.evaluate(() => formalMap.ctx.render._painter.stats.frames)).toBe(before.frames);
  expect((await composedPointPixel(page))[0]).toBeGreaterThan(180);
  // Background geometry becoming ready must not resubmit a dense frame mid-gesture.
  await page.evaluate(() => formalMap.ctx.render._painter.chunks.options.invalidate());
  // No 80 ms geometry refresh should turn a bitmap-only gesture back into a dense redraw.
  await page.evaluate(async () => { const start = performance.now(); while (performance.now() - start < 200) await new Promise(requestAnimationFrame); });
  expect(await page.evaluate(() => formalMap.ctx.render._painter.stats.frames)).toBe(before.frames);
  for (const owner of ['_icons', '_labels']) {
    await page.evaluate(owner => formalMap.ctx.render[owner].invalidate(), owner);
    await settleRequests(page);
    expect(await page.evaluate(() => formalMap.ctx.render._painter.stats.frames), owner).toBe(before.frames);
  }
  // Untagged invalidations (including device recovery) still redraw immediately.
  await page.evaluate(() => formalMap.ctx.render._painter.options.invalidate());
  await settleRequests(page);
  expect(await page.evaluate(() => formalMap.ctx.render._painter.stats.frames)).toBeGreaterThan(before.frames);
  await page.evaluate(() => { formalMap.ctx.view._viewport.pan(5, 0); formalMap.ctx.render.updateNavigation(); });
  await settleRequests(page);
  await page.evaluate(() => formalMap.removeLayerSymbol('poi'));
  await page.evaluate(() => formalMap.setPaintProperty('poi', 'circle-color', '#22dd44'));
  await settleRequests(page);
  expect((await composedPointPixel(page))[1]).toBeGreaterThan(180);
  const updated = await page.evaluate(() => {
    const r = formalMap.ctx.render, frames = r._painter.stats.frames;
    formalMap.ctx.view._viewport.pan(20, 0); r.updateNavigation();
    return frames;
  });
  await settleRequests(page);
  expect(await page.evaluate(() => formalMap.ctx.render._painter.stats.frames)).toBe(updated);
  expect((await composedPointPixel(page))[1]).toBeGreaterThan(180);
  await page.screenshot({path: info.outputPath('adaptive-snapshot-'+renderer+'.png')});
  await page.evaluate(() => formalMap.ctx.render.endNavigation());
  await settleRequests(page);
  expect(await page.evaluate(() => formalMap.ctx.render._canvas.style.transform)).toBe('');
  expect(await page.evaluate(() => formalMap.ctx.render._painter.stats.frames)).toBeGreaterThan(updated);
  expect((await composedPointPixel(page))[1]).toBeGreaterThan(180);
  const settledUploads = await page.evaluate(() => formalMap.ctx.render._painter.stats.uploads);
  const settledFrames = await page.evaluate(() => {
    const painter = formalMap.ctx.render._painter;
    // Replace a real GPU mesh so the idle prepared callback has new content to present.
    painter.cache.clear({sourceId: 'road'});
    painter.chunks.options.invalidate();
    return painter.stats.frames;
  });
  await settleRequests(page);
  expect(await page.evaluate(() => formalMap.ctx.render._painter.stats.frames)).toBeGreaterThan(settledFrames);
  const prepared = await page.evaluate(() => ({frames: formalMap.ctx.render._painter.stats.frames, uploads: formalMap.ctx.render._painter.stats.uploads}));
  expect(prepared.uploads).toBeGreaterThan(settledUploads);
  expect((await composedPointPixel(page))[1]).toBeGreaterThan(180);
  await info.attach('slow-navigation-evidence', {body: JSON.stringify({beforeFrames: before.frames, updated, settledFrames, settledUploads, prepared}), contentType: 'application/json'});
  await page.evaluate(() => { delete formalMap.ctx.render._painter.navigationFrameMs; return formalMap.dispose(); });
  expect(errors).toEqual([]);
});


for (const renderer of ['webgl2', 'webgpu']) test(`${renderer}: changing styles does not retain historical uniforms after owners disappear`, async ({page}, info) => {
  await runtime(page); await create(page, renderer); await settleRequests(page);
  const result = await page.evaluate(async () => {
    const map = formalMap, gpu = map.ctx.render._painter.gpu;
    for (let i = 0; i < 300; i++) {
      map.setPaintProperty('poi', 'circle-radius', 4 + i / 100);
      map.render();
    }
    const afterChanges = gpu.memoryStats;
    for (const id of ['poi', 'road', 'area']) { map.removeLayer(id); map.removeSource(id); }
    map.render();
    const afterRemoval = gpu.memoryStats;
    await map.dispose();
    return { afterChanges, afterRemoval, afterDispose: gpu.memoryStats, errors: renderErrors };
  });
  expect(result.afterChanges.styles).toBeLessThan(10);
  expect(result.afterRemoval.styles).toBe(0);
  expect(result.afterRemoval.styleUniformBytes).toBe(0);
  expect(result.afterDispose.nominalKnownGpuBytes).toBe(0);
  expect(result.errors).toEqual([]);
  await info.attach('memory-lifecycle', {body: JSON.stringify(result, null, 2), contentType:'application/json'});
});

for (const renderer of ['canvas2d', 'webgl2', 'webgpu']) test(`${renderer}: camera animations reuse the painted frame and settle after interruption`, async ({page}) => {
  await runtime(page); await create(page,renderer); await settleRequests(page);
  const scale=await page.evaluate(() => {
    const map=formalMap,r=map.ctx.render;
    // Deterministically select the slow-Canvas path without delaying the test.
    r._scheduler.recordFrame(100,r._captureRenderSnapshot());
    const scale=Math.abs(map.getTransform().mx);
    // Keep the animation active until a real navigation frame is observed.
    map.easeTo({scale:scale*1.5,duration:10_000});
    return scale;
  });
  await page.waitForFunction(()=>{const r=formalMap.ctx.render;return r._navSnapshotTransform!==null && r._scheduler.fastActive;});
  await page.evaluate(async (scale) => {
    // Supersede the first animation, then invalidate the resident presentation.
    formalMap.easeTo({scale:scale*2,duration:180});
    formalMap.setPaintProperty('poi','circle-color','#22dd44');
    await new Promise(resolve=>formalMap.once('moveend',resolve));
  },scale);
  await settleRequests(page);
  expect(await page.evaluate(()=>formalMap.ctx.render._navSnapshotTransform)).toBeNull();
  expect(await page.evaluate(()=>formalMap.ctx.render._canvas.style.transform)).toBe('');
  expect(await page.evaluate(()=>Math.abs(formalMap.getTransform().mx))).toBeCloseTo(scale*2,8);
  const pixel=await page.evaluate(()=>mapPixel(0,0));expect(pixel[1]).toBeGreaterThan(180);expect(pixel[0]).toBeLessThan(90);
  // A synchronous jump also ends navigation and renders its final camera.
  await page.evaluate(scale=>formalMap.jumpTo({scale}),scale); await settleRequests(page);
  expect(await page.evaluate(()=>formalMap.ctx.render._navSnapshotTransform)).toBeNull();
  expect(await page.evaluate(()=>renderErrors)).toEqual([]);
  await page.evaluate(()=>formalMap.dispose());
});


for (const backend of ['webgl2', 'webgpu']) test(`${backend}: device recovery restores geometry icons and labels`, async ({page}, info) => {
  test.skip(backend === 'webgpu' && info.project.name !== 'chrome', 'WebGPU recovery is exercised on Chrome');
  test.setTimeout(120000);
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('requestfailed', r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  await installCanvasReadback(page);
  await runtime(page); await create(page, backend);
  await page.evaluate(()=>{
    const url='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#aa22cc"/></svg>');
    formalMap.setLayerSymbol('poi',{images:{marker:{url,size:[32,32]}},layout:{'icon-image':'marker','text-field':['get','name'],'text-size':18,'text-offset':[0,1.2]},paint:{'text-color':'#dd1177'}});
  });
  await expect.poll(()=>page.evaluate(async()=>{
    await flushFormal();return formalMap.ctx.render._labels?.stats.placed;
  })).toBe(1);
  await page.evaluate(async()=>{
    await flushFormal();
    window.recoveryGpu=formalMap.ctx.render._painter.gpu;
    window.beforeRecovery=await readCanvasPixels(formalMap.ctx.render._canvas);
    window.beforeSize=[formalMap.ctx.render._canvas.width,formalMap.ctx.render._canvas.height];
    window.contextListeners=0;
    const canvas=formalMap.ctx.render._canvas, add=canvas.addEventListener.bind(canvas);
    canvas.addEventListener=(type,listener,options)=>{
      if((type==='webglcontextlost'||type==='webglcontextrestored')&&!options?.once)contextListeners++;
      return add(type,listener,options);
    };
  });
  for(let cycle=0;cycle<2;cycle++) {
    await page.evaluate(backend=>{
      window.lostDevice=recoveryGpu.device;
      if(backend==='webgpu') lostDevice.handle.destroy();
      else {
        const ext=lostDevice.gl.getExtension('WEBGL_lose_context');
        if(!ext)throw new Error('WEBGL_lose_context unavailable');
        const canvas=formalMap.ctx.render._canvas;
        canvas.addEventListener('webglcontextlost',()=>setTimeout(()=>ext.restoreContext(),50),{once:true});
        ext.loseContext();
      }
    },backend);
    await expect.poll(()=>page.evaluate(async()=>{
      await flushFormal();
      return recoveryGpu.device!==lostDevice&&!recoveryGpu.lost&&formalMap.ctx.render._painter.frameComplete;
    })).toBe(true).catch(async e=>{console.log('RECOVERY_STATE',await page.evaluate(()=>({errors:renderErrors,stage:formalMap.ctx.render._canvas.dataset.gpuStage,lost:recoveryGpu.lost,stats:recoveryGpu.stats})));throw e;});
    await expect.poll(()=>page.evaluate(async()=>{
      await flushFormal();
      const after=await readCanvasPixels(formalMap.ctx.render._canvas);
      return after.length===beforeRecovery.length&&after.every((n,i)=>n===beforeRecovery[i]);
    })).toBe(true).catch(async e=>{console.log('RECOVERY_PIXELS',await page.evaluate(async()=>{const after=await readCanvasPixels(formalMap.ctx.render._canvas);let differences=0,max=0;for(let i=0;i<after.length;i++)if(after[i]!==beforeRecovery[i]){differences++;max=Math.max(max,Math.abs(after[i]-beforeRecovery[i]));}return {differences,max,beforeSize,size:[formalMap.ctx.render._canvas.width,formalMap.ctx.render._canvas.height],pixels:[await mapPixel(0,0),await mapPixel(2,-2),await mapPixel(0,3)],errors:renderErrors,stats:recoveryGpu.stats};}));throw e;});
  }
  await page.screenshot({path:info.outputPath('recovered.png')});
  const result=await page.evaluate(async()=>{
    const stats={...recoveryGpu.stats};
    await formalMap.dispose();
    return {stats, bytes:recoveryGpu.memoryStats.nominalKnownGpuBytes, errors:renderErrors,contextListeners};
  });
  expect(result.bytes).toBe(0);
  expect(result.contextListeners).toBe(0);
  expect(result.errors.filter(e=>!e.includes('WebGL context lost'))).toEqual([]);
  expect(errors).toEqual([]);
  await expect.poll(()=>page.workers().length).toBe(0);
  await info.attach('device-recovery',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});

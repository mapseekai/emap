import { test, expect } from '@playwright/test';

const collection = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { name: '北京 Alpha', rank: 9 }, geometry: { type: 'Point', coordinates: [-2, 2] } },
  { type: 'Feature', properties: { name: '上海 Beta', rank: 8 }, geometry: { type: 'Point', coordinates: [2, 2] } },
  { type: 'Feature', properties: { name: '道路 Road 01', rank: 4 }, geometry: { type: 'LineString', coordinates: [[-3,0],[0,.5],[3,0]] } },
  { type: 'Feature', properties: { name: '地块 A', rank: 3 }, geometry: { type: 'Polygon', coordinates: [[[-2.8,-2.5],[-.8,-2.5],[-.8,-1],[-2.8,-1],[-2.8,-2.5]]] } },
  { type: 'Feature', properties: { name: '孔洞面 B', rank: 2 }, geometry: { type: 'Polygon', coordinates: [[[.8,-2.6],[3,-2.6],[3,-1],[.8,-1],[.8,-2.6]],[[1.4,-2.2],[1.4,-1.5],[2.4,-1.5],[2.4,-2.2],[1.4,-2.2]]] } },
] };
const apiName = route => route === 'luma-25d' ? 'luma25d' : 'lumaBenchmark';
async function ready(page, name) {
  await page.waitForFunction(name => {const a=window[name];return a && ['ready','error'].includes(a.state);}, name);
  expect(await page.evaluate(name=>window[name].state,name), await page.locator('#status').textContent()).toBe('ready');
}
async function settle(page, name) {
  await page.evaluate(async name=>{const a=window[name];a.draw('luma');await a.settleLabels();a.draw('luma');}, name);
  await expect.poll(()=>page.evaluate(name=>!!window[name].labelStats.pending,name)).toBe(false);
  await page.waitForTimeout(120);
}
async function paintedText(page, name) {
  return await page.evaluate(async name=>{
    const a=window[name];a.draw('luma');const image=await createImageBitmap(document.querySelector('#webgl'));
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const c=canvas.getContext('2d');c.drawImage(image,0,0);image.close();
    const data=c.getImageData(0,0,canvas.width,canvas.height).data;let count=0;
    for(let i=0;i<data.length;i+=4)if(data[i]>160&&data[i+1]<85&&data[i+2]>70&&data[i+3]>100)count++;
    return count;
  },name);
}
async function eachLabelPainted(page,name,minimumPixels=30) {
  const snapshot=await page.evaluate(async({name,minimumPixels})=>{
    const app=window[name],placementsBefore=app.labelPlacements;app.draw('luma');const source=document.querySelector('#webgl');
    const image=await createImageBitmap(source),canvas=document.createElement('canvas');
    canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');
    ctx.drawImage(image,0,0);image.close();const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const stage=document.querySelector('#stage'),rx=canvas.width/stage.clientWidth,ry=canvas.height/stage.clientHeight;
    const placements=app.labelPlacements;
    const rows=placements.map(label=>{
      const b=label.bounds;let colored=0;
      for(let y=Math.max(0,Math.floor(b[1]*ry));y<Math.min(canvas.height,Math.ceil(b[3]*ry));y++)
        for(let x=Math.max(0,Math.floor(b[0]*rx));x<Math.min(canvas.width,Math.ceil(b[2]*rx));x++) {
          const i=(y*canvas.width+x)*4;
          if(pixels[i]>160&&pixels[i+1]<85&&pixels[i+2]>70&&pixels[i+3]>100)colored++;
        }
      return {text:label.text,owner:label.ownerId,colored};
    });
    let evidence;
    if(rows.length<4||rows.some(row=>row.colored<=minimumPixels)) {
      try {
        // Keep the exact counted bitmap; a later GPU read may show another frame.
        const gl=app.snapshot?.backend==='webgl'?source.getContext('webgl2'):null;
        const glInfo=gl?{attributes:gl.getContextAttributes(),samples:gl.getParameter(gl.SAMPLES),sampleBuffers:gl.getParameter(gl.SAMPLE_BUFFERS),alphaToCoverage:gl.isEnabled(gl.SAMPLE_ALPHA_TO_COVERAGE),sampleCoverage:gl.isEnabled(gl.SAMPLE_COVERAGE),framebufferIsDefault:gl.getParameter(gl.FRAMEBUFFER_BINDING)===null,renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION)}:null;
        evidence={glInfo,dpr:devicePixelRatio,inner:[innerWidth,innerHeight],stage:[stage.clientWidth,stage.clientHeight],canvas:[canvas.width,canvas.height],placementsBefore,placements,stats:app.labelStats,snapshot:app.snapshot,png:canvas.toDataURL()};
      } catch(error) {evidence={diagnosticError:String(error)};}
    }
    return {rows,evidence};
  },{name,minimumPixels});
  const result=snapshot.rows;
  if(snapshot.evidence)console.log('LABEL_FAILURE_EVIDENCE',JSON.stringify({name,minimumPixels,result,...snapshot.evidence}));
  expect(result.length).toBeGreaterThanOrEqual(4);
  for(const row of result)expect(row.colored,JSON.stringify(row)).toBeGreaterThan(minimumPixels);
}

for(const backend of ['webgl','webgpu'])for(const route of ['luma-benchmark','luma-25d']) {
  test(`${backend} ${route}: attached point/line/polygon labels, pixels, ownership and disposal`,async({page},info)=>{
    test.setTimeout(120000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const name=apiName(route);
    await page.goto(`/mapseekai/emap/examples/${route}/?gpu=${backend}`);
    await page.waitForFunction(name=>window[name],name);
    if(route==='luma-benchmark') await page.waitForFunction(()=>window.lumaBenchmark.state==='idle');else await ready(page,name);
    await page.locator('#file-input').setInputFiles({name:'labels.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(collection))});
    if(route==='luma-benchmark')await page.evaluate(()=>window.lumaBenchmark.loadFile(document.querySelector('#file-input').files[0]));
    await ready(page,name);
    // Geometry-only fit leaves no room for fixed above-point labels and halos.
    await page.evaluate(async name=>{const a=window[name];if(name==='lumaBenchmark')await a.setView(.75);else a.zoom(.75);},name);
    const before=await page.evaluate(name=>window[name].layers.map(l=>[l.id,l.type]),name);
    expect(new Set(before.map(l=>l[1]))).toEqual(new Set(['circle','line','fill']));
    await page.evaluate(name=>{const a=window[name];for(const l of a.layers)a.setLayerLabel(l.id,{field:'name',fontSize:18,color:'#dd1177',haloWidth:2,priority:['get','rank']});},name);
    await settle(page,name);
    const labels=await page.evaluate(name=>window[name].labelPlacements,name);
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(labels.some(l=>l.text.includes('Road'))).toBe(true);
    expect(labels.some(l=>l.text.includes('地块'))).toBe(true);
    expect(labels.some(l=>l.text.includes('北京'))).toBe(true);
    expect(labels.some(l=>l.text.includes('上海'))).toBe(true);
    expect(await paintedText(page,name)).toBeGreaterThan(100);
    await eachLabelPainted(page,name);
    expect(await page.evaluate(name=>window[name].layers.map(l=>[l.id,l.type]),name)).toEqual(before);
    const warm=await page.evaluate(name=>({...window[name].labelStats.gpu}),name);
    await page.evaluate(name=>{for(let i=0;i<5;i++)window[name].draw('luma');},name);
    const again=await page.evaluate(name=>window[name].labelStats.gpu,name);
    expect(again.textureUploads).toBe(warm.textureUploads);expect(again.bufferUploads).toBe(warm.bufferUploads);
    expect(again.liveTextureBytes).toBeLessThanOrEqual(16*1024*1024);
    const owner=before.find(l=>l[1]==='circle')[0];
    await page.evaluate(({name,owner})=>window[name].setLayerVisibility(owner,'none'),{name,owner});await settle(page,name);
    expect(await page.evaluate(({name,owner})=>window[name].labelPlacements.some(l=>l.ownerId===owner),{name,owner})).toBe(false);
    await page.evaluate(({name,owner})=>window[name].setLayerVisibility(owner,'visible'),{name,owner});await settle(page,name);
    expect(await page.evaluate(({name,owner})=>window[name].labelPlacements.some(l=>l.ownerId===owner),{name,owner})).toBe(true);
    if(route==='luma-25d') {
      for(const pose of [{pitch:0,bearing:0},{pitch:60,bearing:65}]) {
        await page.evaluate(p=>{window.luma25d.setPose(p);window.luma25d.fit();window.luma25d.zoom(.75);},pose);await settle(page,name);
        expect(await paintedText(page,name)).toBeGreaterThan(50);
        await eachLabelPainted(page,name);
        const p=await page.evaluate(()=>window.luma25d.labelPlacements);
        expect(p.every(l=>Math.abs(l.angle)<=Math.PI/2)).toBe(true);
      }
    } else {
      await page.evaluate(()=>{const a=window.lumaBenchmark,d=a.scene.dataset;const l=d.layers.find(l=>l.geometry_type==='point');l.data.getRecordAt(0).name='修改后的名称';d.attributeVersion=(d.attributeVersion??0)+1;a.draw('luma');});
      await settle(page,name);expect(await page.evaluate(()=>window.lumaBenchmark.labelPlacements.some(l=>l.text==='修改后的名称'))).toBe(true);
    }
    await page.screenshot({path:info.outputPath('bound-labels.png')});
    if(route==='luma-25d') {
      await page.locator('#label-settings summary').click();
      expect(await page.locator('#label-owner option').count()).toBe(before.length);
    }
    await page.evaluate(name=>{const a=window[name];for(const l of a.layers)a.setLayerLabel(l.id,null);a.draw('luma');},name);await settle(page,name);
    expect(await paintedText(page,name)).toBe(0);
    const cleared=await page.evaluate(name=>window[name].labelStats,name);
    expect(cleared.gpu.liveTextureBytes).toBe(0);expect(cleared.gpu.liveBufferBytes).toBe(0);
    expect(await page.evaluate(name=>window[name].layers.length,name)).toBe(before.length);
    await page.evaluate(name=>window[name].dispose(),name);
    await expect.poll(()=>page.workers().length).toBe(0);
    expect(errors).toEqual([]);
    await info.attach('label-evidence',{body:JSON.stringify({backend,route,labels,warm,cleared},null,2),contentType:'application/json'});
  });
}


test('public Emap labels follow layer filters, visibility and removal without new layer IDs', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/mapseekai/emap/examples/luma-benchmark/');
  await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
  await page.evaluate(async()=>{
    window.lumaBenchmark.dispose();
    const host=document.createElement('div');host.id='formal-label-test';
    Object.assign(host.style,{position:'fixed',inset:'0',width:'800px',height:'600px',background:'white',zIndex:'9999'});document.body.append(host);
    const map=await emap.Emap.create({container:host,preset:'viewer',renderer:'canvas2d'});
    const source=new emap.TopologySource('cities');
    await source.setData({filename:'cities.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features:[
      {type:'Feature',properties:{name:'北京 City A',value:1},geometry:{type:'Point',coordinates:[0,0]}},
      {type:'Feature',properties:{name:'上海 City B',value:2},geometry:{type:'Point',coordinates:[1,1]}}
    ]}))});
    await map.addSource('cities',source);
    map.addLayer({id:'city-points',source:'cities',type:'circle',label:{field:'name',fontSize:18,color:'#dd1177'}});
    map.setExtent(new emap.Bounds(-1,-1,2,2));map.render();
    window.formalLabelMap=map;
    window.countFormalLabelPixels=()=>{
      const canvas=host.querySelector('canvas'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let n=0;for(let i=0;i<data.length;i+=4)if(data[i]>160&&data[i+1]<85&&data[i+2]>70&&data[i+3]>100)n++;return n;
    };
  });
  await expect.poll(()=>page.evaluate(()=>countFormalLabelPixels())).toBeGreaterThan(100);
  expect(await page.evaluate(()=>formalLabelMap.getLayers().map(l=>[l.id,l.type]))).toEqual([['city-points','circle']]);
  const before=await page.evaluate(()=>countFormalLabelPixels());
  await page.evaluate(()=>formalLabelMap.setFilter('city-points',['==',['get','value'],1]));
  await expect.poll(()=>page.evaluate(before=>{const n=countFormalLabelPixels();return n>50&&n<before;},before)).toBe(true);
  await page.evaluate(()=>formalLabelMap.setLayerVisibility('city-points','none'));
  await expect.poll(()=>page.evaluate(()=>countFormalLabelPixels())).toBe(0);
  await page.evaluate(()=>formalLabelMap.setLayerVisibility('city-points','visible'));
  await expect.poll(()=>page.evaluate(()=>countFormalLabelPixels())).toBeGreaterThan(50);
  await page.evaluate(()=>formalLabelMap.setLayerLabel('city-points',null));
  await expect.poll(()=>page.evaluate(()=>countFormalLabelPixels())).toBe(0);
  expect(await page.evaluate(()=>formalLabelMap.getLayers().length)).toBe(1);
  await page.evaluate(async()=>{formalLabelMap.removeSource('cities');await formalLabelMap.dispose();});
  expect(errors).toEqual([]);
});


for(const dpr of [1.3,2])for(const backend of ['webgl','webgpu'])test(`${backend}: DPR ${dpr} keeps each attached label at CSS size`,async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:dpr});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(new URL(`/mapseekai/emap/examples/luma-25d/?gpu=${backend}`,info.project.use.baseURL).href);await ready(page,'luma25d');
    await page.locator('#file-input').setInputFiles({name:'labels.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(collection))});await ready(page,'luma25d');
    await page.evaluate(()=>{for(const l of luma25d.layers)luma25d.setLayerLabel(l.id,{field:'name',fontSize:18,color:'#dd1177',haloWidth:2});});
    await settle(page,'luma25d');await eachLabelPainted(page,'luma25d');
    const result=await page.evaluate(()=>({dpr:luma25d.snapshot.dpr,deviceDpr:devicePixelRatio,labels:luma25d.labelPlacements,stats:luma25d.labelStats}));
    expect(result.dpr).toBe(result.deviceDpr);
    // Fractional overrides may reach the browser as float32; retain exact DPR 2.
    if(dpr===2)expect(result.dpr).toBe(2);else expect(Math.fround(result.dpr)).toBe(Math.fround(dpr));
    expect(result.stats.placed).toBe(5);
    for(const label of result.labels)expect(label.bounds[3]-label.bounds[1]).toBeLessThan(140);
    await info.attach('hidpi-labels',{body:JSON.stringify(result),contentType:'application/json'});
    await page.evaluate(()=>luma25d.dispose());expect(errors).toEqual([]);
  } finally {await context.close();}
});

test('real point file: opt-in labels retain original point LOD and bounded atlas reuse',async({page},info)=>{
  test.skip(!process.env.EMAP_BENCHMARK_DATA_DIR,'Requires authorized real points.geojson.');test.setTimeout(120000);
  const {join}=await import('node:path');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/mapseekai/emap/examples/luma-benchmark/');await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
  await page.locator('#file-input').setInputFiles(join(process.env.EMAP_BENCHMARK_DATA_DIR,'points.geojson'));
  await page.evaluate(()=>lumaBenchmark.loadFile(document.querySelector('#file-input').files[0]));await ready(page,'lumaBenchmark');
  const before=await page.evaluate(()=>({lod:lumaBenchmark.lodStats,labels:lumaBenchmark.labelStats,first:lumaBenchmark.scene.dataset.layers[0].shapes[0]}));
  expect(before.labels.gpu.liveTextureBytes).toBe(0);expect(before.lod.geometryMode).toBe('point-lod');
  const start=Date.now();
  await page.evaluate(()=>{
    const a=lumaBenchmark,layer=a.scene.dataset.layers[0],row=layer.data?.getRecordAt?.(0)??layer.data?.getRecords?.()[0];
    const field=row&&Object.keys(row).find(k=>typeof row[k]==='string'||typeof row[k]==='number');
    a.setLayerLabel(a.layers[0].id,field?{field,fontSize:12,color:'#dd1177',maxLabels:1000}:{text:'点',fontSize:12,color:'#dd1177',maxLabels:1000});
  });
  await settle(page,'lumaBenchmark');
  const after=await page.evaluate(()=>({lod:lumaBenchmark.lodStats,labels:lumaBenchmark.labelStats,first:lumaBenchmark.scene.dataset.layers[0].shapes[0]}));
  expect(after.labels.placed).toBeGreaterThan(0);expect(after.labels.placed).toBeLessThanOrEqual(1000);
  expect(after.labels.gpu.liveTextureBytes).toBeLessThanOrEqual(16*1024*1024);
  expect(after.lod.geometryMode).toBe(before.lod.geometryMode);expect(after.lod.displayVertices).toBe(before.lod.displayVertices);expect(after.first).toEqual(before.first);
  const uploads=after.labels.gpu.textureUploads;
  await page.evaluate(()=>{for(let i=0;i<8;i++)lumaBenchmark.draw('luma');});
  expect(await page.evaluate(()=>lumaBenchmark.labelStats.gpu.textureUploads)).toBe(uploads);
  await info.attach('real-point-labels',{body:JSON.stringify({before,after,labelReadyWallMs:Date.now()-start}),contentType:'application/json'});
  await page.evaluate(()=>lumaBenchmark.dispose());await expect.poll(()=>page.workers().length).toBe(0);expect(errors).toEqual([]);
});


for(const backend of ['webgl','webgpu'])test(`${backend}: true MSDF reuses glyphs across paint, size and live DPR changes`,async({page,browserName},info)=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/mapseekai/emap/examples/luma-benchmark/?gpu='+backend);
  await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
  const features=[[-10,-6,''],[10,6,''],[-4,-2,'京A'],[4,-2,'京A'],[-4,2,'京A'],[4,2,'京A']].map(([x,y,name])=>({type:'Feature',properties:{name},geometry:{type:'Point',coordinates:[x,y]}}));
  await page.locator('#file-input').setInputFiles({name:'msdf-reuse.geojson',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({type:'FeatureCollection',features}))});
  await page.evaluate(()=>lumaBenchmark.loadFile(document.querySelector('#file-input').files[0]));await ready(page,'lumaBenchmark');
  const layer=await page.evaluate(()=>lumaBenchmark.layers[0].id);
  expect(page.workers().filter(w=>w.url().includes('emap-msdf-worker')).length).toBe(0);
  async function paint(size,halo=1.5,color='#dd1177'){
    await page.evaluate(({layer,size,halo,color})=>lumaBenchmark.setLayerLabel(layer,{field:'name',fontSize:size,haloWidth:halo,color,allowOverlap:true}),{layer,size,halo,color});
    await settle(page,'lumaBenchmark');return page.evaluate(()=>lumaBenchmark.labelStats);
  }
  const initial=await paint(18);expect(initial.mode).toBe('msdf');expect(initial.gpu.mode).toBe('msdf');
  expect(initial.glyphCount).toBe(2);expect(initial.multichannelPixels).toBeGreaterThan(100);
  expect(initial.gpu.glyphInstances).toBe(8);expect(initial.placed).toBe(4);expect(initial.missingGlyphs).toBe(0);
  const rows=[];
  for(const size of [12,24,48,96]){
    const state=await paint(size,2);expect(state.placed).toBe(4);
    expect(state.glyphsGenerated).toBe(initial.glyphsGenerated);expect(state.gpu.textureUploads).toBe(initial.gpu.textureUploads);
    await eachLabelPainted(page,'lumaBenchmark',Math.max(10,size*size*.05));rows.push({size,state});
  }
  const quality=await page.evaluate(async()=>{
    const a=window.lumaBenchmark;
    async function mask(backend){a.draw(backend);const c=document.querySelector(backend==='canvas'?'#canvas2d':'#webgl');const bitmap=await createImageBitmap(c),out=document.createElement('canvas');out.width=bitmap.width;out.height=bitmap.height;const ctx=out.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const rgba=ctx.getImageData(0,0,out.width,out.height).data;const pixels=new Uint8Array(out.width*out.height);for(let i=0;i<pixels.length;i++)pixels[i]=Number(rgba[i*4]>160&&rgba[i*4+1]<85&&rgba[i*4+2]>70&&rgba[i*4+3]>100);return{pixels,width:out.width,height:out.height};}
    const gpu=await mask('luma'),ref=await mask('canvas');a.draw('luma');let expected=0,actual=0,missing=0,extra=0;
    const nearby=(pixels,x,y)=>{for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<gpu.width&&yy<gpu.height&&pixels[yy*gpu.width+xx])return true;}return false;};
    for(let y=0;y<gpu.height;y++)for(let x=0;x<gpu.width;x++){const i=y*gpu.width+x;if(ref.pixels[i]){expected++;if(!nearby(gpu.pixels,x,y))missing++;}if(gpu.pixels[i]){actual++;if(!nearby(ref.pixels,x,y))extra++;}}
    return {expected,actual,missing,extra};
  });
  expect(quality.expected).toBeGreaterThan(1000);expect(quality.actual).toBeGreaterThan(1000);
  expect(quality.missing/quality.expected,JSON.stringify(quality)).toBeLessThan(.015);
  expect(quality.extra/quality.actual,JSON.stringify(quality)).toBeLessThan(.015);
  const colored=await paint(48,3,'#c020a0');expect(colored.gpu.textureUploads).toBe(initial.gpu.textureUploads);
  if(browserName==='chromium'){
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:2,mobile:false});
    // A DPR-only CDP override does not emit the resize input consumed by the example.
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  }else{
    // Other engines have no live DPR emulation API; inject the resize input and check real canvas pixels.
    await page.evaluate(()=>{Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:2});window.dispatchEvent(new Event('resize'));});
  }
  await expect.poll(()=>page.evaluate(()=>devicePixelRatio)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#webgl').width===Math.floor(document.querySelector('#stage').getBoundingClientRect().width)*2)).toBe(true);
  await settle(page,'lumaBenchmark');
  const high=await page.evaluate(()=>lumaBenchmark.labelStats);
  expect(high.glyphsGenerated).toBe(initial.glyphsGenerated);expect(high.gpu.textureUploads).toBe(initial.gpu.textureUploads);
  await eachLabelPainted(page,'lumaBenchmark');
  await page.screenshot({path:info.outputPath('msdf-hidpi.png')});
  await page.evaluate(id=>lumaBenchmark.setLayerLabel(id,{field:'name',fontFamily:'Unregistered System Font'}),layer);
  await settle(page,'lumaBenchmark');
  expect(await page.evaluate(()=>lumaBenchmark.labelStats.error)).toContain('fontUrl');
  expect(await page.evaluate(()=>lumaBenchmark.state)).toBe('ready');
  await paint(18);expect(await page.evaluate(()=>lumaBenchmark.labelStats.error)).toBeNull();
  console.log('MSDF_REUSE',JSON.stringify({backend,glyphs:initial.glyphCount,instances:initial.gpu.glyphInstances,initialUploads:initial.gpu.textureUploads,highDprUploads:high.gpu.textureUploads,quality}));
  await page.evaluate(id=>lumaBenchmark.setLayerLabel(id,null),layer);await settle(page,'lumaBenchmark');
  await expect.poll(()=>page.workers().filter(w=>w.url().includes('emap-msdf-worker')).length).toBe(0);
  const cleared=await page.evaluate(()=>lumaBenchmark.labelStats.gpu);expect(cleared.liveTextureBytes).toBe(0);expect(cleared.liveBufferBytes).toBe(0);
  expect(errors).toEqual([]);await page.evaluate(()=>lumaBenchmark.dispose());
  await info.attach('msdf-reuse',{body:JSON.stringify({initial,rows,quality,colored,high,cleared},null,2),contentType:'application/json'});
});

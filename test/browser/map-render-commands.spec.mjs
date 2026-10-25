import {test,expect} from '@playwright/test';
async function boot(page,renderer){
 await page.goto('/mapseekai/emap/examples/luma-benchmark/');await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
 await page.evaluate(async renderer=>{
  lumaBenchmark.dispose();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;width:800px;height:600px';document.body.append(host);
  window.commandMap=await emap.Emap.create({container:host,renderer,preset:'viewer'});window.commandErrors=[];commandMap.on('error',e=>commandErrors.push(String(e.error)));
  const p=commandMap.ctx.render._painter;
  // Force independently allocated test meshes so tiny fixtures exercise real bundle recording.
  p.gpu.meshPagesEnabled=false;
  const features=[];
  for(let i=0;i<1800;i++){const x=(i%60)*.12-3.5,y=Math.floor(i/60)*.12-2;
   features.push({type:'Feature',properties:{name:'area',group:i%2},geometry:{type:'Polygon',coordinates:[[[x,y],[x+.1,y],[x+.1,y+.1],[x,y+.1],[x,y]]]}});
   features.push({type:'Feature',properties:{name:'line',group:i%2},geometry:{type:'LineString',coordinates:[[x,y],[x+.1,y+.05],[x+.05,y+.1]]}});
  }
  features.push({type:'Feature',properties:{name:'long'},geometry:{type:'LineString',coordinates:Array.from({length:100100},(_,i)=>[i/20000,30+Math.sin(i/1000)])}});
  const source=new emap.TopologySource('s');await source.setData({filename:'commands.geojson',content:new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features}))});source.getDisplayArcs=()=>null;
  await commandMap.addSource('s',source);
  for(const layer of source.getLayers()){
   const area=layer.geometry_type==='polygon';commandMap.addLayer({id:area?'area':'line',type:area?'fill':'line',source:'s','source-layer':layer.name,
    paint:area?{'fill-color':'#de2255','fill-opacity':.55,'line-width':0}:{'line-color':'#164cc3','line-width':2}});
  }
  commandMap.setExtent(new emap.Bounds(-4,-4,4,4));commandMap.render();
 },renderer);
}
async function settled(page){await expect.poll(()=>page.evaluate(()=>commandErrors)).toEqual([]);await expect.poll(()=>page.evaluate(()=>{const r=commandMap.ctx.render,p=r._painter;return p.frameComplete&&p.stats.geometryChunks.pending===0&&!r._labels?.stats.pending;}),{timeout:60000}).toBe(true);}
async function commandStats(page){return page.evaluate(()=>{const s=commandMap.ctx.render._painter.stats;return {frames:s.frames,drawCalls:s.drawCalls,liveBufferBytes:s.liveBufferBytes,...s.renderCommands};});}
async function warm(page,frames=4){
 const before=await commandStats(page);
 await page.evaluate(()=>{window.commandWarmView=commandMap.ctx.view._viewport.transform.clone();});
 // An unchanged retained frame skips GPU submission. Move the real camera, then
 // restore it exactly, so every warm pass exercises plans at the same final view.
 for(let i=0;i<frames;i++){
  await page.evaluate(async shift=>{await new Promise(requestAnimationFrame);const t=commandMap.ctx.view._viewport.transform;Object.assign(t,commandWarmView);t.translate(shift,0);commandMap.render();},i%2===0?1:0);
  await settled(page);
 }
 const restored=await page.evaluate(async()=>{const t=commandMap.ctx.view._viewport.transform,same=['mx','my','bx','by'].every(key=>t[key]===commandWarmView[key]);delete window.commandWarmView;await commandMap.ctx.render._painter.gpu.waitForIdle();return same;});
 expect(restored).toBe(true);
 const after=await commandStats(page);
 expect(after.frames-before.frames).toBeGreaterThanOrEqual(frames);
 expect(after.drawCalls).toBeGreaterThan(before.drawCalls);
 return {before,after};
}
async function capture(page){
 // GPU submission and frameComplete do not guarantee a presented screenshot.
 await page.evaluate(async()=>{
  await commandMap.ctx.render._painter.gpu.waitForIdle();
  await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
 });
 const png=await page.screenshot({clip:{x:0,y:0,width:800,height:600}});
 return page.evaluate(async base64=>{const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
 const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
 const data=ctx.getImageData(0,0,800,600).data;let hash=2166136261,painted=0,colored=0,green=0;
 for(let i=0;i<data.length;i++){hash=Math.imul(hash^data[i],16777619);if(i%4===0){const r=data[i],g=data[i+1],b=data[i+2];if(r!==255||g!==255||b!==255)painted++;if(Math.max(r,g,b)-Math.min(r,g,b)>40)colored++;if(g>r+40&&g>b+40)green++;}}
 return {hash:hash>>>0,painted,colored,green};},png.toString('base64'));
}
async function compareCommands(page,renderer,flags=['renderBundlesEnabled','commandPlansEnabled','strokeBatchingEnabled']){
 await warm(page);const image=await capture(page);expect(image.painted).toBeGreaterThan(100);expect(image.colored).toBeGreaterThan(100);
 if(!flags.includes('commandPlansEnabled'))expect(image.green).toBeGreaterThan(100);
 const before=await commandStats(page);
 await page.evaluate(flags=>{const g=commandMap.ctx.render._painter.gpu;for(const flag of flags)g[flag]=false;},flags);
 await warm(page,2);const disabled=await commandStats(page);
 expect(disabled.recordings).toBe(before.recordings);expect(disabled.replays).toBe(before.replays);
 if(flags.includes('commandPlansEnabled'))expect(disabled.hits).toBe(before.hits);
 expect(await capture(page)).toEqual(image);
 await page.evaluate(flags=>{const g=commandMap.ctx.render._painter.gpu;for(const flag of flags)g[flag]=true;},flags);
 await warm(page);const enabled=await commandStats(page);
 expect(enabled.hits).toBeGreaterThan(disabled.hits);
 if(renderer==='webgpu')expect(enabled.replays).toBeGreaterThan(disabled.replays);
 expect(await capture(page)).toEqual(image);
 console.log('COMMAND_CACHE_COMPARE',JSON.stringify({renderer,flags,before,disabled,enabled,image}));
}
for(const renderer of ['webgl2','webgpu'])test(`${renderer}: cached mesh plans and MSAA bundles retain ordered pixels through camera/style/filter changes`,async({page})=>{
 test.setTimeout(120000);await boot(page,renderer);await settled(page);await warm(page);
 const initial=await page.evaluate(()=>commandMap.ctx.render._painter.stats);
 expect(initial.renderCommands.hits).toBeGreaterThan(0);
 if(renderer==='webgpu'){expect(initial.renderCommands.replays).toBeGreaterThan(0);expect(initial.renderCommands.recordings).toBeGreaterThan(0);}
 else expect(initial.renderCommands.recordings).toBe(0);
 const compare=()=>compareCommands(page,renderer);
 await compare();
 await page.evaluate(()=>{commandMap.ctx.view._viewport.transform.translate(19,-13);commandMap.render();});await settled(page);await compare();
 await page.evaluate(()=>{commandMap.setPaintProperty('area','fill-color','#17bb66');commandMap.setPaintProperty('line','line-width',5);commandMap.render();});await settled(page);await compare();
 for(let i=0;i<2;i++){
  await page.evaluate(()=>{commandMap.setFilter('area',['==',['get','group'],1]);commandMap.setFilter('line',['==',['get','group'],0]);commandMap.render();});await settled(page);await compare();
  await page.evaluate(()=>{commandMap.setFilter('area',null);commandMap.setFilter('line',null);commandMap.render();});await settled(page);await compare();
 }
 // Unsupported dash/alpha remains on the ordinary luma path, after native replay.
 await page.evaluate(()=>{commandMap.setPaintProperty('line','line-color','rgba(20,80,190,.5)');commandMap.setPaintProperty('line','line-dasharray',[2,3]);commandMap.render();});await settled(page);await compare();
 const released=await page.evaluate(async()=>{const p=commandMap.ctx.render._painter;await commandMap.dispose();return p.stats;});
 expect(released.renderCommands.entries).toBe(0);expect(released.liveBufferBytes).toBe(0);expect(await page.evaluate(()=>commandErrors)).toEqual([]);
 await expect.poll(()=>page.workers().length).toBe(0);
});

test('webgpu: native MSAA replay interoperates with image commands, MSDF labels and resizing at DPR 2',async({browser})=>{
 test.setTimeout(120000);const context=await browser.newContext({viewport:{width:1000,height:800},deviceScaleFactor:2});
 try{
  const page=await context.newPage();await boot(page,'webgpu');await settled(page);
  await page.evaluate(()=>{
   const p=commandMap.ctx.render._painter,g=p.gpu,finish=p.finishFrame.bind(p);
   const image=document.createElement('canvas');image.width=image.height=16;const c=image.getContext('2d');c.fillStyle='#22dd44';c.fillRect(0,0,16,16);
   window.commandOrder=[];window.commandImageDraws=0;
   const begin=g.begin.bind(g),mesh=g.drawMeshSequence.bind(g),drawImage=g.drawImage.bind(g),labels=g.drawLabels.bind(g);
   g.begin=(...args)=>{commandOrder=[];return begin(...args);};
   g.drawMeshSequence=(...args)=>{commandOrder.push('mesh');return mesh(...args);};
   g.drawImage=(...args)=>{const before=g.stats.drawCalls;drawImage(...args);if(g.stats.drawCalls>before){commandOrder.push('image');commandImageDraws++;}};
   g.drawLabels=(...args)=>{commandOrder.push('labels');return labels(...args);};
   // Interleave a genuine image draw between two native-eligible vector scopes.
   p.finishFrame=()=>{const before=p.commands.length;p.drawRasterImage(image,[-1,-1,1,1],.65,true,undefined,true);if(p.commands.length>before)p.commands.splice(1,0,p.commands.pop());finish();};
   commandMap.setLayerLabel('area',{field:'name',fontSize:18,maxLabels:3});commandMap.render();
  });
  await expect.poll(()=>page.evaluate(()=>commandMap.ctx.render._painter.stats.text.textureUploads),{timeout:30000}).toBeGreaterThan(0);await settled(page);await warm(page);
  expect(await page.evaluate(()=>commandMap.ctx.render._canvas.width)).toBe(1600);
  const compare=async()=>{
   await compareCommands(page,'webgpu',['renderBundlesEnabled']);
   const actual=await page.evaluate(()=>({order:commandOrder,imageDraws:commandImageDraws,text:commandMap.ctx.render._painter.stats.text})),at=actual.order.indexOf('image');
   expect(actual.imageDraws).toBeGreaterThan(0);expect(actual.order.slice(0,at)).toContain('mesh');expect(actual.order.slice(at+1)).toContain('mesh');expect(actual.order).toContain('labels');expect(actual.text.glyphInstances).toBeGreaterThan(0);
   console.log('COMMAND_INTERLEAVE',JSON.stringify(actual));
  };
  await compare();
  await page.evaluate(()=>{document.body.firstElementChild.style.width='750px';document.body.firstElementChild.style.height='550px';commandMap.resize();commandMap.render();});await settled(page);await compare();
  expect(await page.evaluate(()=>commandMap.ctx.render._painter.stats.renderCommands.replays)).toBeGreaterThan(0);
  const released=await page.evaluate(async()=>{const p=commandMap.ctx.render._painter;await commandMap.dispose();return p.stats;});
  expect(released.renderCommands.entries).toBe(0);expect(released.liveBufferBytes).toBe(0);expect(released.liveTextureBytes).toBe(0);expect(released.text.liveBufferBytes).toBe(0);expect(released.text.liveTextureBytes).toBe(0);
  await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>commandErrors)).toEqual([]);
  console.log('COMMAND_INTERLEAVE_RELEASE',JSON.stringify({liveBufferBytes:released.liveBufferBytes,liveTextureBytes:released.liveTextureBytes,text:released.text,commands:released.renderCommands}));
 }finally{await context.close();}
});

for (const renderer of ['webgl2','webgpu']) test(`${renderer}: retiring unreferenced geometry retains unrelated recorded scopes`,async({page})=>{
  await boot(page,renderer);await settled(page);await warm(page);
  const image=await capture(page);
  const before=await commandStats(page);
  await page.evaluate(()=>{
    const map=commandMap,g=map.ctx.render._painter.gpu;
    const extra=g.createMesh({kind:'fill',vertices:new Float32Array(12),indices:new Uint16Array([0,1,2]),count:3});
    g.destroyMesh(extra);map.render();
  });
  await warm(page,2);const after=await commandStats(page);
  expect(after.builds).toBe(before.builds);expect(after.recordings).toBe(before.recordings);
  expect(after.hits).toBeGreaterThan(before.hits);if(renderer==='webgpu')expect(after.replays).toBeGreaterThan(before.replays);
  expect(after.liveBufferBytes).toBe(before.liveBufferBytes);
  console.log('COMMAND_RETIRE',JSON.stringify({renderer,before,after}));
  expect(await capture(page)).toEqual(image);
  await page.evaluate(()=>commandMap.dispose());
  expect(await page.evaluate(()=>commandErrors)).toEqual([]);
});

for(const renderer of ['webgl2','webgpu'])test(`${renderer}: uniform fill page grouping preserves overlapping translucent samples`,async({page})=>{
 await boot(page,renderer);await settled(page);await warm(page);
 await page.evaluate(()=>{
  const g=commandMap.ctx.render._painter.gpu;g.meshPagesEnabled=true;window.fillMeshes=[];
  for(let i=0;i<6;i++){
   const x=(i%3)*.15;fillMeshes.push(g.createMesh({kind:'fill',vertices:new Float32Array([x,-1,0,0,x+2,-1,0,0,x,1,0,0]),indices:new Uint16Array([0,1,2]),count:3},i%2?'fill-b':'fill-a'));
  }
  window.drawFillGrouping=async(enabled,alpha)=>{g.fillBatchingEnabled=enabled;g.renderBundlesEnabled=false;
   g.begin(commandMap.getTransform());const before=g.stats.drawCalls;g.drawMeshSequence(fillMeshes.map(mesh=>({mesh})),{color:[.12,.45,.8,alpha]});g.end();await g.waitForIdle();return g.stats.drawCalls-before;
  };
 });
 for(const alpha of [.2,.55,1]){
  expect(await page.evaluate(alpha=>drawFillGrouping(false,alpha),alpha)).toBe(6);const reference=await capture(page);
  expect(await page.evaluate(alpha=>drawFillGrouping(true,alpha),alpha)).toBe(2);expect(await capture(page)).toEqual(reference);
 }
 await page.evaluate(async()=>{const g=commandMap.ctx.render._painter.gpu;for(const m of fillMeshes)g.destroyMesh(m);await commandMap.dispose();});
 expect(await page.evaluate(()=>commandErrors)).toEqual([]);
});

for(const renderer of ['webgl2','webgpu'])test(`${renderer}: selected shared-page spans reduce calls with identical transparent fills and stroke pixels`,async({page})=>{
 test.setTimeout(90000);await boot(page,renderer);await settled(page);
 await page.evaluate(()=>{
  const p=commandMap.ctx.render._painter,g=p.gpu;g.meshPagesEnabled=true;
  const fills=[],paths=[];
  for(let i=0;i<3;i++){
   const x=-3+i*2;
   fills.push(g.createMesh({kind:'fill',vertices:new Float32Array([x,-2,0,0,x+2,-2,0,0,x+2,0,0,0,x,0,0,0]),indices:new Uint16Array([0,1,2,0,2,3]),count:6},'range-test-fill'));
   const v=new Float32Array(24);for(let j=0;j<2;j++){v.set([x+j,1,x+j+.9,1.5],j*12);}
   paths.push(g.createMesh({kind:'path',compactStroke:true,compactStrokeXY:true,vertices:v,count:2},'range-test-stroke'));
  }
  window.rangeFillDraws=[{mesh:fills[0],indexRanges:[{firstIndex:3,indexCount:3}]},{mesh:fills[1]},{mesh:fills[2],indexRanges:[{firstIndex:0,indexCount:3}]}];
  window.rangePathDraws=[{mesh:paths[0],ranges:[{firstInstance:1,count:1}]},{mesh:paths[1]},{mesh:paths[2],ranges:[{firstInstance:0,count:1}]}];
  window.drawRangeCase=(compiled)=>{
   const before=g.stats.drawCalls;g.begin(commandMap.getTransform());
   for(const [draws,paint] of [[rangeFillDraws,{color:[.8,.1,.3,.55]}],[rangePathDraws,{color:[.1,.2,.8,1],width:3}]]){
    if(compiled)g.drawMeshSequence(draws,paint);else for(const d of draws)g.drawMesh(d.mesh,paint,d.ranges,d.indexRanges);
   }
   g.end();return {draws:g.stats.drawCalls-before,candidates:g.stats.pathFrameCandidates,submitted:g.stats.pathFrameSubmitted,fill:g.stats.fillFrameSubmitted};
  };
 });
 const direct=await page.evaluate(()=>drawRangeCase(false)),reference=await capture(page);
 const batch=await page.evaluate(()=>drawRangeCase(true));expect(await capture(page)).toEqual(reference);
 expect(batch.draws).toBeLessThan(direct.draws);expect(batch.candidates).toBe(direct.candidates);expect(batch.submitted).toBe(direct.submitted);expect(batch.fill).toBe(direct.fill);
 await page.evaluate(()=>{commandMap.ctx.view._viewport.transform.translate(11,-7);drawRangeCase(true);});const pan=await capture(page);
 await page.evaluate(()=>drawRangeCase(false));expect(await capture(page)).toEqual(pan);
 // A different selected interval must not reuse the previous range commands.
 await page.evaluate(()=>{rangePathDraws[0].ranges[0].firstInstance=0;rangeFillDraws[0].indexRanges[0].firstIndex=0;drawRangeCase(true);});const changed=await capture(page);
 await page.evaluate(()=>drawRangeCase(false));expect(await capture(page)).toEqual(changed);
 const stats=await page.evaluate(async()=>{const p=commandMap.ctx.render._painter;await commandMap.dispose();return p.stats;});
 expect(stats.liveBufferBytes).toBe(0);expect(stats.geometryPages.allocatedBytes).toBe(0);expect(stats.renderCommands.entries).toBe(0);expect(await page.evaluate(()=>commandErrors)).toEqual([]);
});

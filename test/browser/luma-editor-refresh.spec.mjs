import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
const directory=process.env.EMAP_BENCHMARK_DATA_DIR;
async function digest(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
for(const gpu of ['webgl','webgpu'])test(`${gpu}: LUCC loading is atomic and complex vertex edits do not erase the scene`,async({page},info)=>{
 test.skip(!directory,'Requires the complete authorized LUCC file.');test.setTimeout(240000);
 const path=join(directory,'lucc.geojson'),hash=await digest(path),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.setViewportSize({width:1280,height:1000});
 await page.goto('/mapseekai/emap/examples/luma-vertex-editing/?gpu='+gpu);
 await page.waitForFunction(()=>window.lumaEditor?.state==='idle',null,{timeout:60000});
 await page.evaluate(()=>{
  window.refreshTrace={frames:[],commits:[],workerBuilds:[]};let previous=-1;
  function sample(){const e=window.lumaEditor,n=e.gpuStats.drawCalls;
   if(n!==previous){window.refreshTrace.frames.push({time:performance.now(),state:e.state,draws:n,missing:e.lod.missingChunks,filtered:e.screenFilterStats.applied,displayRevision:e.displayRevision,paintedRevision:e.presentation.paintedRevision,sourceRevision:e.session?.dataset.editVersion??0});previous=n;}
   window.refreshTrace.raf=requestAnimationFrame(sample);
  }sample();
 });
 await page.locator('#file-input').setInputFiles(path);await page.locator('#load').click();
 // Resize while raw chunks are still being prepared: this previously allowed a partial draw.
 await page.waitForFunction(()=>window.lumaEditor.cacheDiagnostics.fillBuilds>4,null,{timeout:120000});
 await page.setViewportSize({width:1320,height:1000});
 await page.waitForFunction(()=>['ready','error'].includes(window.lumaEditor.state),null,{timeout:120000});
 expect(await page.locator('#status').getAttribute('data-state'),await page.locator('#status').textContent()).toBe('ready');
 await page.evaluate(()=>window.lumaEditor.settle());
 await page.waitForFunction(()=>{const e=window.lumaEditor;return !e.screenFilterStats.pending&&!e.navigationStats.pending;});
 const loadFrames=await page.evaluate(()=>window.refreshTrace.frames);
 expect(loadFrames.filter(f=>f.state==='loading'&&f.draws>0)).toEqual([]);
 expect(loadFrames.filter(f=>f.draws>0).every(f=>f.missing===0)).toBe(true);
 const selection=await page.evaluate(()=>{
  const e=window.lumaEditor,v=e.session.dataset.arcs.getVertexData(),shapes=e.session.dataset.layers[0].shapes;
  let id=0,max=0;for(let i=0;i<shapes.length;i++){const n=shapes[i]?.reduce((a,p)=>a+p.reduce((b,k)=>b+v.nn[k<0?~k:k],0),0)??0;if(n>max){id=i;max=n;}}
  for(const name of ['patch','build','buildScreenPaths']){const original=e.scene.lodSource[name].bind(e.scene.lodSource);e.scene.lodSource[name]=async(...args)=>{const start=performance.now();try{return await original(...args);}finally{window.refreshTrace.workerBuilds.push({name,ms:performance.now()-start,id:args[0]?.id,kind:args[0]?.kind});}};}
  const commit=e.session.commit.bind(e.session);e.session.commit=()=>{const t=performance.now(),r=commit();window.refreshTrace.commits.push({t,ms:performance.now()-t,revision:r?.revision});return r;};
  return {id,vertices:max};
 });
 // Exercise both an ordinary small feature and the largest 4,664-ring LUCC feature.
 const results=[];
 for(const [id,detailed] of [[0,false],[selection.id,true],[selection.id,false]]){
  await page.locator('#feature-id').fill(String(id));await page.locator('#select-id').click();await page.locator('#fit-selected').click();
  await page.selectOption('#mode','vertex');await page.evaluate(()=>window.lumaEditor.settle());await page.waitForTimeout(100);
  if(detailed){
    const anchor=await page.evaluate(()=>{const e=window.lumaEditor,r=document.querySelector('#stage').getBoundingClientRect();
      const h=e.session.vertexHandles.find(h=>{const [x,y]=e.project(...h.position);return x>50&&x<r.width-50&&y>50&&y<Math.min(r.height-50,innerHeight-r.top-50);});return e.project(...h.position);});
    const rect=await page.locator('#stage').boundingBox();await page.mouse.move(rect.x+anchor[0],rect.y+anchor[1]);
    for(let i=0;i<16;i++){const scale=await page.evaluate(()=>Math.abs(window.lumaEditor.view.mx));await page.mouse.wheel(0,-200);await page.waitForFunction(old=>Math.abs(window.lumaEditor.view.mx)>old*1.2,scale);}
    await page.evaluate(()=>window.lumaEditor.settle());await page.waitForTimeout(120);
  }
  const before=await page.evaluate(()=>{
   const e=window.lumaEditor,r=document.querySelector('#stage').getBoundingClientRect();
   const h=e.session.vertexHandles.find(h=>{const [x,y]=e.project(...h.position);return x>25&&x<r.width-35&&y>25&&y<Math.min(r.height-35,innerHeight-r.top-35);});
   window.refreshTrace.frames=[];window.refreshTrace.workerBuilds=[];
   return {pixel:e.project(...h.position),vertex:h.vertex,position:h.position,export:e.session.exportSelected(),revision:e.session.dataset.editVersion??0,triangulation:{...e.scene.lodSource.triangulationStats},scale:e.view.mx};
  });
  const box=await page.locator('#stage').boundingBox(),x=box.x+before.pixel[0],y=box.y+before.pixel[1];
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+16,y+10,{steps:5});
  expect(await page.evaluate(()=>window.lumaEditor.session.exportSelected())).toBe(before.export);
  const released=Date.now();await page.mouse.up();
  await page.waitForFunction(r=>window.lumaEditor.presentation.paintedRevision>r,before.revision,{timeout:1500});
  const handleSubmittedMs=Date.now()-released;
  const livePixel=await page.evaluate(async()=>{
    const e=window.lumaEditor,patch=e.lastPatch,target=patch.vertices[0]??patch.points[0];
    const [x,y]=e.project(target.x,target.y),image=await e.capturePixels(false,true),pr=devicePixelRatio;
    let white=0,orange=0;
    for(let yy=Math.max(0,Math.floor((y-5)*pr));yy<Math.min(image.height,(y+5)*pr);yy++)
     for(let xx=Math.max(0,Math.floor((x-5)*pr));xx<Math.min(image.width,(x+5)*pr);xx++){
      const i=(yy*image.width+xx)*4,p=image.pixels;
      if(p[i+3]&&p[i]>240&&p[i+1]>240&&p[i+2]>240)white++;
      if(p[i+3]&&p[i]>220&&p[i+1]>50&&p[i+1]<160&&p[i+2]<50)orange++;
     }
    return {white,orange,state:e.state,displayRevision:e.displayRevision,sourceRevision:e.session.dataset.editVersion};
  });
  expect(livePixel.white).toBeGreaterThan(0);expect(livePixel.orange).toBeGreaterThan(0);
  await page.waitForFunction(r=>{const e=window.lumaEditor;return (e.session.dataset.editVersion??0)>r&&e.state==='ready'&&e.displayRevision===e.session.dataset.editVersion;},before.revision,{timeout:30000});
  const elapsedMs=Date.now()-released;await page.waitForTimeout(80);
  const after=await page.evaluate(()=>{const e=window.lumaEditor;return {export:e.session.exportSelected(),triangulation:{...e.scene.lodSource.triangulationStats},stats:e.editStats,trace:window.refreshTrace.frames,work:window.refreshTrace.workerBuilds,commits:window.refreshTrace.commits,patch:e.lastPatch,chunks:e.lastChunks,screen:e.screenFilterStats};});
  expect(after.export).not.toBe(before.export);expect(after.stats.revision).toBe(before.revision+1);expect(after.stats.rebuiltChunks).toBe(after.chunks.length);
  expect(after.trace.every(f=>f.missing===0),JSON.stringify(after.trace)).toBe(true);
  // No frame switches back to the unfiltered raw outline during a coordinate-only update.
  expect(after.trace.every(f=>f.filtered),JSON.stringify(after.trace)).toBe(true);
  const lineBuilds=after.work.filter(x=>x.name==='buildScreenPaths');
  expect(lineBuilds.length).toBeLessThanOrEqual(after.chunks.length);
  expect(after.screen.pending).toBe(0);
  // A bounded regression threshold includes slow CI hardware, but rejects the former seconds-long single chunk rebuild.
  const reusedOnly=after.triangulation.retriangulations===before.triangulation.retriangulations&&after.triangulation.misses===before.triangulation.misses;
  if(reusedOnly)expect(after.stats.geometryMs).toBeLessThan(1200);
  expect(handleSubmittedMs).toBeLessThan(300);
  await page.locator('#undo').click();await page.waitForFunction(()=>window.lumaEditor.state==='ready');
  expect(await page.evaluate(()=>window.lumaEditor.session.exportSelected())).toBe(before.export);
  await page.locator('#redo').click();await page.waitForFunction(()=>window.lumaEditor.state==='ready');
  expect(await page.evaluate(()=>window.lumaEditor.session.exportSelected())).toBe(after.export);
  await page.waitForTimeout(100);
  const parity=await page.evaluate(async()=>{
    const e=window.lumaEditor,a=await e.capturePixels(true,true),b=await e.capturePixels(false,true);
    let maxAlpha=0,maxPremultiplied=0,different=0;
    for(let i=0;i<a.pixels.length;i+=4){
      maxAlpha=Math.max(maxAlpha,Math.abs(a.pixels[i+3]-b.pixels[i+3]));
      for(let k=0;k<3;k++){
        const delta=Math.abs(a.pixels[i+k]*a.pixels[i+3]/255-b.pixels[i+k]*b.pixels[i+3]/255);
        maxPremultiplied=Math.max(maxPremultiplied,delta);if(delta>2)different++;
      }
    }
    return {painted:a.painted,basePainted:b.painted,maxAlpha,maxPremultiplied,different};
  });
  expect(parity.painted).toBeGreaterThan(0);expect(parity.basePainted).toBeGreaterThan(0);
  // Resolving MSAA then quantizing a cached RGBA image introduces at most a few 8-bit levels.
  expect(parity.maxAlpha,JSON.stringify(parity)).toBeLessThanOrEqual(4);
  expect(parity.maxPremultiplied,JSON.stringify(parity)).toBeLessThanOrEqual(4);
  results.push({id,detailed,reusedOnly,scale:before.scale,handleSubmittedMs,elapsedMs,livePixel,parity,...after,export:undefined});
 }
 await page.screenshot({path:info.outputPath('lucc-edited.png')});
 await page.evaluate(()=>{cancelAnimationFrame(window.refreshTrace.raf);window.lumaEditor.dispose();});
 await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>window.lumaEditor.gpuStats.liveBufferBytes)).toBe(0);
 expect(await digest(path)).toBe(hash);expect(errors).toEqual([]);
 const result={gpu,file:'lucc.geojson',sha256:hash,selection,loadFrames,results,errors};
 console.log('LUCC_EDIT_REFRESH',JSON.stringify(result));await info.attach('lucc-refresh',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});

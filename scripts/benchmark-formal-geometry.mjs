#!/usr/bin/env node
import {chromium} from '@playwright/test';
import {resolve,join} from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const directory=arg('--data-dir',process.env.EMAP_BENCHMARK_DATA_DIR);
if(!directory)throw new Error('Usage: --data-dir <authorized folder> [--files points.geojson,building.geojson,lucc.geojson] [--backends webgl2,webgpu]');
const backends=arg('--backends','webgl2,webgpu').split(','),files=arg('--files','points.geojson,building.geojson,lucc.geojson').split(',');
if(backends.some(value=>!['webgl2','webgpu'].includes(value)))throw new Error('Only webgl2/webgpu are accepted by this GPU preparation benchmark');
if(files.some(name=>!['points.geojson','building.geojson','lucc.geojson'].includes(name)))throw new Error('Use the named authorized regression fixtures');
const base=new URL(arg('--base-url','http://127.0.0.1:4187/mapseekai/emap/examples/'));
if(!['http:','https:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||!base.pathname.endsWith('/'))throw new Error('The file benchmark requires a loopback example preview URL ending in /');
const out=resolve(arg('--output','test-results/formal-geometry-chunks'));await mkdir(out,{recursive:true});
await writeFile(join(out,'measurement.json'),JSON.stringify({measuredAt:new Date().toISOString(),base:base.href,width:960,height:640,dpr:1,scope:'Same fully imported fixture; geometry preparation excludes file import. CPU samples are not GPU timings/FPS. settleMs ends before warm samples/pixel validation.',backends,files},null,2));
const results=[];
for(const renderer of backends)for(const filename of files){
 const r={renderer,filename,errors:[],samples:[]};const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});page.setDefaultTimeout(180000);page.on('pageerror',e=>r.errors.push(e.message));
  await page.goto(new URL('luma-benchmark/?renderer='+renderer,base).href);await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
  await page.locator('#file-input').setInputFiles(join(resolve(directory),filename));
  await page.evaluate(()=>lumaBenchmark.loadFile(document.querySelector('#file-input').files[0]));
  if(await page.evaluate(()=>lumaBenchmark.state==='error'))throw new Error(await page.locator('#status').textContent());
  await page.evaluate(async renderer=>{
   const data=lumaBenchmark.scene.dataset,b=lumaBenchmark.scene.bounds;
   lumaBenchmark.dispose();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:960px;height:640px';document.body.append(host);
   window.map=await emap.Emap.create({container:host,renderer,preset:'viewer'});window.errors=[];map.on('error',e=>errors.push(String(e.error)));
   const source=new emap.TopologySource('real');source.setDataset(data,false);await map.addSource('real',source);
   for(const [i,l] of source.getLayers().entries())map.addLayer({id:'l'+i,source:'real','source-layer':l.name,type:l.geometry_type==='point'?'circle':l.geometry_type==='polygon'?'fill':'line',paint:l.geometry_type==='point'?{'circle-radius':3,'circle-color':'#2563eb'}:l.geometry_type==='polygon'?{'fill-color':'#d97706','fill-opacity':.55,'line-color':'#0f766e','line-width':.6}:{'line-color':'#0f766e','line-width':1.2}});
   map.setExtent(new emap.Bounds(b.xmin,b.ymin,b.xmax,b.ymax));window.fit=map.getTransform();
   const painter=map.ctx.render._painter,finish=painter.finishFrame.bind(painter);window.firstFrameTiming={started:performance.now(),firstContentMs:null,completeMs:null,partialFrames:0};
   painter.finishFrame=()=>{const active=painter.active,draws=painter.stats.drawCalls;finish();if(!active)return;if(painter.framePresented&&painter.stats.drawCalls>draws){
    firstFrameTiming.firstContentMs??=performance.now()-firstFrameTiming.started;if(!painter.frameComplete&&firstFrameTiming.completeMs===null)firstFrameTiming.partialFrames++;}
    if(painter.frameComplete)firstFrameTiming.completeMs??=performance.now()-firstFrameTiming.started;};
   map.render();
  },renderer);
  const settle=async()=>{
   await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
   const started=Date.now();
   for(let i=0;i<400;i++){
    const s=await page.evaluate(()=>({errors,ready:map.ctx.render._painter.frameComplete&&map.ctx.render._pendingRender===0,stats:map.ctx.render._painter.stats.geometryChunks}));
    if(s.errors.length)throw new Error(JSON.stringify(s.errors));
    if(s.ready&&s.stats.pending===0)return Date.now()-started;
    if(i%20===0)console.log('PROGRESS',renderer,filename,JSON.stringify(s));
    await page.waitForTimeout(250);
   }throw new Error('geometry settle timeout');
  };
  for(const zoom of [1,16]){
   const started=Date.now();await page.evaluate(z=>{Object.assign(map.ctx.view._viewport.transform,fit);map.ctx.view._viewport.transform.scale(z,480,320);map.render();},zoom);await settle();const settledMs=Date.now()-started;
   const sample=await page.evaluate(async()=>{
    const p=map.ctx.render._painter,times=[],before=p.stats;
    for(let i=0;i<10;i++){await new Promise(requestAnimationFrame);const t=performance.now();map.render();times.push(performance.now()-t);}
    map.render();const image=await createImageBitmap(map.ctx.render._canvas),c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();let painted=0;for(const a of ctx.getImageData(0,0,c.width,c.height).data.filter((_,i)=>i%4===3))if(a)painted++;
    return{times,before,after:p.stats,painted,view:map.getTransform()};
   });if(!sample.painted)throw new Error('No pixels in completed frame');r.samples.push({zoom,settleMs:settledMs,...sample});console.log('SAMPLE',renderer,filename,zoom,JSON.stringify({settleMs:r.samples.at(-1).settleMs,times:sample.times,stats:sample.after.geometryChunks,presentation:sample.after.presentation,fillTriangles:[sample.after.fillFrameSubmitted,sample.after.fillFrameCandidates],painted:sample.painted,uploads:sample.after.uploads-sample.before.uploads}));
  }
  const before=await page.evaluate(()=>({...map.ctx.render._painter.stats,view:map.getTransform()}));await page.mouse.move(600,400);await page.mouse.down();for(let i=0;i<20;i++){await page.mouse.move(600+i*4,400);await page.waitForTimeout(16);}const during=await page.evaluate(()=>({...map.ctx.render._painter.stats,view:map.getTransform(),fast:map.ctx.render._scheduler.fastActive,navigating:map.ctx.render._navSnapshotTransform!==null}));if(!during.navigating||during.presentation.replays<=before.presentation.replays||(during.view.bx===before.view.bx&&during.view.by===before.view.by))throw new Error('Real navigation did not run');await page.mouse.up();await settle();
  r.gesture={before,during,after:await page.evaluate(()=>({...map.ctx.render._painter.stats,view:map.getTransform()}))};
  await page.screenshot({path:out+'/'+renderer+'-'+filename+'.png'});
  r.initialPresentation=await page.evaluate(()=>firstFrameTiming);r.finalErrors=await page.evaluate(()=>errors);r.disposal=await page.evaluate(async()=>{const p=map.ctx.render._painter;await map.dispose();return p.stats;});await page.waitForTimeout(100);r.workersAfterDispose=page.workers().length;
  if(r.disposal.liveBufferBytes||r.disposal.geometryChunks.bytes||r.disposal.geometryChunks.partitionBytes||r.workersAfterDispose)throw new Error('Resource release failure');r.status='passed';
 }catch(e){r.status='failed';r.failure=String(e);console.log('FAILED',renderer,filename,String(e));}
 finally{await browser.close();results.push(r);await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
}
if(results.some(r=>r.status!=='passed'))process.exitCode=1;

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const directory=arg('--data-dir',process.env.EMAP_BENCHMARK_DATA_DIR);
if(!directory)throw Error('Provide --data-dir for the authorized real files.');
const files=arg('--files','big.geojson,lucc.geojson,building.geojson').split(',');
const apis=arg('--gpu','webgl,webgpu').split(',');
if(files.some(f=>!['big.geojson','lucc.geojson','building.geojson','points.geojson','pppp.geojson'].includes(f))||apis.some(a=>!['webgl','webgpu'].includes(a)))throw Error('Invalid files or GPU APIs');
const output=resolve(arg('--output','test-results/luma-zoom-out'));
await mkdir(output,{recursive:true});
const directoryDist=join(root,'packages/examples/dist'),prefix='/mapseekai/emap/examples/';
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(!path.startsWith(prefix))throw Error('route');
 let f=resolve(directoryDist,decodeURIComponent(path.slice(prefix.length)));
 if(!f.startsWith(directoryDist+sep))throw Error('path');
 if((await stat(f)).isDirectory())f=join(f,'index.html');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'})[extname(f)]??'application/octet-stream');
 res.end(await readFile(f));
 }catch{res.writeHead(404).end();}});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(4195,'127.0.0.1',ok);});
const records=[];
async function digest(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
try{for(const gpu of apis)for(const file of files){
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const r={file,gpu,errors:[],trials:[],sha256:await digest(join(directory,file))};
 try{
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>r.errors.push(e.message));page.on('console',e=>{if(e.type()==='error')r.errors.push(e.text());});
 await page.goto('http://127.0.0.1:4195'+prefix+'luma-benchmark/?gpu='+gpu+'&pointLod=off');
 await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle',null,{timeout:60000});
 const started=Date.now();await page.locator('#file-input').setInputFiles(join(directory,file));await page.locator('#load-file').click();
 await page.waitForFunction(()=>['ready','error'].includes(window.lumaBenchmark.state),null,{timeout:240000});
 if(await page.evaluate(()=>window.lumaBenchmark.state)!=='ready')throw Error(await page.locator('#status').textContent());
 r.loadMs=Date.now()-started;
 await page.evaluate(()=>{
 const a=window.lumaBenchmark,s=a.scene.lodSource;window.zoomTrace=[];
 for(const k of ['build','buildScreenPaths']){const run=s[k].bind(s);s[k]=async(...args)=>{const t=performance.now();const result=await run(...args);window.zoomTrace.push({kind:args[0].kind,id:args[0].id,method:k,ms:performance.now()-t,at:performance.now()});return result;};}
 });
 for(const steps of [7,15]){
 await page.evaluate(()=>window.lumaBenchmark.setView(16));
 await page.waitForFunction(()=>{const a=window.lumaBenchmark,n=a.navigationStats;return n.ready&&!n.pending&&!n.active&&a.screenFilterStats.pending===0;},null,{timeout:120000});
 await page.waitForTimeout(250);
 const before=await page.evaluate(()=>({cache:window.lumaBenchmark.cacheDiagnostics,geometry:{...window.lumaBenchmark.lodStats},screen:{...window.lumaBenchmark.screenFilterStats},nav:window.lumaBenchmark.navigationStats,trace:window.zoomTrace.length,view:window.lumaBenchmark.view}));
 const box=await page.locator('#stage').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 const st=Date.now();for(let i=0;i<steps;i++){await page.mouse.wheel(0,400);await page.waitForTimeout(16);}
 const released=Date.now();
 await page.waitForFunction(captures=>{const a=window.lumaBenchmark,n=a.navigationStats,g=a.lodStats;return a.state==='error'||(n.captures>captures&&!n.active&&!n.pending&&a.screenFilterStats.pending===0&&g.pending===0&&g.missingChunks===0);},before.nav.captures,{timeout:120000});
 const elapsed=Date.now()-released;
 const after=await page.evaluate(()=>({cache:window.lumaBenchmark.cacheDiagnostics,geometry:{...window.lumaBenchmark.lodStats},screen:{...window.lumaBenchmark.screenFilterStats},nav:window.lumaBenchmark.navigationStats,view:window.lumaBenchmark.view,trace:window.zoomTrace}));
 const trace=after.trace.slice(before.trace);delete after.trace;
 const trial={steps,gestureMs:released-st,settleMs:elapsed,before,after,rawBuilds:trace.filter(t=>t.method==='build').length,lineBuilds:trace.filter(t=>t.method==='build'&&t.kind==='line').length,fillBuilds:trace.filter(t=>t.method==='build'&&t.kind==='fill').length,screenBuilds:trace.filter(t=>t.method==='buildScreenPaths').length,trace};
 r.trials.push(trial);
 // No warm helper is invoked during the transition. Verify the completed-frame snapshot coverage
 // first, then compare to the same-view explicit screen redraw with a warm raw cache.
 trial.pixels=await page.evaluate(async()=>{
  const a=window.lumaBenchmark,canvas=document.querySelector('.luma-nav-preview');
  async function pixels(){const bitmap=await createImageBitmap(canvas);const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
   const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();let painted=0,hash=2166136261;
   const data=ctx.getImageData(0,0,c.width,c.height).data;for(let i=0;i<data.length;i++){hash=Math.imul(hash^data[i],16777619);if(i%4===3&&data[i])painted++;}return{painted,hash:hash>>>0};}
  const actual=await pixels(),reference=await a.captureScreenPixels();return{actual,reference:{painted:reference.painted,hash:reference.hash}};
 });
 if(!trial.pixels.actual.painted||trial.pixels.actual.hash!==trial.pixels.reference.hash)throw Error('Transition canvas does not match completed screen geometry');
 if(process.argv.includes('--assert-refill')&&(trial.lineBuilds||trial.fillBuilds))throw Error('Redundant raw geometry refill during filtered zoom-out');
 if(process.argv.includes('--assert-refill')&&before.geometry.cacheBytes>256*1024**2)throw Error('Near cache was not evicted to the original budget');
 console.log('ZOOM_OUT',JSON.stringify({file,gpu,steps,settleMs:elapsed,lineBuilds:trial.lineBuilds,fillBuilds:trial.fillBuilds,screenBuilds:trial.screenBuilds,cacheMiB:after.geometry.cacheBytes/1024**2}));
 if(await page.evaluate(()=>window.lumaBenchmark.state)==='error')throw Error(await page.locator('#status').textContent());
 await page.screenshot({path:join(output,file+'-'+gpu+'-'+steps+'.png')});
 }
 await page.evaluate(()=>window.lumaBenchmark.dispose());
 await page.waitForTimeout(100);r.workers=page.workers().length;r.liveBufferBytes=await page.evaluate(()=>window.lumaBenchmark.gpuStats.liveBufferBytes);
 r.sourceUnchanged=r.sha256===await digest(join(directory,file));if(r.errors.length||r.workers||r.liveBufferBytes||!r.sourceUnchanged)throw Error('Error, source change or resource leak');r.status='passed';
 }catch(e){r.status='failed';r.failure=String(e);console.error('ZOOM_FAIL',file,gpu,r.failure);}
 finally{await browser.close();records.push(r);await writeFile(join(output,'results.json'),JSON.stringify({measuredAt:new Date().toISOString(),scope:'real wheel from 16x to ~fit and far; full files; current screen filters; not warm-cache frame throughput',records},null,2));}
}}finally{await new Promise(ok=>server.close(ok));}
if(records.some(r=>r.status!=='passed'))process.exitCode=1;

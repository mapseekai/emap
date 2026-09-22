import {chromium} from '@playwright/test';
import {spawn,execFile,execFileSync} from 'node:child_process';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:net';
import {gzipSync} from 'node:zlib';

// This profiler only opens explicitly authorized local TIFFs in an isolated Chrome.
// OS footprint, V8 heaps, backing storage and texture payloads overlap: do not add them.
const exec=promisify(execFile),arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const directory=arg('--data-dir',process.env.EMAP_BENCHMARK_DATA_DIR);
if(!directory)throw Error('Provide --data-dir for the two authorized TIFFs.');
const out=arg('--out','test-results/raster-memory-audit/baseline');
const width=Number(arg('--width','1280')),height=Number(arg('--height','900'));
if(![width,height].every(v=>Number.isInteger(v)&&v>=400&&v<=2560))throw Error('Invalid viewport size.');
const backends=arg('--backends','canvas,webgl,webgpu').split(','),dprs=arg('--dprs','1,2').split(',').map(Number);
const keys=arg('--files','fus,gj').split(','),cycles=Number(arg('--cycles','4'));
const port=Number(arg('--port','4197')),debugPort=Number(arg('--debug-port','9231')),trace=process.argv.includes('--trace');
const cases={fus:'SVN3-01_20250814_L2D0000203064_01_6112500050210001/SVN3-01_20250814_L2D0000203064_01_6112500050210001-FUS.tiff',gj:'GJ_COG_zip.tif'};
if(backends.some(v=>!['canvas','webgl','webgpu'].includes(v))||keys.some(k=>!cases[k])||dprs.some(v=>![1,1.25,2].includes(v))||!Number.isInteger(cycles)||cycles<1||cycles>12||![port,debugPort].every(v=>Number.isInteger(v)&&v>=1024&&v<=65535)||port===debugPort)throw Error('Invalid profile options.');
await mkdir(out,{recursive:true});
const manifest={at:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}),trace,cycles,results:[]};
const save=()=>writeFile(join(out,'memory.json'),JSON.stringify(manifest,null,2));
async function ensureFree(p){await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(p,'127.0.0.1',()=>s.close(resolve));});}
class CDP {
  constructor(ws){this.ws=ws;this.seq=0;this.pending=new Map();this.listeners=new Map();ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=this.pending.get(v.id);if(!p)return;this.pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}else for(const fn of this.listeners.get(v.method)??[])fn(v.params);};}
  static async open(){const v=await(await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();const ws=new WebSocket(v.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});return new CDP(ws);}
  send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout '+method));},15000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params,sessionId}));});}
  once(event){return new Promise(r=>{this.listeners.set(event,[...(this.listeners.get(event)??[]),r]);});}
  close(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('CDP closed'));}this.pending.clear();this.ws.close();}
}
async function system(){const [vm,swap,pressure]=await Promise.all([exec('/usr/bin/vm_stat'),exec('/usr/sbin/sysctl',['vm.swapusage']),exec('/usr/sbin/sysctl',['kern.memorystatus_vm_pressure_level']).catch(()=>({stdout:'unavailable'}))]);const pageSize=Number(vm.stdout.match(/page size of (\d+)/)?.[1]??16384),counters={};for(const line of vm.stdout.split('\n')){const m=line.match(/^([^:]+):\s+(\d+)/);if(m)counters[m[1]]=Number(m[2]);}return {at:Date.now(),pageSize,counters,swap:swap.stdout.trim(),pressure:pressure.stdout.trim()};}
async function processRss(cdp){const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');const ids=processInfo.map(p=>p.id);let rows=[];try{const p=await exec('/bin/ps',['-p',ids.join(','),'-o','pid=,rss=,pcpu=']);rows=p.stdout.trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));}catch{}return processInfo.map(p=>({...p,rssBytes:(rows.find(r=>r[0]===p.id)?.[1]??0)*1024,cpuPercent:rows.find(r=>r[0]===p.id)?.[2]??0}));}
async function footprint(cdp){const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');const relevant=processInfo.filter(p=>['browser','renderer','GPU'].includes(p.type));return Promise.all(relevant.map(async p=>{try{const r=await exec('/usr/bin/footprint',['-p',String(p.id),'--noCategories','-f','bytes'],{timeout:10000});return {...p,physicalBytes:Number(r.stdout.match(/phys_footprint:\s+(\d+)/)?.[1]??0),physicalPeakBytes:Number(r.stdout.match(/phys_footprint_peak:\s+(\d+)/)?.[1]??0)};}catch(e){return {...p,error:e.message};}}));}
let server,browser,cdp;
try{
 await ensureFree(port);await ensureFree(debugPort);
 server=spawn('pnpm',['--filter','@mapseekai/emap-examples','exec','vite','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{detached:true,stdio:'ignore'});
 const base=`http://127.0.0.1:${port}/mapseekai/emap/examples/luma-raster/`;
 for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Preview failed');try{if((await fetch(base)).ok)break;}catch{}if(i===99)throw Error('Preview timeout');await delay(200);}
 for(const key of keys)for(const dpr of dprs)for(const backend of backends){
  const file=join(directory,cases[key]),beforeFile=await stat(file),row={key,backend,dpr,trace,startSystem:await system(),samples:[],checkpoints:[],actions:[],errors:[]};
  browser=await chromium.launch({channel:'chrome',headless:true,args:[`--remote-debugging-port=${debugPort}`]});cdp=await CDP.open();
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr});const page=await context.newPage();page.setDefaultTimeout(120000);
  page.on('pageerror',e=>row.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')row.errors.push(m.text());});
  await page.goto(base+'?gpu='+backend);await page.waitForFunction(()=>window.lumaRaster?.state==='idle');
  await page.evaluate(()=>{
    const o={phase:'idle',frames:[],longtasks:[],longframes:[],uploads:[],readResults:[],enabled:true};window.__rasterMemoryAudit=o;
    let last=performance.now();function frame(now){if(!o.enabled)return;o.frames.push({at:now,gap:now-last,phase:o.phase});last=now;requestAnimationFrame(frame);}requestAnimationFrame(frame);
    for(const [type,key] of [['longtask','longtasks'],['long-animation-frame','longframes']])try{new PerformanceObserver(list=>{for(const e of list.getEntries())o[key].push({at:e.startTime,duration:e.duration,phase:o.phase,scripts:e.scripts?.map(s=>({duration:s.duration,url:s.sourceURL,fn:s.sourceFunctionName,forcedLayout:s.forcedStyleAndLayoutDuration}))});}).observe({type,buffered:true});}catch{}
    o.mark=name=>{o.phase=name;performance.mark('emap-memory:'+name);};
    o.install=()=>{
      const app=window.lumaRaster;if(app.source&&!app.source.__profiled){const source=app.source;for(const method of ['readWindow','readTexture']){if(!source[method])continue;const original=source[method].bind(source);source[method]=async(...args)=>{const r=await original(...args);o.readResults.push({at:performance.now(),phase:o.phase,method,bytes:Array.isArray(r.data)?r.data.reduce((n,a)=>n+a.byteLength,0):r.data.byteLength,diagnostics:r.diagnostics});return r;};}source.__profiled=true;}
      if(app.native&&!app.native.gpu.__profiled){const gpu=app.native.gpu,method=gpu.uploadPrepared?'uploadPrepared':'upload',original=gpu[method].bind(gpu);gpu[method]=(...args)=>{const t=performance.now();const r=original(...args);o.uploads.push({at:t,duration:performance.now()-t,bytes:r.bytes,phase:o.phase});return r;};gpu.__profiled=true;}
    };
  });
  const attached=new Map();let paused=false,stop=false;
  async function heapSample(){const {targetInfos}=await cdp.send('Target.getTargets');const targets=targetInfos.filter(t=>['page','worker'].includes(t.type)&&t.url.startsWith(`http://127.0.0.1:${port}/`));const live=new Set(targets.map(t=>t.targetId));for(const id of attached.keys())if(!live.has(id))attached.delete(id);const heaps=[];for(const t of targets){try{if(!attached.has(t.targetId)){const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:t.targetId,flatten:true});const {id}=await cdp.send('Runtime.getIsolateId',{},sessionId);attached.set(t.targetId,{sessionId,isolateId:id});}const a=attached.get(t.targetId);heaps.push({kind:t.type,title:t.title,...a,...await cdp.send('Runtime.getHeapUsage',{},a.sessionId)});}catch{attached.delete(t.targetId);}}return heaps;}
  const sampler=(async()=>{let n=0;while(!stop){const t=Date.now();if(!paused){try{const [heaps,processes,app]=await Promise.all([heapSample(),processRss(cdp),page.evaluate(()=>{window.__rasterMemoryAudit.install();return {at:performance.now(),phase:window.__rasterMemoryAudit.phase,stats:window.lumaRaster.stats()};})]);row.samples.push({at:Date.now(),heaps,processes,...app,...(n++%4===0?{system:await system()}:{}),probeMs:Date.now()-t});}catch(e){row.sampleError=String(e);}}await delay(Math.max(30,250-(Date.now()-t)));}})();
  async function mark(name){await page.evaluate(n=>window.__rasterMemoryAudit.mark(n),name);}
  async function checkpoint(name,collect=false){await mark('probe:'+name);paused=true;await delay(300);if(collect){await heapSample();for(const a of attached.values())await cdp.send('HeapProfiler.collectGarbage',{},a.sessionId).catch(()=>{});await delay(80);}row.checkpoints.push({name,forcedGc:collect,heaps:await heapSample(),processes:await footprint(cdp),system:await system(),app:await page.evaluate(()=>window.lumaRaster.stats())});paused=false;}
  async function action(name,fn){await mark(name);const start=Date.now();await fn();const stats=await page.evaluate(()=>window.lumaRaster.settle());row.actions.push({name,ms:Date.now()-start,stats});}
  try{
    if(trace)await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.gc',transferMode:'ReturnAsStream'});
    await checkpoint('empty',true);
    await page.locator('#file-input').setInputFiles(file);
    await action('load',()=>page.evaluate(()=>window.lumaRaster.load(document.querySelector('#file-input').files[0])));
    await checkpoint('loaded');
    for(let c=0;c<cycles;c++){
      for(const zoom of [4,16,128,4,1])await action(`cycle-${c}-zoom-${zoom}`,()=>page.evaluate(z=>window.lumaRaster.setView(z),zoom));
      for(const pan of [[220,-110],[-220,110],[0,0]])await action(`cycle-${c}-pan-${pan}`,()=>page.evaluate(p=>window.lumaRaster.setView(32,p),pan));
      await checkpoint(`cycle-${c}-end`);
    }
    await action('burst-zoom',()=>page.evaluate(async()=>{for(const z of [1,16,4,128,2,32,1,64,4,128,1]){window.lumaRaster.setView(z);await new Promise(r=>setTimeout(r,45));}}));
    await action('wheel-start',()=>page.evaluate(()=>window.lumaRaster.setView(4)));
    const rect=await page.locator('#map').boundingBox(),cx=rect.x+rect.width*.55,cy=rect.y+rect.height*.5;
    await page.mouse.move(cx,cy);await mark('wheel');
    for(let i=0;i<28;i++){await page.mouse.wheel(0,i%14<7?-80:80);await page.waitForTimeout(65);}
    await page.evaluate(()=>window.lumaRaster.settle());
    await mark('drag');
    for(let i=0;i<4;i++){await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+(i%2?240:-240),cy+(i%2?90:-90),{steps:36});await page.mouse.up();await page.evaluate(()=>window.lumaRaster.settle());}
    await mark('idle-loaded');await page.waitForTimeout(2000);await checkpoint('idle-loaded');await checkpoint('loaded-after-gc',true);
    for(let i=0;i<2;i++){await action(`reload-${i}`,()=>page.evaluate(()=>window.lumaRaster.load(document.querySelector('#file-input').files[0])));await checkpoint(`reload-${i}-gc`,true);}
    await mark('dispose');await page.evaluate(()=>window.lumaRaster.dispose());await page.waitForTimeout(1200);await checkpoint('disposed-natural');await checkpoint('disposed-gc',true);
    row.workersAfter=page.workers().length;
    row.timeline=await page.evaluate(()=>{const o=window.__rasterMemoryAudit;o.enabled=false;return {frames:o.frames,longtasks:o.longtasks,longframes:o.longframes,uploads:o.uploads,readResults:o.readResults};});
    if(row.workersAfter||row.errors.length)throw Error('Lifecycle/GPU failure '+JSON.stringify(row.errors));
  }finally{
    stop=true;await sampler;
    if(trace){const done=cdp.once('Tracing.tracingComplete');await cdp.send('Tracing.end');const {stream}=await done;const chunks=[];while(true){const r=await cdp.send('IO.read',{handle:stream,size:1024*1024});chunks.push(r.base64Encoded?Buffer.from(r.data,'base64'):Buffer.from(r.data));if(r.eof)break;}await cdp.send('IO.close',{handle:stream});row.traceFile=`${key}-${backend}-${dpr}-trace.json.gz`;await writeFile(join(out,row.traceFile),gzipSync(Buffer.concat(chunks)));}
    row.endSystem=await system();const after=await stat(file);row.originalFileUnchanged=after.size===beforeFile.size&&after.mtimeMs===beforeFile.mtimeMs;
    manifest.results.push(row);await save();cdp.close();cdp=null;await context.close();await browser.close();browser=null;
  }
  const m=1024**2,pk=(get)=>Math.max(0,...row.samples.map(get));const frames=row.timeline.frames.filter(f=>!f.phase.startsWith('probe:'));
  console.log('MEMORY_CASE',JSON.stringify({key,backend,dpr,samples:row.samples.length,pageHeapMiB:pk(s=>s.heaps.filter(h=>h.kind==='page').reduce((n,h)=>n+h.usedSize,0))/m,pageBackingMiB:pk(s=>s.heaps.filter(h=>h.kind==='page').reduce((n,h)=>n+h.backingStorageSize,0))/m,workerBackingMiB:pk(s=>s.heaps.filter(h=>h.kind==='worker').reduce((n,h)=>n+h.backingStorageSize,0))/m,textureMiB:pk(s=>s.stats.gpu?.liveTextureBytes??0)/m,frames:frames.length,over33:frames.filter(f=>f.gap>33.4).length,maxFrameMs:Math.max(...frames.map(f=>f.gap)),longtasks:row.timeline.longtasks.length}));
 }
}catch(e){manifest.error=String(e);await save();console.error(e);process.exitCode=1;}
finally{cdp?.close();await browser?.close();if(server?.pid)try{process.kill(-server.pid,'SIGTERM');}catch{}}

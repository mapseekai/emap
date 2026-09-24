// Read-only full-file regression harness; all rendering uses the shipped example/API.
import {chromium} from '@playwright/test';
import {writeFile,appendFile,mkdir,stat,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
if(process.argv.includes('--help')){console.log('Usage: node scripts/benchmark-geopackage-browser.mjs --file <local.gpkg> [--renderer webgl2|webgpu|canvas2d] [--cycles 3] [--warm-frames 0..64] [--gpu-frames 0..64] [--output <directory>] [--base-url http://127.0.0.1:4187/mapseekai/emap/examples/]\nRequires local Chrome, Python 3 (read-only SQLite validation), and ps. Keeps default importer, topology, styles, LOD and memory limits. Does not serve or upload the file.');process.exit(0);}
const input=arg('--file');if(!input)throw new Error('--file is required');
const file=resolve(input),backend=arg('--renderer','webgl2'),cycles=Number(arg('--cycles','3')),warmFrames=Number(arg('--warm-frames','0')),gpuFrames=Number(arg('--gpu-frames','0'));
if(!['webgl2','webgpu','canvas2d'].includes(backend)||!Number.isInteger(cycles)||cycles<0||cycles>10)throw new Error('Invalid renderer or cycles (0..10)');
if(!Number.isInteger(warmFrames)||warmFrames<0||warmFrames>64)throw new Error('Invalid --warm-frames (0..64)');
if(!Number.isInteger(gpuFrames)||gpuFrames<0||gpuFrames>64)throw new Error('Invalid --gpu-frames (0..64)');
const base=new URL(arg('--base-url','http://127.0.0.1:4187/mapseekai/emap/examples/'));
if(!['http:','https:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||!base.pathname.endsWith('/'))throw new Error('Use a loopback examples URL ending in /');
const inputStat=await stat(file);if(!inputStat.isFile()||!file.toLowerCase().endsWith('.gpkg'))throw new Error('Expected a local GeoPackage file');
const hashFile=async()=>{const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');};
const scan=String.raw`import sqlite3,pathlib,json,sys
p=pathlib.Path(sys.argv[1]);db=sqlite3.connect(p.as_uri()+'?mode=ro&immutable=1',uri=True)
db.execute('PRAGMA query_only=ON');db.execute('PRAGMA cache_size=-8192');tables=[]
for name,kind in db.execute('SELECT table_name,geometry_type_name FROM gpkg_geometry_columns ORDER BY table_name').fetchall():
 q='"'+name.replace('"','""')+'"';n=db.execute('SELECT COUNT(*) FROM '+q).fetchone()[0];tables.append({'table':name,'type':kind,'features':n})
db.close();print(json.dumps({'path':str(p),'bytes':p.stat().st_size,'tables':tables,'features':sum(t['features'] for t in tables)}))`;
const metadata=JSON.parse((await exec('python3',['-c',scan,file],{maxBuffer:1024*1024})).stdout);metadata.sha256=await hashFile();
const tag=new Date().toISOString().replaceAll(':','-'),out=resolve(arg('--output','test-results/geopackage-browser/'+tag+'-'+backend));await mkdir(out,{recursive:true});
await writeFile(out+'/input.json',JSON.stringify(metadata,null,2));await writeFile(out+'/trace.jsonl','');
const started=Date.now(),result={backend,tag,file,warmFrames,gpuFrames,started:new Date().toISOString(),errors:[],events:[],peakRss:0};
const log=async(type,data={})=>{const event={...data,elapsedMs:Date.now()-started,type};if(type!=='memory')console.log(JSON.stringify(event));await appendFile(out+'/trace.jsonl',JSON.stringify(event)+'\n');};
let server,browser,page,cdp,watchdog,memoryBusy=false,stopped=false,loaded=false;
const timed=async(promise,ms=10000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timed operation')),ms)})]);}finally{clearTimeout(timer);}};
const heap=async()=>{try{return await timed(cdp.send('Runtime.getHeapUsage'),3000);}catch{return null;}};
const finish=async(reason)=>{if(stopped)return;stopped=true;result.stopReason=reason;await log('stop',{reason});await server?.close().catch(()=>{});};
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-networking']});
 server={close:()=>browser.close()};const browserSession=await browser.newBrowserCDPSession();result.browserPid=(await browserSession.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;
 const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
 await context.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost','[::1]'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
 page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('crash',()=>{result.crash=true;void finish('renderer-crash');});
 page.on('pageerror',e=>{result.errors.push(e.message);void log('pageerror',{message:e.message});});
 await page.exposeBinding('__stressEvent',(_s,e)=>{if(e.mapError)result.errors.push(e.mapError);result.events.push(e);return log('page',e);});
 cdp=await context.newCDPSession(page);
 watchdog=setInterval(async()=>{
  if(memoryBusy||stopped)return;memoryBusy=true;
  try{const {stdout}=await exec('ps',['-axo','pid=,ppid=,rss=,%cpu=,comm=']);
   const ps=stdout.trim().split('\n').map(l=>{const m=l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/);return m?{pid:+m[1],ppid:+m[2],rss:+m[3]*1024,cpu:+m[4],comm:m[5]}:null;}).filter(Boolean);
   const ids=new Set([result.browserPid]);for(let i=0;i<8;i++)for(const p of ps)if(ids.has(p.ppid))ids.add(p.pid);
   const owned=ps.filter(p=>ids.has(p.pid)),rss=owned.reduce((n,p)=>n+p.rss,0);result.peakRss=Math.max(result.peakRss,rss);
   await log('memory',{rss,processes:owned});
   if(rss>8*1024**3)await finish('safety-stop: isolated-browser aggregate RSS exceeded 8 GiB');
   if(Date.now()-started>12*60*1000)await finish('safety-stop: 12 minute deadline');
  }catch(e){await log('monitor-error',{message:String(e)});}finally{memoryBusy=false;}
 },1000);
 await page.goto(new URL('geopackage-viewer/?renderer='+backend,base).href);
 await page.waitForFunction(()=>window.geopackageDemo&&!geopackageDemo.loading&&geopackageDemo.source);
 await page.evaluate(()=>{
  window.stress={events:[],lastProgress:'',phase:'read',importCompleted:false,firstFrameMs:null,completeFrameMs:null,ticks:0,maxTickGap:0,lastTick:performance.now(),longTasks:0,maxLongTask:0};
  setInterval(()=>{const n=performance.now();stress.maxTickGap=Math.max(stress.maxTickGap,n-stress.lastTick);stress.lastTick=n;stress.ticks++;},50);
  new PerformanceObserver(l=>{for(const e of l.getEntries()){stress.longTasks++;stress.maxLongTask=Math.max(stress.maxLongTask,e.duration);}}).observe({type:'longtask',buffered:false});
  new MutationObserver(()=>{const v=document.getElementById('status').textContent;if(v!==stress.lastProgress){stress.lastProgress=v;if(performance.now()-(stress.sent??0)>1500||v.includes('topology')||v.includes('失败')||v.includes('完成')){stress.sent=performance.now();void __stressEvent({status:v});}}}).observe(document.getElementById('status'),{childList:true,subtree:true,characterData:true});
  geopackageDemo.map.on('error',e=>void __stressEvent({mapError:String(e.error)}));
  const send=(phase,extra={})=>{stress.phase=phase;void __stressEvent({phase,pageMs:performance.now(),...extra});};
  const buffer=Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer=function(){
   if(!(this instanceof File)||!this.name.endsWith('.gpkg'))return buffer.call(this);
   stress.fileStart=performance.now();stress.fileName=this.name;send('read-start',{bytes:this.size});
   return buffer.call(this).then(bytes=>{send('read-complete',{durationMs:performance.now()-stress.fileStart});return bytes;});
  };
  const proto=Object.getPrototypeOf(geopackageDemo.source),setData=proto.setData;
  proto.setData=function(input){const t=performance.now();send('source-import-start');return setData.call(this,input).then(result=>{stress.importCompleted=true;send('source-import-complete',{durationMs:performance.now()-t});return result;});};
  const map=geopackageDemo.map,addSource=map.addSource.bind(map);
  map.addSource=async(...args)=>{const t=performance.now();send('source-register-start');const result=await addSource(...args);send('source-register-complete',{durationMs:performance.now()-t});return result;};
  const painter=map.ctx.render._painter,finish=painter.finishFrame?.bind(painter);
  if(finish)painter.finishFrame=function(){
   const before=this.gpu.stats.drawCalls,beforeFrame=this.gpu.stats.frames;finish();if(this.gpu.stats.frames===beforeFrame)return;
   if(!geopackageDemo.dataset?.info?.input_files?.includes(stress.fileName))return;
   if(this.framePresented&&this.gpu.stats.drawCalls>before&&stress.firstFrameMs===null){stress.firstFrameMs=performance.now()-stress.fileStart;send('first-render-submission',{durationMs:stress.firstFrameMs});}
   if(this.frameComplete&&stress.completeFrameMs===null){stress.completeFrameMs=performance.now()-stress.fileStart;send('complete-render-submission',{durationMs:stress.completeFrameMs});}
  };

 });
 result.beforeHeap=await heap();await log('file-select',{bytes:(await stat(file)).size});result.fileStart=Date.now()-started;
 await page.locator('#file-input').setInputFiles(file);
 const snapshot=()=>page.evaluate(()=>{const s=geopackageDemo,p=s.map.ctx.render._painter;return {loading:s.loading,error:s.error,status:document.getElementById('status').textContent,features:s.source?.getLayers().reduce((n,l)=>n+(l.shapes?.length??0),0),tableRows:s.dataset?.info?.geopackage?.tables.map(t=>({table:t.table,rows:t.rows})),layers:s.source?.getLayers().map(l=>({name:l.name,count:l.shapes?.length,kind:l.geometry_type})),frameComplete:p.frameComplete!==false,navigating:s.map.ctx.render._navSnapshotTransform!==null,pendingRender:s.map.ctx.render._pendingRender,view:s.map.getTransform(),dimensions:{width:s.map.ctx.view._viewport.width,height:s.map.ctx.view._viewport.height,dpr:devicePixelRatio},arcs:s.source?.getArcs()?.size(),vertices:s.source?.getArcs()?.getPointCount?.(),missingResidents:p.chunks?[...p.chunks.requests.values()].flatMap(r=>r.entries??[]).filter(e=>p.chunks.entries.get(e.id)!==e).length:0,stats:p.stats,heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null,responsiveness:stress};});
 while(!stopped&&!loaded){
  try{const pending=snapshot();const s=await Promise.race([pending,sleep(5000).then(()=>null)]);
   if(s){result.last=s;await log('state',{loading:s.loading,error:s.error,status:s.status,features:s.features,complete:s.frameComplete,heap:s.heap,chunks:s.stats?.geometryChunks,presentation:s.stats?.presentation});
    if(s.error){await finish('import-error');break;}
    if(s.responsiveness.importCompleted&&!s.loading){loaded=true;result.importMs=Date.now()-started;const observed=s.tableRows.map(l=>[l.table,l.rows]).sort((a,b)=>a[0].localeCompare(b[0]));const expected=metadata.tables.map(l=>[l.table,l.features]).sort((a,b)=>a[0].localeCompare(b[0]));if(JSON.stringify(observed)!==JSON.stringify(expected))throw new Error('Native SQLite and browser feature counts differ');await log('import-complete',{layers:s.layers});break;}
   }else{await log('ui-busy');await pending.catch(()=>{});}
  }catch(e){if(!stopped)await finish('poll-error: '+String(e));}
  if(!stopped&&!loaded)await sleep(2000);
 }
 if(loaded&&!stopped){
  for(let i=0;i<300&&!stopped;i++){
   const s=await snapshot();result.last=s;
   if(s.stats?.geometryChunks?.errors||result.errors.length)throw new Error('Rendering reported an error');
   if(s.missingResidents)throw new Error('Dangling geometry request entries: '+s.missingResidents);if(s.frameComplete&&!(s.stats?.geometryChunks?.pending>0)&&s.pendingRender===0){result.completeMs=Date.now()-started;break;}
   if(i%5===0)await log('render-wait',{chunks:s.stats?.geometryChunks,presentation:s.stats?.presentation});
   await sleep(1000);
  }
  if(!stopped&&!result.completeMs)throw new Error('Initial geometry failed to settle');
  if(!stopped){await page.screenshot({path:out+'/full.png'});await log('full-render',{completeMs:result.completeMs,stats:result.last.stats});
   result.postImportHeap=await heap();await page.evaluate(()=>{stress.fit=geopackageDemo.map.getTransform();});
   const waitSettled=async(label)=>{
    const t=Date.now();let s,quiet=0;
    do{
     s=await timed(snapshot(),30000);
     if(s.error||s.stats?.geometryChunks?.errors)throw new Error('render-error '+JSON.stringify(s.error??s.stats.geometryChunks));
     if(s.missingResidents)throw new Error('Dangling geometry request entries: '+s.missingResidents);
     if(s.frameComplete&&!(s.stats?.geometryChunks?.pending>0)&&!s.navigating&&s.pendingRender===0){if(++quiet>=3)return {ms:Date.now()-t,state:s};}else quiet=0;
     if(Date.now()-t>120000)throw new Error(label+' did not settle in 120s');
     await sleep(250);
    }while(!stopped);throw new Error('stopped');
   };


   // Warm samples run after cold readiness is recorded. CPU submission != GPU duration/FPS.
   const auditScene=async(label)=>{if(!warmFrames&&!gpuFrames)return;const info=await page.evaluate(async({frames,gpuFrames})=>{const map=geopackageDemo.map,p=map.ctx.render._painter;const times=[];let draws=0,uploads=0;for(let i=0;i<frames;i++){await new Promise(requestAnimationFrame);const d=p.stats?.drawCalls??0,u=p.stats?.uploads??0,t=performance.now();map.render();times.push(performance.now()-t);draws=(p.stats?.drawCalls??0)-d;uploads+=(p.stats?.uploads??0)-u;}const all={},indexBuffers=new Set();for(const m of p.gpu?.meshes??[]){const v=all[m.kind]??={meshes:0,bytes:0,indexBytes:0,u16:0};v.meshes++;v.bytes+=m.bytes;if(m.indices&&!indexBuffers.has(m.indices)){v.indexBytes+=m.indices.byteLength;indexBuffers.add(m.indices);}if(m.indices?.indexType==='uint16')v.u16++;}const gpu=p.gpu,gpuTimes=[],completionMs=[];const timestampSupported=!!gpu?.timestampSupported;
    if(gpuFrames&&timestampSupported){gpu.enableTiming(true);try{for(let i=0;i<gpuFrames;i++){
      await new Promise(requestAnimationFrame);const count=gpu.gpuTimings.length,start=performance.now();map.render();await gpu.waitForIdle();completionMs.push(performance.now()-start);
      for(let k=0;k<50&&gpu.gpuTimings.length===count;k++)await new Promise(r=>setTimeout(r,2));
      if(gpu.gpuTimings.length>count)gpuTimes.push(gpu.gpuTimings.at(-1));
    }}finally{gpu.enableTiming(false);}}
    return {times,draws,uploads,all,gpuTimes,completionMs,timestampSupported,pages:p.stats?.geometryPages,physicalBufferBytes:gpu?.stats.liveBufferBytes,renderCommands:p.stats?.renderCommands};},{frames:warmFrames,gpuFrames});await log('scene-audit',{label,...info});};
   await auditScene('full');
   for(let cycle=0;cycle<cycles;cycle++){
    await page.mouse.move(600,420);await page.mouse.wheel(0,-800);await sleep(350);const near=await waitSettled('near');await log('near-settle',{cycle,ms:near.ms,chunks:near.state.stats?.geometryChunks});
    await page.mouse.down();for(let i=0;i<20;i++){await page.mouse.move(600+i*4,420+i);await sleep(20);}await page.mouse.up();const pan=await waitSettled('pan');await log('pan-settle',{cycle,ms:pan.ms,chunks:pan.state.stats?.geometryChunks});
    await page.mouse.wheel(0,800);await sleep(350);const far=await waitSettled('far');await log('far-settle',{cycle,ms:far.ms,chunks:far.state.stats?.geometryChunks});const s=far.state;result.events.push({kind:'cycle',cycle,nearMs:near.ms,panMs:pan.ms,farMs:far.ms,stats:s.stats,heap:s.heap,cdpHeap:await heap(),responsiveness:s.responsiveness});await log('cycle',{cycle,stats:s.stats,heap:s.heap});
   }
   for(const zoom of [4,16,32,1]){
    const t=Date.now();await page.evaluate(zoom=>{const m=geopackageDemo.map,v=m.ctx.view._viewport;Object.assign(v.transform,stress.fit);v.transform.scale(zoom,v.width/2,v.height/2);m.render();},zoom);
    const settled=await waitSettled('zoom-'+zoom);result.events.push({kind:'zoom',zoom,ms:Date.now()-t,stats:settled.state.stats,heap:await heap()});
    await log('zoom-settled',{zoom,durationMs:Date.now()-t,chunks:settled.state.stats?.geometryChunks,fillCandidates:settled.state.stats?.fillFrameCandidates,fillSubmitted:settled.state.stats?.fillFrameSubmitted});
    await auditScene('zoom-'+zoom);
    await page.screenshot({path:out+'/zoom-'+zoom+'.png'});
   }
   await page.screenshot({path:out+'/after-nav.png'});
   result.beforeDispose=await snapshot();result.afterCycleHeap=await heap();await timed(cdp.send('HeapProfiler.collectGarbage'),30000);result.retainedDatasetHeap=await heap();result.disposal=await page.evaluate(async()=>{const s=geopackageDemo,p=s.map.ctx.render._painter;await s.map.dispose();s.source=null;s.dataset=null;return p.stats??{};});
   await sleep(1000);result.workersAfterDispose=page.workers().length;result.afterDisposeHeap=await heap();await timed(cdp.send('HeapProfiler.collectGarbage'),30000);result.afterGcHeap=await heap();await log('disposed',{stats:result.disposal,workers:result.workersAfterDispose});if(result.errors.length||result.disposal?.liveBufferBytes||result.disposal?.geometryChunks?.bytes||result.workersAfterDispose)throw new Error('Final errors or retained resources');result.status='passed';
  }
 }
}catch(e){result.failure=String(e);await log('failure',{message:String(e)});}
finally{clearInterval(watchdog);await finish(result.status??result.stopReason??'test-failed');result.elapsedMs=Date.now()-started;result.sourceUnchanged=(await stat(file)).mtimeMs===inputStat.mtimeMs&&(await hashFile())===metadata.sha256;if(!result.sourceUnchanged)result.failure='Input file changed during benchmark';if(result.status!=='passed'||!result.sourceUnchanged)process.exitCode=1;await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log('RESULT',out,JSON.stringify({status:result.status,stop:result.stopReason,peakRss:result.peakRss,elapsedMs:result.elapsedMs}));}

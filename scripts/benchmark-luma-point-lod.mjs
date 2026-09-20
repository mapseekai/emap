#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const directory=arg('--data-dir',process.env.EMAP_BENCHMARK_DATA_DIR);
const gpu=arg('--gpu','webgl'),frames=Number(arg('--frames','30')),port=Number(arg('--port','4194'));
if(!directory||!['webgl','webgpu'].includes(gpu)||!Number.isInteger(frames)||frames<1||frames>120||!Number.isInteger(port)||port<1024||port>65535)
  throw new Error('Usage: --data-dir <authorized folder> [--gpu webgl|webgpu] [--frames 1..120] [--port 4194]');
const output=resolve(arg('--output','test-results/luma-point-lod/'+gpu));await mkdir(output,{recursive:true});
const digest=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
const server=spawn('pnpm',['--filter','@mapseekai/emap-examples','exec','vite','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe'],detached:true});
let serverLog='';server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
const base=`http://127.0.0.1:${port}/mapseekai/emap/examples/`,records=[];
try{
 let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(serverLog);try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 if(!ready)throw new Error('Preview startup timed out');
 for(const file of ['points.geojson','pppp.geojson']){
  const record={file,backend:gpu,sha256:await digest(join(directory,file)),pointLod:{enabled:true,cellSize:3},views:[],errors:[]};
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
   const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1.25});
   page.on('pageerror',e=>record.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')record.errors.push(m.text());});
   await page.goto(base+'luma-benchmark/?gpu='+gpu);await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle',null,{timeout:60000});
   await page.locator('#file-input').setInputFiles(join(directory,file));await page.locator('#load-file').click();
   await page.waitForFunction(()=>['ready','error'].includes(window.lumaBenchmark.state),null,{timeout:180000});
   if(await page.evaluate(()=>window.lumaBenchmark.state)!=='ready')throw new Error(await page.locator('#status').textContent());
   record.source=await page.evaluate(()=>({features:window.lumaBenchmark.scene.featureCount,vertices:window.lumaBenchmark.scene.vertexCount,preparation:window.lumaBenchmark.preparation}));
   for(const [name,scale] of [['fit',1],['far',Math.exp(-3.2)],['near',16]]){
    await page.evaluate(s=>window.lumaBenchmark.setView(s),scale);
    const startingGeometry=await page.evaluate(()=>({...window.lumaBenchmark.lodStats}));
    const report=await page.evaluate(n=>window.lumaBenchmark.run(n),frames);
    if(!report||!report.pointLod.enabled||report.pointLod.cellSize!==3||report.backend!==gpu||report.geometry.missingChunks||report.warmNavigation.geometryUploads)
      throw new Error('Incorrect LOD benchmark mode or incomplete warm draw');
    const pixels=await page.evaluate(()=>window.lumaBenchmark.capturePixels());if(!pixels.paintedPixels)throw new Error('Blank image');
    record.views.push({name,scale,startingGeometry,pixels,report});
    await page.screenshot({path:join(output,`${file}-${name}.png`)});
    await writeFile(join(output,file+'.json'),JSON.stringify(record,null,2));
    console.log('MEASURED',JSON.stringify({file,gpu,name,original:record.source.vertices,submitted:startingGeometry.displayVertices,mode:startingGeometry.geometryMode,results:report.results,warm:report.warmNavigation}));
   }
   await page.evaluate(async()=>{await window.lumaBenchmark.setPointLod(false,3);await window.lumaBenchmark.setView(1);});
   record.disabled=await page.evaluate(()=>({geometry:window.lumaBenchmark.lodStats,lod:window.lumaBenchmark.pointLodStats}));
   if(record.disabled.geometry.displayVertices!==record.source.vertices||record.disabled.lod.cacheBytes!==0)throw new Error('Full-detail toggle failed');
   await page.evaluate(()=>window.lumaBenchmark.dispose());await page.waitForTimeout(100);
   record.disposal=await page.evaluate(()=>window.lumaBenchmark.gpuStats);record.workersAfterDispose=page.workers().length;
   if(record.disposal.liveBufferBytes||record.workersAfterDispose||record.errors.length)throw new Error('Browser errors or retained resources');
   record.sourceUnchanged=record.sha256===await digest(join(directory,file));if(!record.sourceUnchanged)throw new Error('Input changed');record.status='passed';
  }catch(e){record.status='failed';record.failure=String(e);console.log('FAILED',file,record.failure);}finally{await browser.close();}
  records.push(record);await writeFile(join(output,file+'.json'),JSON.stringify(record,null,2));
  await writeFile(join(output,'summary.json'),JSON.stringify({date:new Date().toISOString(),scope:'Native mapshaper dataset retained; existing PointLod enabled at 3 CSS px; original representatives, no centroids; full lines/polygons',method:'ABBA navigation, 12 warmup frames and '+frames+' measured frames per trial; GPU sampled twice; rAF FPS is not GPU execution time',records},null,2));
 }
}finally{try{process.kill(-server.pid,'SIGTERM');}catch{}}
if(records.some(r=>r.status!=='passed'))process.exitCode=1;

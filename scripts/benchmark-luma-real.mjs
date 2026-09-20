#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i+1]; };
const directory = arg('--data-dir', process.env.EMAP_BENCHMARK_DATA_DIR);
if (!directory) throw new Error('Usage: node scripts/benchmark-luma-real.mjs --data-dir <authorized-local-folder> [--frames 30] [--files lucc.geojson,points.geojson]');
const files = arg('--files', 'lucc.geojson,building.geojson,points.geojson,pppp.geojson,big.geojson').split(',');
if (files.some((f) => !['big.geojson','building.geojson','lucc.geojson','points.geojson','pppp.geojson'].includes(f))) throw new Error('Only the five explicitly authorized input files are accepted.');
const gpu=arg('--gpu','webgl');if(!['webgl','webgpu'].includes(gpu))throw new Error('GPU must be webgl or webgpu');
const frames = Number(arg('--frames', '30'));
const output = resolve(arg('--output', 'test-results/luma-full-'+gpu));
await mkdir(output, {recursive: true});
const port = Number(arg('--port', '4193'));
const server = spawn('pnpm', ['--filter','@mapseekai/emap-examples','exec','vite','preview','--host','127.0.0.1','--port',String(port),'--strictPort'], {stdio: ['ignore','pipe','pipe'], detached: true});
let serverLog = ''; server.stdout.on('data', b => serverLog += b); server.stderr.on('data', b => serverLog += b);
const base = `http://127.0.0.1:${port}/mapseekai/emap/examples/`;
const results = [];
try {
  let ready = false;
  for (let i=0; i<100; i++) { if (server.exitCode !== null) throw new Error(serverLog); try { const r=await fetch(base); if(r.ok) {ready=true;break;} } catch {} await new Promise(r=>setTimeout(r,100)); }
  if (!ready) throw new Error('Preview startup timed out: '+serverLog);
  for (const filename of files) {
    const path = join(resolve(directory), filename), info = await stat(path);
    const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
    const record = {filename,backend:gpu,geometryMode:'full',bytes:info.size,sha256:hash.digest('hex'),startedAt:new Date().toISOString(),scenarios:[],errors:[]};
    const browser = await chromium.launch({channel:'chrome',headless:true, args:['--enable-precise-memory-info']});
    try {
      const page = await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1.25});
      page.on('pageerror', error => record.errors.push(error.message));
      page.on('crash', () => record.errors.push('Browser page crashed'));
      page.on('console', m => {if(m.type()==='error') record.errors.push(m.text());});
      await page.goto(base+'luma-benchmark/?gpu='+gpu+'&pointLod=off');
      await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle',null,{timeout:60000});
      if(!await page.evaluate(()=>window.lumaBenchmark?.gpuStats))throw new Error(await page.locator('#gpu-warning').textContent());
      await page.locator('#file-input').setInputFiles(path);
      const started = Date.now(); await page.locator('#load-file').click();
      for (let i=0; i<600; i++) {
        await page.waitForTimeout(1000);
        const state=await page.evaluate(()=>({state:window.lumaBenchmark.state,message:document.querySelector('#status').textContent}));
        if(i%5===0) console.log(filename, Math.round((Date.now()-started)/1000)+'s', state.message);
        if(state.state==='error') throw new Error(state.message);
        if(state.state==='ready') break;
        if(i===599) throw new Error('Import/LOD preparation exceeded ten minutes');
      }
      await page.evaluate(async()=>{if(window.lumaBenchmark.setPointLod)await window.lumaBenchmark.setPointLod(false,3);});
      record.readyWallMs = Date.now()-started;
      record.scene = await page.evaluate(()=>{const s=window.lumaBenchmark.scene;return {name:s.name,features:s.featureCount,vertices:s.vertexCount,crs:s.dataset.info?.crs_string,preparation:window.lumaBenchmark.preparation,lod:window.lumaBenchmark.lodStats}});
      if(record.scene.name!==filename) throw new Error('Wrong scene loaded');
      for(const [name,scale] of [['fit',1],['far',Math.exp(-3.2)],['near',16]]) {
        await page.evaluate(s=>window.lumaBenchmark.setView(s),scale);
        const report = await page.evaluate(n=>window.lumaBenchmark.run(n),frames);
        if(!report) throw new Error('Benchmark did not complete');
        const pixels = await page.evaluate(()=>window.lumaBenchmark.capturePixels());
        if(!pixels.paintedPixels || pixels.backend!==gpu) throw new Error('Pixel verification failed: '+JSON.stringify(pixels));
        if(report.geometryMode!=='full'||report.geometry.omitted!==0||report.geometry.fallbackChunks!==0||report.geometry.missingChunks!==0)
          throw new Error('Incomplete or simplified geometry was submitted');
        if(report.warmNavigation.geometryUploads!==0)throw new Error('Warm navigation rebuilt full geometry');

        const memory = await page.evaluate(()=>performance.memory ? {usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit} : null);
        const gpuTiming=await page.evaluate(()=>window.lumaBenchmark.profileGpu(8));
        record.scenarios.push({name,scale,report,pixels,memory,gpuTiming});
        console.log('MEASURED',JSON.stringify({file:filename,view:name,results:report.results,lod:report.lod,resources:report.gpuResources,warmNavigation:report.warmNavigation}));
        await page.screenshot({path:join(output,filename+'-'+name+'.png')});
        if(name==='far') {
          const staticSample=await page.evaluate(async()=>{const cpu=[],intervals=[];let prev=await new Promise(requestAnimationFrame);for(let i=0;i<12;i++){cpu.push(window.lumaBenchmark.draw('luma'));const now=await new Promise(requestAnimationFrame);intervals.push(now-prev);prev=now;}return {cpu,intervals};});
          record.farStatic = staticSample;
          await page.evaluate(()=>{window.__interaction={tasks:[],gaps:[],last:performance.now()};window.__observer=new PerformanceObserver(list=>window.__interaction.tasks.push(...list.getEntries().map(e=>e.duration)));window.__observer.observe({type:'longtask',buffered:false});window.__timer=setInterval(()=>{const now=performance.now();window.__interaction.gaps.push(now-window.__interaction.last);window.__interaction.last=now;},16);});
          const box=await page.locator('#stage').boundingBox(); const cx=box.x+box.width/2,cy=box.y+box.height/2;
          await page.mouse.move(cx,cy);await page.mouse.down();
          for(let i=1;i<=18;i++){await page.mouse.move(cx+i*6,cy+Math.sin(i*.3)*30);await page.waitForTimeout(16);}
          await page.mouse.up();await page.waitForTimeout(200);
          record.farInteraction=await page.evaluate(()=>{clearInterval(window.__timer);window.__observer.disconnect();return window.__interaction;});
        }
      }
      await page.evaluate(()=>window.lumaBenchmark.dispose());await page.waitForTimeout(200);
      record.disposal=await page.evaluate(()=>({gpu:window.lumaBenchmark.gpuStats,lod:window.lumaBenchmark.lodStats}));
      record.activeWorkersAfterDispose=page.workers().length;
      if(record.disposal.gpu.liveBufferBytes!==0 || record.activeWorkersAfterDispose!==0) throw new Error('Native resources were not released');
      record.status='passed';
    } catch (error) {record.status='failed';record.failure=String(error);console.log('FAILED',filename,String(error));}
    finally {await browser.close();}
    record.finishedAt=new Date().toISOString(); results.push(record);
    await writeFile(join(output,filename+'.json'),JSON.stringify(record,null,2));
    await writeFile(join(output,'summary.json'),JSON.stringify({scope:'Five complete real GeoJSON files; full native geometry; no LOD, no sampling, no feature-size omission',backend:gpu,gpuExecutionTiming:'separate optional timestamp query samples; not mixed with rAF FPS',results},null,2));
  }
} finally {
  try { process.kill(-server.pid,'SIGTERM'); } catch {}
}
if(results.some(r=>r.status!=='passed')) process.exitCode=1;

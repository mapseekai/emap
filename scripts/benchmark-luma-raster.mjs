import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {stat,writeFile,mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {join} from 'node:path';
const argument=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const directory=argument('--data-dir',process.env.EMAP_BENCHMARK_DATA_DIR);
if(!directory)throw new Error('Pass --data-dir or EMAP_BENCHMARK_DATA_DIR with the authorized TIFF directory.');
const out=argument('--out',join(process.cwd(),'test-results/raster-baseline'));
await mkdir(out,{recursive:true});
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const files=[
 {key:'fus',path:join(directory,'SVN3-01_20250814_L2D0000203064_01_6112500050210001/SVN3-01_20250814_L2D0000203064_01_6112500050210001-FUS.tiff')},
 {key:'gj',path:join(directory,'GJ_COG_zip.tif')}
];
const port=Number(argument('--port','4195')),origin=`http://127.0.0.1:${port}`,base='/mapseekai/emap/examples/';
const trials=Number(argument('--trials',process.env.RASTER_TRIALS??'2')),frames=Number(argument('--frames',process.env.RASTER_FRAMES??'60'));
if(!Number.isInteger(trials)||trials<0||trials>10||!Number.isInteger(frames)||frames<1||frames>600||!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid --trials, --frames or --port');
let server,browser;const results=[];
const save=()=>writeFile(join(out,'baseline.json'),JSON.stringify({schemaVersion:1,commit,trials,frames,measuredAt:new Date().toISOString(),results},null,2));
async function newPage(){
 const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
 const page=await context.newPage();page.setDefaultTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 return {context,page,errors};
}
async function dynamic(file,round){
 const {context,page,errors}=await newPage();
 try{
  await page.goto(origin+base+'geotiff-viewer/');
  await page.waitForFunction(()=>{const s=window.geotiffDemo;if(!s||s.loading||!s.metadata)return false;const t=s.stats();return !t.activeReads&&!t.queuedReads&&!t.pendingFrames;});
  await page.locator('#remove').click();
  await page.locator('#file-input').setInputFiles(file.path);
  const data=await page.evaluate(async()=>{
   const s=window.geotiffDemo,records=[];const tick=()=>new Promise(r=>requestAnimationFrame(r));
   const diff=(a,b)=>Object.fromEntries(Object.keys(a??{}).filter(k=>typeof a[k]==='number').map(k=>[k,a[k]>=(b?.[k]??0)?a[k]-(b?.[k]??0):a[k]]));
   async function measure(name,action){
    const before=s.stats(),procBefore=s.processing(),start=performance.now();
    let done=false,failure=null,firstTileMs=null,metadataMs=null,stable=0,previous=start;const gaps=[];
    Promise.resolve().then(action).then(()=>done=true,e=>{failure=String(e);done=true;});
    while(performance.now()-start<120000){
     await tick();const at=performance.now(),t=s.stats();gaps.push(at-previous);previous=at;
     if(metadataMs===null&&!s.loading&&s.metadata)metadataMs=at-start;
     if(firstTileMs===null&&t.presentedTiles>before.presentedTiles)firstTileMs=at-start;
     if(done&&!s.loading&&!t.interacting&&!t.activeReads&&!t.queuedReads&&!t.pendingFrames)stable++;else stable=0;
     if(failure||s.error)throw Error(failure??s.error);
     if(stable>=5&&at-start>80){
      const proc=s.processing(),sorted=[...gaps].sort((a,b)=>a-b);
      const row={name,totalMs:at-start,firstTileMs,metadataMs,stats:diff(t,before),performance:diff(t.performance,before.performance),processing:diff(proc,procBefore),planning:t.planning,levels:proc?.levelActivity,frameP95Ms:sorted[Math.floor(sorted.length*.95)],frameMaxMs:sorted.at(-1),finalStats:t};
      records.push(row);console.log('RASTER_PHASE',name,Math.round(row.totalMs));return;
     }
    }
    throw Error('Raster did not settle: '+name+' '+JSON.stringify(s.stats()));
   }
   await measure('source-cold-full',()=>s.load(document.querySelector('#file-input').files[0]));
   const v=s.map.ctx.view,scale=Math.abs(v.getTransform().mx),center=v.getCenter();
   const metadata=s.metadata;
   await measure('zoom-4x',()=>v.jumpTo({center,scale:scale*4}));
   await measure('zoom-16x',()=>v.jumpTo({center,scale:scale*16}));
   await measure('zoom-128x',()=>v.jumpTo({center,scale:scale*128}));
   await measure('pan-native',()=>s.map.panBy([200,-100],{duration:0}));
   await measure('return-full-warm',()=>v.jumpTo({center,scale}));
   await measure('zoom-4x-warm',()=>v.jumpTo({center,scale:scale*4}));
   await measure('style-minmax',()=>s.map.ctx.raster.setStyle(s.currentId,{stretch:'minmax'}));
   await measure('resample-bilinear',()=>s.map.ctx.raster.setStyle(s.currentId,{resampling:'bilinear'}));
   await measure('return-full-bilinear',()=>v.jumpTo({center,scale}));
   return {metadata,scale,center,records,environment:{userAgent:navigator.userAgent,cores:navigator.hardwareConcurrency,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight]}};
  });
  const pixels=await page.evaluate(()=>Array.from(document.querySelectorAll('#map canvas')).map(c=>{
   const ctx=c.getContext('2d');if(!ctx)return {width:c.width,height:c.height,kind:'non-2d'};
   const p=ctx.getImageData(0,0,c.width,c.height).data;let alpha=0;for(let i=3;i<p.length;i+=4)if(p[i])alpha++;
   return {width:c.width,height:c.height,painted:alpha};
  }));
  await page.screenshot({path:join(out,`${file.key}-dynamic-${round}.png`)});
  await page.evaluate(()=>window.geotiffDemo.map.dispose());
  await page.waitForTimeout(100);const workersAfter=page.workers().length;
  if(errors.length||workersAfter||!pixels.some(p=>p.painted>1000))throw new Error('Dynamic raster validation failed: '+JSON.stringify({errors,workersAfter,pixels}));
  const result={kind:'canvas-dynamic',file:file.key,round,...data,pixels,errors,workersAfter};
  results.push(result);await save();console.log('DYNAMIC_DONE',file.key,round,JSON.stringify(data.records.map(r=>({name:r.name,ms:r.totalMs,first:r.firstTileMs,bytes:r.performance.fileReadBytes,level:r.planning?.layers?.map(l=>l.selectedLevel)}))));
 }finally{await context.close();}
}
async function fixed(file,gpu){
 const {context,page,errors}=await newPage();
 try{
  await page.goto(origin+base+'luma-benchmark/?gpu='+gpu+'&pointLod=off');
  await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
  await page.locator('#file-input').setInputFiles(file.path);
  const start=Date.now();await page.locator('#load-file').click();
  await page.waitForFunction(()=>['ready','error'].includes(window.lumaBenchmark.state));
  if(await page.evaluate(()=>window.lumaBenchmark.state)==='error')throw Error(await page.locator('#status').textContent());
  const loadMs=Date.now()-start,reports=[];
  for(const zoom of [1,16]){
   await page.evaluate(z=>window.lumaBenchmark.setView(z),zoom);
   const report=await page.evaluate(n=>window.lumaBenchmark.run(n),frames);
   if(!report)throw Error('Fixed raster benchmark did not complete');
   const pixels=await page.evaluate(()=>window.lumaBenchmark.capturePixels());
   if(pixels.paintedPixels<1000)throw new Error('Empty GPU raster output: '+file.key+' '+gpu);
   reports.push({zoom,report,pixels});
  }
  const timing=await page.evaluate(()=>window.lumaBenchmark.profileGpu(12));
  await page.screenshot({path:join(out,`${file.key}-fixed-${gpu}.png`)});
  await page.evaluate(()=>window.lumaBenchmark.dispose());await page.waitForTimeout(100);
  const disposed=await page.evaluate(()=>window.lumaBenchmark.gpuStats);
  if(errors.length||page.workers().length||disposed.liveBufferBytes||disposed.liveTextureBytes)throw new Error('Fixed raster lifecycle validation failed');
  results.push({kind:'fixed-texture',file:file.key,gpu,loadMs,reports,timing,errors,disposed,workersAfter:page.workers().length});
  await save();console.log('FIXED_DONE',file.key,gpu,loadMs,JSON.stringify(reports.map(r=>({zoom:r.zoom,result:r.report.results,uploads:r.report.warmNavigation}))));
 }finally{await context.close();}
}
try{
 const snapshots=[];for(const f of files){const s=await stat(f.path);snapshots.push({key:f.key,size:s.size,mtimeMs:s.mtimeMs});}
 await writeFile(join(out,'files-before.json'),JSON.stringify(snapshots,null,2));
 server=spawn('pnpm',['--filter','@mapseekai/emap-examples','exec','vite','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:process.cwd(),detached:true,stdio:'ignore'});
 let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Isolated preview failed');try{const r=await fetch(origin+base);if(r.ok){ready=true;break;}}catch{}await delay(200);}
 if(!ready)throw Error('Isolated preview timeout');
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const f of files)for(let r=0;r<trials;r++)await dynamic(f,r);
 for(const f of files)for(const gpu of ['webgl','webgpu'])await fixed(f,gpu);
 for(const [i,f] of files.entries()){const s=await stat(f.path);if(s.size!==snapshots[i].size||s.mtimeMs!==snapshots[i].mtimeMs)throw Error('Source file changed: '+f.key);}
 console.log('ALL_DONE',results.length);
}catch(error){console.error(error);await save();process.exitCode=1;}
finally{await browser?.close();if(server?.pid){try{process.kill(-server.pid,'SIGTERM');}catch{}}}

import { chromium } from '@playwright/test';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
const base=resolve(fileURLToPath(new URL('..',import.meta.url)));
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const directory=arg('--data-dir',process.env.EMAP_BENCHMARK_DATA_DIR);
if(!directory)throw Error('Provide --data-dir with the authorized real data directory');
const records=[];const files=arg('--files','big.geojson,lucc.geojson,building.geojson').split(',');
if(files.some(f=>!['big.geojson','lucc.geojson','building.geojson'].includes(f)))throw Error('Only the three authorized line/polygon files are supported');
const frames=Number(arg('--frames','30')), api=arg('--gpu','webgl');
if(!['webgl','webgpu'].includes(api)||!Number.isInteger(frames)||frames<1||frames>120)throw Error('Invalid backend or frame count');
const output=resolve(arg('--output','test-results/luma-lines'),'summary.json');
const port=Number(arg('--port','4194'));if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid loopback port');
const bounded=async(p,label)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),300000);})]);}finally{clearTimeout(timer);}};
const backup=arg('--baseline-dir',null),reference=arg('--reference-dir',null);
const variants=arg('--modes', [...(backup?['baseline']:[]),'auto','standard',...(reference&&api==='webgl'?['reference']:[])].join(',')).split(',');
if(variants.some(v=>!['baseline','auto','standard','reference','legacy'].includes(v)) || (variants.includes('baseline')&&!backup) || (variants.includes('reference')&&(!reference||api!=='webgl')))throw Error('Invalid modes or missing baseline/reference directory');
const referenceBundle=resolve(arg('--output','test-results/luma-lines'),'.reference.js');
await mkdir(resolve(arg('--output','test-results/luma-lines')),{recursive:true});
if(reference){
 const root=join(resolve(reference),'packages/deck.gl-geoarrow');
 const require=createRequire(import.meta.url);const esbuild=await import(pathToFileURL(createRequire(require.resolve('vite')).resolve('esbuild')).href);
 await esbuild.build({entryPoints:[join(base,'test/browser/fixtures/geoarrow-lines.mjs')],bundle:true,format:'iife',platform:'browser',target:'es2022',outfile:referenceBundle,
  alias:{'line-reference/core':join(root,'node_modules/@deck.gl/core/dist/index.js'),'line-reference/arrow':join(root,'node_modules/apache-arrow/Arrow.mjs'),'line-reference/path':join(root,'src/layers/path-layer.ts')},define:{'process.env.NODE_ENV':'"production"'}});
}
const digest=async file=>{const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');};
let dir=base+'/packages/examples/dist';const prefix='/mapseekai/emap/examples/';
const server=createServer(async(req,res)=>{try{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file;
 if(name==='/line-reference.js')file=referenceBundle;else{if(!name.startsWith(prefix)){res.writeHead(404).end();return;}name=name.slice(prefix.length);file=resolve(dir,name);if(!file.startsWith(dir+'/'))throw Error('path');if((await stat(file)).isDirectory())file=join(file,'index.html');}
 res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r);});
try{for(const file of files)for(const variant of variants){
 dir=variant==='baseline'?resolve(backup):base+'/packages/examples/dist';
 const record={file,variant,api,frames,strokeWidthCssPx:file==='big.geojson'?1.2:0.6,opacity:1,geometryMode:'full',sha256:await digest(join(directory,file)),trials:[],errors:[]};
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1.25});
  page.on('pageerror',e=>record.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')record.errors.push(m.text());});
  await page.goto('http://127.0.0.1:'+arg('--port','4194')+prefix+'luma-benchmark/?gpu='+api+'&pointLod=off&screenFilter=off');
  await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle',null,{timeout:60000});
  await page.locator('#file-input').setInputFiles(join(directory,file));await page.locator('#load-file').click();
  await page.waitForFunction(()=>['ready','error'].includes(window.lumaBenchmark.state),null,{timeout:180000});
  if(await page.evaluate(()=>window.lumaBenchmark.state)!=='ready')throw Error(await page.locator('#status').textContent());
      await page.evaluate(async()=>{if(window.lumaBenchmark.setPointLod)await window.lumaBenchmark.setPointLod(false,3);});
  record.source=await page.evaluate(()=>{
    const api=window.lumaBenchmark,d=api.scene.dataset,v=d.arcs.getVertexData(),ids=new Set();
    for(const l of d.layers)for(const sh of l.shapes??[])if(sh)for(const part of sh)for(const id of part)ids.add(id<0?~id:id);
    let segments=0;for(const id of ids)for(let j=v.ii[id]+1,end=v.ii[id]+v.nn[id];j<end;j++)if(v.xx[j]!==v.xx[j-1]||v.yy[j]!==v.yy[j-1])segments++;
    return {features:api.scene.featureCount,vertices:api.scene.vertexCount,segments,arcs:ids.size,preparation:api.preparation};
  });
  await page.evaluate(()=>window.lumaBenchmark.setPass('stroke'));
  if(variant==='legacy')await page.evaluate(()=>window.lumaBenchmark.setPathMode('legacy'));
  if(variant==='standard')await page.evaluate(()=>window.lumaBenchmark.setPathMode('reference'));
  if(variant==='auto')await page.evaluate(()=>window.lumaBenchmark.setPathMode('auto'));
  record.environment=await page.evaluate(()=>({userAgent:navigator.userAgent,dpr:devicePixelRatio,canvas:[document.querySelector('#webgl').width,document.querySelector('#webgl').height]}));
  record.rendererSha256=await digest(join(base,'src/integrations/luma/path-shaders.ts'));
  record.pathRendering=await page.evaluate(()=>window.lumaBenchmark.pathRendering??null);
  if(variant==='reference'){await page.addScriptTag({path:referenceBundle});record.reference=await page.evaluate(()=>window.lineReference.init(window.lumaBenchmark.scene.name==='big.geojson'?1.2:0.6));console.log('REFERENCE',JSON.stringify(record.reference));}
  for(const [view,scale]of [['fit',1],['far',Math.exp(-3.2)],['near',16]]){
   await page.evaluate(async(scale)=>{await window.lumaBenchmark.setView(scale);},scale);
   if(variant==='reference')await page.evaluate(()=>window.lineReference.show(true));
   const trial=await bounded(page.evaluate(async({variant,frames})=>{
    const api=window.lumaBenchmark,v=api.view,draw=()=>variant==='reference'?window.lineReference.draw(v):api.draw('luma');
    for(let i=0;i<6;i++){draw();await new Promise(requestAnimationFrame);}
    const before=variant==='reference'?window.lineReference.getStats():{...api.gpuStats};
    let prev=await new Promise(requestAnimationFrame);const gaps=[],cpu=[];
    for(let i=0;i<frames;i++){const st=performance.now();draw();cpu.push(performance.now()-st);const end=await new Promise(requestAnimationFrame);gaps.push(end-prev);prev=end;}
    return{gaps,cpu,fps:1000/(gaps.reduce((a,b)=>a+b,0)/gaps.length),geometry:{...api.lodStats},before,after:variant==='reference'?window.lineReference.getStats():{...api.gpuStats}};
   },{variant,frames}),'fixed-view sample');
   trial.view=view;record.trials.push(trial);
   if(variant!=='reference'&&trial.after.uploads!==trial.before.uploads)throw Error('Warm navigation uploaded new geometry');
   if(variant==='auto'&&trial.after.pathMsaaDraws<=trial.before.pathMsaaDraws)throw Error('Optimized path was not exercised');
   if(variant==='reference'&&(record.reference.points!==record.source.vertices||record.reference.segments!==record.source.segments||trial.after.draws<=trial.before.draws))throw Error('Reference missing full raw line geometry');
   if(variant!=='reference'&&view!=='near'&&trial.geometry.submittedSegments!==record.source.segments)throw Error('Missing original line segments');
   if(trial.geometry.omitted||trial.geometry.missingChunks)throw Error('Incomplete geometry');console.log('MEASURED',JSON.stringify({file,variant,api,view,fps:trial.fps,cpu:trial.cpu.reduce((a,b)=>a+b,0)/frames,segments:trial.geometry.submittedSegments}));
   record.pixels=await page.evaluate(variant=>variant==='reference'?window.lineReference.pixels():window.lumaBenchmark.capturePixels(),variant);
   if(!record.pixels.painted&&!record.pixels.paintedPixels)throw Error('Blank canvas: invalid benchmark');
   await page.screenshot({path:join(resolve(arg('--output','test-results/luma-lines')),`${file}-${variant}-${view}.png`)});
  }
  if(variant==='reference')await page.evaluate(()=>window.lineReference.dispose());
  await page.evaluate(()=>window.lumaBenchmark.dispose());await page.waitForTimeout(100);record.disposal=await page.evaluate(()=>window.lumaBenchmark.gpuStats);record.workers=page.workers().length;if(record.disposal.liveBufferBytes||record.workers)throw Error('Unreleased resources');record.sourceUnchanged=record.sha256===await digest(join(directory,file));if(!record.sourceUnchanged)throw Error('Source file changed');if(record.errors.length)throw Error('Browser/GPU errors captured');record.status='done';
 }catch(e){record.status='failed';record.failure=String(e);console.log('FAILED',record.failure,record.errors);}
 finally{await browser.close();}records.push(record);await writeFile(output,JSON.stringify({scope:'Full raw arcs, fixed-view stroke-only; 6 warmup frames; original width 1.2px for big, 0.6px for polygon boundaries; opacity=1. MSAA versus old analytic AA is NOT pixel equivalent. Same-MSAA standard isolates opaque coverage optimization. Near emap spatial culling retained; GeoArrow submits all arcs.',measuredAt:new Date().toISOString(),records},null,2));
}}finally{await new Promise(r=>server.close(r));}
if(records.some(r=>r.status!=='done'||r.errors.length))process.exitCode=1;

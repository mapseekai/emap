import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {stat,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const directory=arg('--data-dir',process.env.EMAP_BENCHMARK_DATA_DIR);
if(!directory)throw new Error('Provide --data-dir with the two authorized local TIFFs.');
const trials=Number(arg('--trials','2')),port=Number(arg('--port','4196')),dpr=Number(arg('--dpr','1'));
if(!Number.isInteger(trials)||trials<1||trials>10||!Number.isInteger(port)||port<1024||port>65535||![1,1.25,2].includes(dpr))throw new Error('Invalid benchmark configuration.');
const out=arg('--out','test-results/raster-dynamic-benchmark');await mkdir(out,{recursive:true});
const files=[['fus','SVN3-01_20250814_L2D0000203064_01_6112500050210001/SVN3-01_20250814_L2D0000203064_01_6112500050210001-FUS.tiff'],['gj','GJ_COG_zip.tif']];
if(process.argv.includes('--include-cdf'))for(const name of ['J50D001005','J50D001006','J50D002005','J50D002006','J50D002005_cog'])files.push([name,'cdf20250916042716/'+name+'.tif']);
const state={schemaVersion:1,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),trials,dpr,measuredAt:new Date().toISOString(),results:[]};
const save=()=>writeFile(join(out,'dynamic.json'),JSON.stringify(state,null,2));
let server,browser;
try{
 const paths=await Promise.all(files.map(async([key,name])=>({key,name,path:join(directory,name),before:await stat(join(directory,name))})));
 server=spawn('pnpm',['--filter','@mapseekai/emap-examples','exec','vite','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{detached:true,stdio:'ignore'});
 const origin=`http://127.0.0.1:${port}`,url=origin+'/mapseekai/emap/examples/luma-raster/';
 let ready=false;for(let n=0;n<100;n++){if(server.exitCode!==null)throw new Error('Isolated preview failed');try{if((await fetch(url)).ok){ready=true;break;}}catch{}await delay(200);}if(!ready)throw new Error('Preview timeout');
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const file of paths)for(let trial=0;trial<trials;trial++)for(const backend of (trial%2?['webgpu','webgl','canvas']:['canvas','webgl','webgpu'])){
  const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:dpr});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.setDefaultTimeout(120000);
  try{
   await page.goto(url+'?gpu='+backend);await page.waitForFunction(()=>window.lumaRaster?.state==='idle');
   const overview=await stat(file.path+'.ovr').then(()=>file.path+'.ovr',()=>null);await page.locator('#file-input').setInputFiles(overview?[file.path,overview]:file.path);
   const measured=await page.evaluate(async()=>{
    const app=window.lumaRaster,rows=[];
    async function measure(name,action){
      const before=app.stats(),start=performance.now();await action();const after=await app.settle();
      const a=after.native??after.canvas.performance,b=before.native??before.canvas?.performance??{};
      const readBytes=(a.fileReadBytes??0)-(b.fileReadBytes??0),uploads=(after.gpu?.textureUploads??0)-(before.gpu?.textureUploads??0);
      rows.push({name,stableMs:performance.now()-start,readBytes,uploads,before,after});
    }
    await measure('source-cold-full',()=>app.load(document.querySelector('#file-input').files[0],document.querySelector('#file-input').files[1]));
    const metadata=app.metadata;
    for(const zoom of [4,16,128])await measure('zoom-'+zoom+'x',()=>app.setView(zoom));
    await measure('pan-native',()=>app.setView(128,[200,-100]));
    await measure('return-full-warm',()=>app.setView(1));
    await measure('zoom-4x-warm',()=>app.setView(4));
    await measure('style-minmax',()=>app.setStyle({stretch:'minmax'}));
    await measure('resample-bilinear',()=>app.setStyle({resampling:'bilinear'}));
    await measure('opacity-bands',()=>app.setStyle({opacity:.7,bands:[2,1,0]}));
    await measure('return-full-bilinear',()=>app.setView(1));
    const pixels=await app.capture();let painted=0;for(let i=3;i<pixels.pixels.length;i+=4)if(pixels.pixels[i]>0)painted++;
    return {metadata,rows,painted,environment:{ua:navigator.userAgent,cores:navigator.hardwareConcurrency,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight]}};
   });
   if(measured.painted<1000||errors.length)throw new Error('Invalid raster image: '+JSON.stringify(errors));
   if(backend!=='canvas')for(const r of measured.rows.filter(r=>['style-minmax','resample-bilinear','opacity-bands'].includes(r.name)))if(r.readBytes!==0||r.uploads!==0)throw new Error('Style change rebuilt numerical textures.');
   await page.screenshot({path:join(out,`${file.key}-${backend}-${trial}.png`)});
   await page.evaluate(()=>window.lumaRaster.dispose());await page.waitForTimeout(80);
   const resources=await page.evaluate(()=>window.lumaRaster.stats());if(page.workers().length||resources.gpu?.liveTextureBytes)throw new Error('Resources not released');
   const row={file:file.key,backend,trial,...measured,resources,workersAfter:page.workers().length,errors};state.results.push(row);await save();
   console.log('RASTER_DYNAMIC',file.key,backend,trial,JSON.stringify(measured.rows.map(r=>({name:r.name,ms:Math.round(r.stableMs),level:r.after.level,bytes:r.readBytes,uploads:r.uploads}))));
  }finally{await context.close();}
 }
 for(const file of paths){const after=await stat(file.path);if(after.size!==file.before.size||after.mtimeMs!==file.before.mtimeMs)throw new Error('Original TIFF changed');}
 state.originalFilesSizeAndMtimeUnchanged=true;console.log('DYNAMIC_COMPLETE',state.results.length);await save();
}catch(e){state.error=String(e);await save();console.error(e);process.exitCode=1;}
finally{await browser?.close();if(server?.pid)try{process.kill(-server.pid,'SIGTERM');}catch{}}

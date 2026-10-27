import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {join} from 'node:path';
import {stat} from 'node:fs/promises';
const directory=process.env.EMAP_BENCHMARK_DATA_DIR;
const files=[['gj','GJ_COG_zip.tif'],['fus','SVN3-01_20250814_L2D0000203064_01_6112500050210001/SVN3-01_20250814_L2D0000203064_01_6112500050210001-FUS.tiff']];
let helper;
test.beforeAll(async()=>{helper=(await build({entryPoints:['test/browser/fixtures/luma-raster-numeric.ts'],bundle:true,platform:'browser',format:'esm',write:false})).outputFiles[0].text;});
for(const dpr of [1,1.25,2])test.describe(`DPR ${dpr}`,()=>{
 test.use({deviceScaleFactor:dpr});
for(const backend of ['webgl','webgpu'])for(const [key,name] of files)test(`${backend} ${key}: dynamic source levels, GPU numeric pixels, styles and lifecycle`,async({page},info)=>{
 test.skip(!directory,'Requires the complete authorized real TIFFs.');test.setTimeout(180000);
 const path=join(directory,name),before=await stat(path),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('/mapseekai/emap/examples/luma-raster/?parameters=open&gpu='+backend);
 await page.waitForFunction(()=>window.lumaRaster?.state==='idle');
 await page.addScriptTag({content:helper,type:'module'});await page.waitForFunction(()=>Boolean(window.checkNumericPixels&&window.checkStripWindows));
 await page.locator('#file-input').setInputFiles(path);await page.locator('#load').click();
 await page.waitForFunction(()=>['ready','error'].includes(window.lumaRaster.state));
 await page.evaluate(()=>window.lumaRaster.settle());
 const full=await page.evaluate(()=>({...window.lumaRaster.stats(),view:window.lumaRaster.map.ctx.view.getTransform()}));expect(full.sourceOpen).toBe(true);expect(full.level).toBeGreaterThan(0);expect(full.memory.sourceBlockCacheBudgetBytes).toBeLessThanOrEqual(32*1024**2);expect(full.memory.sourceBlockCacheBytes).toBeGreaterThan(0);
 const checks=[];
 for(const zoom of [1,16,128]){
  await page.evaluate(z=>window.lumaRaster.setView(z),zoom);await page.evaluate(()=>window.lumaRaster.settle());
  const status=await page.evaluate(()=>window.lumaRaster.stats());
  if(zoom===128)expect(status.level).toBe(0);
  for(const resampling of ['nearest','bilinear']){
   const style={resampling,stretch:'auto',opacity:1,bands:[0,1,2]};
   const rows=await page.evaluate(style=>window.checkNumericPixels(style),style);console.log('RASTER_NUMERIC',backend,key,zoom,resampling,JSON.stringify(rows));
   expect(rows.length).toBeGreaterThan(0);
   for(const r of rows){expect(r.large,JSON.stringify(r)).toBe(0);}
   checks.push({zoom,resampling,rows});
  }
 }
 const warm=await page.evaluate(()=>window.lumaRaster.stats());
 await page.locator('#stretch').selectOption('minmax');await page.locator('#red').selectOption('2');
 await page.evaluate(()=>window.lumaRaster.setStyle({opacity:.5,resampling:'bilinear'}));await page.evaluate(()=>window.lumaRaster.settle());
 const styled=await page.evaluate(()=>window.lumaRaster.stats());
 expect(styled.native.reads).toBe(warm.native.reads);expect(styled.gpu.textureUploads).toBe(warm.gpu.textureUploads);
 // Real gestures first settle their camera tween; separately interrupt raster loads with API jumps.
 const rect=await page.locator('#map').boundingBox();await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);
 await page.mouse.wheel(0,-240);await page.mouse.wheel(0,420);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.5+100,rect.y+rect.height*.5-40,{steps:5});await page.mouse.up();
 await page.evaluate(()=>window.lumaRaster.settle());
 await page.evaluate(async()=>{for(const z of [4,128,1]){window.lumaRaster.setView(z);await new Promise(r=>requestAnimationFrame(r));}});await page.evaluate(()=>window.lumaRaster.settle());
 const returned=await page.evaluate(()=>({...window.lumaRaster.stats(),view:window.lumaRaster.map.ctx.view.getTransform()}));expect(returned.level,JSON.stringify({full:{level:full.level,view:full.view,dimensions:full.dimensions},returned:{level:returned.level,view:returned.view,dimensions:returned.dimensions}})).toBe(full.level);
 let strip=null;if(key==='fus'&&backend==='webgl'){strip=await page.evaluate(()=>window.checkStripWindows());for(const r of strip){expect(r.mismatch).toBe(0);expect(r.directBytes).toBe(32*16*3*2);}}
 await page.screenshot({path:info.outputPath('dynamic-raster.png')});
 await page.evaluate(()=>window.lumaRaster.dispose());await expect.poll(()=>page.workers().length).toBe(0);
 const released=await page.evaluate(()=>window.lumaRaster.stats());expect(released.gpu.liveTextureBytes).toBe(0);expect(released.gpu.liveTextures).toBe(0);expect(released.gpu.packingScratchBytes).toBe(0);expect(released.memory.sourceBlockCacheBytes).toBe(0);
 const after=await stat(path);expect(after.size).toBe(before.size);expect(after.mtimeMs).toBe(before.mtimeMs);expect(errors).toEqual([]);
 await info.attach('dynamic-raster',{body:JSON.stringify({backend,key,full,checks,warm,styled,strip,released,errors},null,2),contentType:'application/json'});
});

});

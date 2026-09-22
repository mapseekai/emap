import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {join} from 'node:path';
import {stat} from 'node:fs/promises';
const directory=process.env.EMAP_BENCHMARK_DATA_DIR;
const names=['J50D001005.tif','J50D001006.tif','J50D002005.tif','J50D002006.tif','J50D002005_cog.tif'];
let helper;
test.beforeAll(async()=>{helper=(await build({entryPoints:['test/browser/fixtures/luma-raster-numeric.ts'],bundle:true,platform:'browser',format:'esm',write:false})).outputFiles[0].text;});
for(const dpr of [1,2])test.describe(`folder DPR ${dpr}`,()=>{
 test.use({deviceScaleFactor:dpr});
 for(const backend of ['webgl','webgpu'])for(const name of names)test(`${backend} ${name}: original UInt8 values and external OVR`,async({page},info)=>{
  test.skip(!directory,'Requires authorized cdf20250916042716 files.');test.setTimeout(180000);
  const folder=join(directory,'cdf20250916042716'),path=join(folder,name),before=await stat(path),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/mapseekai/emap/examples/luma-raster/?gpu='+backend);await page.waitForFunction(()=>window.lumaRaster?.state==='idle');
  await page.locator('#folder-input').setInputFiles(folder);
  const selections=await page.evaluate(()=>window.lumaRaster.selections.map(s=>({name:s.file.name,path:s.path,ovr:s.overview?.name})));
  expect(selections).toHaveLength(5);const index=selections.findIndex(s=>s.name===name);
  const cog=name.endsWith('_cog.tif');expect(Boolean(selections[index].ovr)).toBe(!cog);
  await page.locator('#file-select').selectOption(String(index));await page.locator('#load').click();
  await page.waitForFunction(()=>['ready','error'].includes(window.lumaRaster.state));await page.evaluate(()=>window.lumaRaster.settle());
  await page.addScriptTag({content:helper,type:'module'});await page.waitForFunction(()=>Boolean(window.checkNumericPixels));
  const metadata=await page.evaluate(()=>window.lumaRaster.metadata);expect(metadata.levels[0].bits).toEqual([8,8,8]);expect(metadata.levels.length).toBe(cog?7:9);
  if(name==='J50D001006.tif')expect(metadata.levels.some(l=>l.width===3390&&l.height===2328)).toBe(true);
  expect(Boolean(metadata.overviewFile)).toBe(!cog);
  const checks=[];
  for(const z of [1,16,128]){
   await page.evaluate(z=>window.lumaRaster.setView(z),z);await page.evaluate(()=>window.lumaRaster.settle());
   if(z===128)expect((await page.evaluate(()=>window.lumaRaster.stats())).level).toBe(0);
   for(const resampling of ['nearest','bilinear']){
    const rows=await page.evaluate(s=>window.checkNumericPixels(s),{resampling,stretch:'auto',opacity:1,bands:[0,1,2]});
    expect(rows.length).toBeGreaterThan(0);for(const r of rows)expect(r.large,JSON.stringify(r)).toBe(0);checks.push({z,resampling,rows});
   }
  }
  const beforeStyle=await page.evaluate(()=>window.lumaRaster.stats());
  await page.evaluate(()=>window.lumaRaster.setStyle({opacity:.5,bands:[2,1,0],resampling:'bilinear'}));await page.evaluate(()=>window.lumaRaster.settle());
  const afterStyle=await page.evaluate(()=>window.lumaRaster.stats());expect(afterStyle.native.reads).toBe(beforeStyle.native.reads);expect(afterStyle.gpu.textureUploads).toBe(beforeStyle.gpu.textureUploads);expect(afterStyle.gpu.packMs).toBe(0);
  await page.screenshot({path:info.outputPath('folder-raster.png')});await page.evaluate(()=>window.lumaRaster.dispose());await expect.poll(()=>page.workers().length).toBe(0);
  expect((await page.evaluate(()=>window.lumaRaster.stats())).gpu.liveTextureBytes).toBe(0);
  const after=await stat(path);expect(after.size).toBe(before.size);expect(after.mtimeMs).toBe(before.mtimeMs);expect(errors).toEqual([]);
  await info.attach('folder-raster',{body:JSON.stringify({name,backend,dpr,metadata,checks,afterStyle,errors}),contentType:'application/json'});
 });
});
test('Canvas folder selection pairs all four external overviews and loads all five files',async({page})=>{
 test.skip(!directory,'Requires authorized real folder.');test.setTimeout(180000);
 await page.goto('/mapseekai/emap/examples/luma-raster/?gpu=canvas');await page.waitForFunction(()=>window.lumaRaster?.state==='idle');
 await page.locator('#folder-input').setInputFiles(join(directory,'cdf20250916042716'));
 for(let i=0;i<5;i++){
  await page.locator('#file-select').selectOption(String(i));await page.locator('#load').click();await page.waitForFunction(()=>['ready','error'].includes(window.lumaRaster.state));
  const s=await page.evaluate(()=>window.lumaRaster.settle());expect(s.phase).toBe('ready');expect(s.canvas.presentedTiles).toBeGreaterThan(0);expect(s.errors).toEqual([]);
 }
 await page.evaluate(()=>window.lumaRaster.dispose());await expect.poll(()=>page.workers().length).toBe(0);
});

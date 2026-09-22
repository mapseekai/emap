import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {stat} from 'node:fs/promises';
const directory=process.env.EMAP_BENCHMARK_DATA_DIR;
const files=[['gj','GJ_COG_zip.tif'],['fus','SVN3-01_20250814_L2D0000203064_01_6112500050210001/SVN3-01_20250814_L2D0000203064_01_6112500050210001-FUS.tiff']];
for(const dpr of [1,2])test.describe(`progress DPR ${dpr}`,()=>{
 test.use({deviceScaleFactor:dpr});
 for(const backend of ['webgl','webgpu'])for(const [key,name] of files)test(`${backend} ${key}: publishes real detail before a delayed batch without double alpha`,async({page},info)=>{
  test.skip(!directory,'Requires the authorized real TIFFs; generated data is not a performance substitute.');test.setTimeout(120000);
  const path=join(directory,name),before=await stat(path),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/mapseekai/emap/examples/luma-raster/?gpu='+backend);
  await page.waitForFunction(()=>window.lumaRaster?.state==='idle');
  await page.locator('#file-input').setInputFiles(path);await page.locator('#load').click();
  await page.waitForFunction(()=>['ready','error'].includes(window.lumaRaster.state));await page.evaluate(()=>window.lumaRaster.settle());
  await page.evaluate(async()=>{
    const app=window.lumaRaster;app.setStyle({opacity:.5,resampling:'bilinear'});await app.settle();
    const method=app.source.readTexture?'readTexture':'readWindow',original=app.source[method].bind(app.source);
    const gate=window.rasterGate={open:false,waiting:[],baseline:app.stats().gpu.textureUploads};
    app.source[method]=async(request,signal)=>{
      const result=await original(request,signal);
      if(!gate.open)await new Promise((resolve,reject)=>{
        const abort=()=>reject(signal.reason);signal?.addEventListener('abort',abort,{once:true});
        gate.waiting.push(()=>{signal?.removeEventListener('abort',abort);resolve();});
        if(signal?.aborted)abort();
      });
      signal?.throwIfAborted();return result;
    };
    app.setView(4);
  });
  await page.waitForFunction(()=>window.rasterGate.waiting.length>=2);
  await page.evaluate(async()=>{window.rasterGate.old=await window.lumaRaster.capture();});
  // A publishable core requires its sampled halo dependencies. Release only
  // enough batches for one complete region; keep the remaining reads blocked.
  for(let n=0;n<8;n++){
    if(await page.evaluate(()=>window.lumaRaster.native.entries.length>0))break;
    await page.waitForFunction(()=>window.rasterGate.waiting.length>0);
    const uploads=await page.evaluate(()=>window.lumaRaster.stats().gpu.textureUploads);
    await page.evaluate(()=>window.rasterGate.waiting.shift()());
    await page.waitForFunction(previous=>window.lumaRaster.stats().gpu.textureUploads>previous && window.lumaRaster.stats().native.queuedBytes===0,uploads);
  }
  const progress=await page.evaluate(async()=>{
    const app=window.lumaRaster,gate=window.rasterGate;
    gate.partial=await app.capture();
    const v=app.map.ctx.view.getTransform(),d=app.stats().dimensions;
    gate.regions=app.native.entries.filter(e=>e.tile.level.id===app.stats().level).map(e=>{
      const b=e.tile.bounds,a=v.project(b[0],b[3]),z=v.project(b[2],b[1]);
      return [Math.max(0,Math.ceil(a[0]*gate.partial.width/d.width)+2),Math.max(0,Math.ceil(a[1]*gate.partial.height/d.height)+2),
        Math.min(gate.partial.width,Math.floor(z[0]*gate.partial.width/d.width)-2),Math.min(gate.partial.height,Math.floor(z[1]*gate.partial.height/d.height)-2)];
    });
    return {pending:app.stats().native.pending,visible:app.stats().native.visible,regions:gate.regions,stats:app.stats()};
  });
  expect(progress.pending).toBeGreaterThan(0);expect(progress.regions.length).toBeGreaterThan(0);
  await page.evaluate(()=>{const gate=window.rasterGate;gate.open=true;for(const resume of gate.waiting.splice(0))resume();});
  await page.evaluate(()=>window.lumaRaster.settle());
  const pixels=await page.evaluate(async()=>{
    const gate=window.rasterGate,final=await window.lumaRaster.capture();let tested=0,changed=0,mismatched=0,maxAlpha=0,cleared=0;
    for(const [x0,y0,x1,y1] of gate.regions)for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){
      const i=(y*final.width+x)*4;tested++;
      maxAlpha=Math.max(maxAlpha,gate.partial.pixels[i+3]);
      if(final.pixels[i+3]===0){cleared++;if(gate.partial.pixels[i+3])mismatched++;}
      let change=0,error=0;for(let k=0;k<4;k++){change=Math.max(change,Math.abs(gate.old.pixels[i+k]-gate.partial.pixels[i+k]));error=Math.max(error,Math.abs(final.pixels[i+k]-gate.partial.pixels[i+k]));}
      if(change>3)changed++;if(error>1)mismatched++;
    }
    gate.old=null;gate.partial=null;return {tested,changed,mismatched,maxAlpha,cleared};
  });
  expect(pixels.tested).toBeGreaterThan(1000);expect(pixels.changed).toBeGreaterThan(100);
  expect(pixels.mismatched).toBe(0);expect(pixels.maxAlpha).toBeLessThanOrEqual(129);
  // Navigation is still interactive; callbacks must not allow a camera end to
  // prematurely enable uploads while a pointer drag is held.
  const box=await page.locator('#map').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();await page.mouse.move(box.x+box.width/2+120,box.y+box.height/2+40,{steps:8});
  const during=await page.evaluate(()=>window.lumaRaster.stats());await page.waitForTimeout(100);
  const held=await page.evaluate(()=>window.lumaRaster.stats());expect(held.native.reads).toBe(during.native.reads);expect(held.gpu.textureUploads).toBe(during.gpu.textureUploads);
  await page.mouse.up();await page.evaluate(()=>window.lumaRaster.settle());
  await page.evaluate(()=>window.lumaRaster.dispose());await expect.poll(()=>page.workers().length).toBe(0);
  const released=await page.evaluate(()=>window.lumaRaster.stats());expect(released.gpu.liveTextureBytes).toBe(0);
  const after=await stat(path);expect(after.size).toBe(before.size);expect(after.mtimeMs).toBe(before.mtimeMs);expect(errors).toEqual([]);
  console.log('RASTER_PROGRESS',JSON.stringify({backend,key,dpr,pixels,pending:progress.pending}));
  await info.attach('progressive-real-raster',{body:JSON.stringify({backend,key,dpr,progress,pixels,released,errors},null,2),contentType:'application/json'});
 });
});

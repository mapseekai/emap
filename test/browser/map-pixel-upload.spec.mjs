import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
for (const renderer of ['webgl2', 'webgpu']) test(`${renderer}: direct RGBA and alpha compatibility preserve exact Canvas pixels with odd row widths`, async ({page}, info) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/mapseekai/emap/examples/geotiff-viewer/?renderer='+renderer);
  await expect(page.locator('#levels')).toHaveText('4');
  await expect.poll(()=>page.evaluate(()=>{const s=geotiffDemo.stats();return s.activeReads+s.queuedReads+s.pendingFrames;})).toBe(0);
  await page.evaluate(()=>{
    window.pixelMap=geotiffDemo.map;window.pixelErrors=[];pixelMap.on('error',e=>pixelErrors.push(String(e.error)));
    pixelMap.ctx.raster.remove(geotiffDemo.currentId);
    pixelMap.setExtent(new emap.Bounds(0,0,8,6));pixelMap.render();
  });
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const result=await page.evaluate(async()=>{
    const g=pixelMap.ctx.render._painter.gpu,raster=pixelMap.ctx.raster;
    raster.rawPixels=true;
    const initialPixels=g.stats.pixelTextureUploads;
    const comparisons=[],representations=[];
    for(const continuous of [false,true]){
      const rgba=new Uint8ClampedArray(5*3*4);
      for(let y=0;y<3;y++)for(let x=0;x<5;x++)rgba.set([40+x*35,20+y*75,210-x*20,(x===2&&y===1)?0:(continuous&&x===1?128:255)],(y*5+x)*4);
      const reference=new ImageData(rgba,5,3),canvas=document.createElement('canvas');canvas.width=5;canvas.height=3;
      canvas.getContext('2d').putImageData(reference,0,0);
      const image=raster.prepareRasterImage(rgba,5,3);
      representations.push({continuous,pixels:'data' in image});
      async function capture(pixels,smoothing,opacity){
        g.begin(pixelMap.getTransform());g.drawImage(pixels?image:canvas,[1,1,7,5],opacity,smoothing,[1.3,1.1,6.7,4.9],true);g.end();
        const bitmap=await createImageBitmap(g.canvas),copy=document.createElement('canvas');copy.width=bitmap.width;copy.height=bitmap.height;
        const ctx=copy.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
        return ctx.getImageData(0,0,copy.width,copy.height).data;
      }
      for(const smoothing of [false,true])for(const opacity of [1,.55]){
        const a=await capture(false,smoothing,opacity),b=await capture(true,smoothing,opacity);
        let max=0,alphaMax=0,changed=0;
        for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(i%4===3)alphaMax=Math.max(alphaMax,d);else max=Math.max(max,d);if(d)changed++;}
        comparisons.push({continuous,smoothing,opacity,max,alphaMax,changed});
      }
      const warm=g.stats.textureUploads;await capture(true,false,1);
      if(g.stats.textureUploads!==warm)throw new Error('Immutable pixels were reuploaded');
      g.forgetImage(image);g.forgetImage(canvas);
      canvas.width=canvas.height=0;if(!('data' in image))image.width=image.height=0;
    }
    // CPU representation preparation only, fixed input/iteration count; this is
    // neither an FPS claim nor a GPU upload benchmark. Release each Canvas immediately.
    const bytes=new Uint8ClampedArray(256*256*4);for(let i=0;i<bytes.length;i+=4)bytes.set([180,70,30,255],i);
    const preparation=[];
    for(const direct of [false,true,true,false]){
      raster.rawPixels=direct;const start=performance.now();
      for(let i=0;i<100;i++){const image=raster.prepareRasterImage(bytes,256,256,true);if(!('data' in image))image.width=image.height=0;}
      preparation.push({direct,preclassified:true,iterations:100,totalMs:performance.now()-start});
    }
    const pixelUploads=g.stats.pixelTextureUploads-initialPixels;
    const uploadBurst=[];
    for(const direct of [false,true,true,false]){
      raster.rawPixels=direct;await g.waitForIdle();const start=performance.now();
      for(let i=0;i<60;i++){
        const image=raster.prepareRasterImage(bytes,256,256,true);
        g.begin(pixelMap.getTransform());g.drawImage(image,[1,1,7,5],1,false,undefined,true);g.end();
        g.forgetImage(image);if(!('data' in image))image.width=image.height=0;
      }
      const cpuMs=performance.now()-start;await g.waitForIdle();
      uploadBurst.push({direct,preclassified:true,iterations:60,cpuMs,completedMs:performance.now()-start});
    }
    return {comparisons,representations,preparation,uploadBurst,pixelUploads,pipelines:g.memoryStats.pipelines};
  });
  for(const c of result.comparisons){expect(c.alphaMax,JSON.stringify(c)).toBe(0);expect(c.max,JSON.stringify(c)).toBe(0);}
  expect(result.representations).toEqual([{continuous:false,pixels:true},{continuous:true,pixels:false}]);
  expect(result.pixelUploads).toBe(1);expect(result.pipelines).toBe(13);
  await page.screenshot({path:info.outputPath('pixel-upload.png')});
  const released=await page.evaluate(async()=>{const g=pixelMap.ctx.render._painter.gpu;await pixelMap.dispose();return g.memoryStats;});
  expect(released.nominalKnownGpuBytes).toBe(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>pixelErrors)).toEqual([]);
  await info.attach('pixel-upload',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  console.log('PIXEL_UPLOAD',renderer,JSON.stringify(result));
});


const realDirectory=process.env.EMAP_BENCHMARK_DATA_DIR;
for(const renderer of ['webgl2','webgpu'])for(const name of ['GJ_COG_zip.tif','SVN3-01_20250814_L2D0000203064_01_6112500050210001/SVN3-01_20250814_L2D0000203064_01_6112500050210001-FUS.tiff'])
 test(`${renderer}: formal direct-pixel cache matches Canvas replay for ${name}`,async({page},info)=>{
  test.skip(!realDirectory,'Requires authorized original TIFF files.');test.setTimeout(180000);
  const file=join(realDirectory,name),before=await stat(file),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/mapseekai/emap/examples/geotiff-viewer/?renderer='+renderer);await expect(page.locator('#levels')).toHaveText('4');
  await page.locator('#file-input').setInputFiles(file);
  try{await stat(file+'.ovr');await page.locator('#overview-input').setInputFiles(file+'.ovr');}catch{}
  await page.locator('#load').click();
  await expect.poll(()=>page.evaluate(()=>geotiffDemo.loading),{timeout:120000}).toBe(false);
  expect(await page.evaluate(()=>geotiffDemo.error)).toBeNull();
  // Metadata loading can finish before the first viewport planning RAF. Wait for
  // this source's actual display tiles, not an idle counter that is still zero.
  await page.evaluate(()=>geotiffDemo.map.render());
  await expect.poll(()=>page.evaluate(()=>[...geotiffDemo.map.ctx.raster.cache.values()].filter(t=>t.layer===geotiffDemo.currentId&&t.image).length),{timeout:120000}).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>{const s=geotiffDemo.stats();return s.activeReads+s.queuedReads+s.pendingFrames;}),{timeout:120000}).toBe(0);
  const result=await page.evaluate(async()=>{
   const map=geotiffDemo.map,g=map.ctx.render._painter.gpu,r=map.ctx.raster;
   const before={gpu:{...g.stats},raster:r.getStats()};
   const originals=new Map(),canvases=new Map();
   for(const [key,tile] of r.cache){if(tile.image&&'data' in tile.image){originals.set(key,tile.image);const c=document.createElement('canvas');c.width=tile.image.width;c.height=tile.image.height;c.getContext('2d').putImageData(tile.image,0,0);canvases.set(key,c);}}
   async function capture(){map.render();const bitmap=await createImageBitmap(map.ctx.render._canvas),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,c.width,c.height).data;}
   const reference=await capture();let painted=0;for(let i=3;i<reference.length;i+=4)if(reference[i])painted++;
   for(const [key,canvas] of canvases)r.cache.get(key).image=canvas;
   const control=await capture();let changed=0;for(let i=0;i<reference.length;i++)if(reference[i]!==control[i])changed++;
   for(const [key,image] of originals)r.cache.get(key).image=image;
   map.render();for(const canvas of canvases.values())canvas.width=canvas.height=0;
   return {filename:geotiffDemo.metadata.filename,rawTiles:originals.size,painted,changed,before,after:{gpu:{...g.stats},raster:r.getStats()}};
  });
  expect(result.filename).toBe(name.split('/').at(-1));expect(result.rawTiles).toBeGreaterThan(0);expect(result.painted).toBeGreaterThan(1000);expect(result.changed).toBe(0);expect(result.before.raster.performance.pixelPreclassifiedTiles).toBeGreaterThan(0);
  await page.screenshot({path:info.outputPath('formal-real-pixels.png')});
  const memory=await page.evaluate(async()=>{const g=geotiffDemo.map.ctx.render._painter.gpu;await geotiffDemo.map.dispose();return g.memoryStats;});
  expect(memory.nominalKnownGpuBytes).toBe(0);await expect.poll(()=>page.workers().length).toBe(0);expect(errors).toEqual([]);
  const after=await stat(file);expect(after.size).toBe(before.size);expect(after.mtimeMs).toBe(before.mtimeMs);
  await info.attach('formal-real-pixels',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 });

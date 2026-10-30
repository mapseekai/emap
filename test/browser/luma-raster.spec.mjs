import {test, expect} from '@playwright/test';
import {join} from 'node:path';
import {stat} from 'node:fs/promises';
const directory=process.env.EMAP_BENCHMARK_DATA_DIR;
const files=[
 'SVN3-01_20250814_L2D0000203064_01_6112500050210001/SVN3-01_20250814_L2D0000203064_01_6112500050210001-FUS.tiff',
 'GJ_COG_zip.tif',
];
for(const backend of ['webgl','webgpu'])for(const filename of files){
 test(`${backend} ${filename}: real TIFF tiles match the Canvas coverage`,async({page},info)=>{
  test.skip(!directory,'Requires the two complete authorized local TIFFs. No generated substitute.');
  test.setTimeout(180000);
  const path=join(directory,filename),before=await stat(path),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open&gpu='+backend+'&pointLod=off');
  await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
  await page.locator('#file-input').setInputFiles(path);await page.locator('#load-file').click();
  await page.waitForFunction(()=>['ready','error'].includes(window.lumaBenchmark.state));
  expect(await page.locator('#status').getAttribute('data-state'),await page.locator('#status').textContent()).toBe('ready');
  const views=[];
  for(const [zoom,pan] of [[1,[0,0]],[2,[73,-41]],[16,[-35,19]]]){
   await page.evaluate(async({zoom,pan})=>{await window.lumaBenchmark.setView(zoom,pan);}, {zoom,pan});
   const coverage=await page.evaluate(async()=>{
    const app=window.lumaBenchmark;
    async function capture(backend){
     app.draw(backend);const canvas=document.querySelector(backend==='luma'?'#webgl':'#canvas2d');
     const bitmap=await createImageBitmap(canvas),copy=document.createElement('canvas');
     copy.width=bitmap.width;copy.height=bitmap.height;const ctx=copy.getContext('2d');
     ctx.drawImage(bitmap,0,0);bitmap.close();return {pixels:ctx.getImageData(0,0,copy.width,copy.height).data,width:copy.width,height:copy.height};
    }
    const ref=await capture('canvas'),gpu=await capture('luma');let reference=0,painted=0,missing=0,extra=0;
    const neighbor=(p,x,y)=>{
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<ref.width&&yy<ref.height&&p[(yy*ref.width+xx)*4+3]>16)return true;
     }return false;
    };
    for(let y=0;y<ref.height;y++)for(let x=0;x<ref.width;x++){
     const i=(y*ref.width+x)*4+3,a=ref.pixels[i]>16,b=gpu.pixels[i]>16;
     if(a)reference++;if(b)painted++;
     if(a&&!b&&!neighbor(gpu.pixels,x,y))missing++;
     if(b&&!a&&!neighbor(ref.pixels,x,y))extra++;
    }
    return {width:ref.width,height:ref.height,reference,painted,missing,extra,tiles:app.scene.tiles.length};
   });
   expect(coverage.reference).toBeGreaterThan(1000);expect(coverage.painted).toBeGreaterThan(1000);
   expect(coverage.missing/coverage.reference,JSON.stringify(coverage)).toBeLessThan(0.002);
   expect(coverage.extra/coverage.painted,JSON.stringify(coverage)).toBeLessThan(0.002);
   views.push({zoom,pan,...coverage});
  }
  await page.screenshot({path:info.outputPath('raster.png')});
  await page.evaluate(()=>window.lumaBenchmark.dispose());
  await expect.poll(()=>page.workers().length).toBe(0);
  const resources=await page.evaluate(()=>window.lumaBenchmark.gpuStats);
  expect(resources.liveBufferBytes).toBe(0);expect(resources.liveTextureBytes).toBe(0);
  const after=await stat(path);expect(after.size).toBe(before.size);expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(errors).toEqual([]);
  const result={backend,filename,views,resources,errors};
  console.log('RASTER_COVERAGE',JSON.stringify(result));
  await info.attach('real-raster-coverage',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 });
}

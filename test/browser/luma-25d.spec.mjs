import {test,expect} from '@playwright/test';
import {join} from 'node:path';

async function ready(page){
  await expect(page.locator('#status')).toHaveAttribute('data-state','ready');
}
async function pixels(page,kind,opacity=1,clip){
  return page.evaluate(async({kind,opacity,clip})=>{
    const app=window.luma25d;
    if(kind==='image')app.drawCalibrationImage(clip);else app.draw();
    const canvas=document.querySelector(kind==='image'?'#webgl':'.numeric-raster');
    const bitmap=await createImageBitmap(canvas),copy=document.createElement('canvas');
    copy.width=bitmap.width;copy.height=bitmap.height;const ctx=copy.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    const data=ctx.getImageData(0,0,copy.width,copy.height).data;
    const rx=copy.width/app.snapshot.width,ry=copy.height/app.snapshot.height;
    let checked=0,missing=0,wrong=0,alphaWrong=0,outside=0;
    for(let y=4;y<copy.height;y+=5)for(let x=4;x<copy.width;x+=5){
      const [gx,gy]=app.unproject((x+.5)/rx,(y+.5)/ry);
      const u=(gx-13000000)/10000*1024,v=(4010000-gy)/10000*1024;
      const i=(y*copy.width+x)*4,alpha=data[i+3];
      if(u<2||u>1022||v<2||v>1022)continue;
      if(clip && (gx<clip[0]-20||gy<clip[1]-20||gx>clip[2]+20||gy>clip[3]+20)){
        if(alpha>1)outside++;continue;
      }
      if(clip && (gx<clip[0]+20||gy<clip[1]+20||gx>clip[2]-20||gy>clip[3]-20))continue;
      let expected;
      if(kind==='image'){
        if(Math.abs(u-512)<3||Math.abs(v-512)<3)continue;
        expected=v<512?(u<512?[240,64,64]:[64,192,96]):(u<512?[64,128,224]:[224,176,64]);
      }else{
        if(u%64<3||u%64>61||v%64<3||v%64>61)continue;
        const cx=Math.floor(u/64),cy=Math.floor(v/64);
        if(cx===7&&cy===7){if(alpha>1)alphaWrong++;continue;}
        expected=(cx+cy)%2?[165,205,222]:[222,237,239];
      }
      checked++;if(alpha<1)missing++;
      if(expected.some((n,j)=>Math.abs(data[i+j]-n)>3))wrong++;
      if(Math.abs(alpha-Math.round(255*opacity))>1)alphaWrong++;
    }
    return {checked,missing,wrong,alphaWrong,outside};
  },{kind,opacity,clip});
}
for(const backend of ['webgl','webgpu']){
  test(`${backend}: perspective vectors, integer raster, UV, anchors and cleanup`,async({page},info)=>{
    test.setTimeout(150000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('/mapseekai/emap/examples/luma-25d/?gpu='+backend);
    await ready(page);
    const initial=await page.evaluate(()=>window.luma25d.snapshot);
    expect(initial.rasterGpu.liveTextures).toBeGreaterThan(0);
    const views=[];
    for(const [pitch,bearing] of [[0,0],[50,-25],[60,90],[60,179]]){
      await page.evaluate(({pitch,bearing})=>{window.luma25d.setPose({pitch,bearing});window.luma25d.fit();}, {pitch,bearing});
      await page.waitForFunction(()=>window.luma25d.snapshot.pitch===Number(document.querySelector('#pitch').value));
      await page.waitForTimeout(120);await ready(page);
      const numeric=await pixels(page,'numeric');
      expect(numeric.checked,JSON.stringify(numeric)).toBeGreaterThan(300);
      expect(numeric.missing,JSON.stringify(numeric)).toBe(0);
      expect(numeric.wrong,JSON.stringify(numeric)).toBe(0);
      expect(numeric.alphaWrong,JSON.stringify(numeric)).toBe(0);
      const image=await pixels(page,'image');
      expect(image.checked).toBeGreaterThan(300);
      expect(image.missing,JSON.stringify(image)).toBe(0);expect(image.wrong,JSON.stringify(image)).toBe(0);
      const markers=await page.evaluate(async()=>{
        const app=window.luma25d;app.draw();const bitmap=await createImageBitmap(document.querySelector('#webgl'));
        const copy=document.createElement('canvas');copy.width=bitmap.width;copy.height=bitmap.height;
        const ctx=copy.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
        const rx=copy.width/app.snapshot.width,ry=copy.height/app.snapshot.height;
        return Array.from({length:9},(_,i)=>{
          const p=app.project(13001000+(i%3)*3500,4001000+Math.floor(i/3)*3500);
          return [...ctx.getImageData(Math.floor(p[0]*rx),Math.floor(p[1]*ry),1,1).data];
        });
      });
      for(const p of markers){expect(p[0]).toBeCloseTo(37,0);expect(p[1]).toBeCloseTo(99,0);expect(p[2]).toBeCloseTo(235,0);expect(p[3]).toBe(255);}
      views.push({pitch,bearing,numeric,image,markers});
    }
    expect((await page.evaluate(()=>window.luma25d.snapshot)).rasterGpu.textureUploads).toBe(initial.rasterGpu.textureUploads);
    const crop=await pixels(page,'image',1,[13002000,4002000,13008000,4008000]);
    expect(crop.outside).toBe(0);expect(crop.wrong).toBe(0);expect(crop.missing).toBe(0);
    await page.evaluate(()=>window.luma25d.setOpacity(.5));await page.waitForTimeout(80);
    const alpha=await pixels(page,'numeric',.5);expect(alpha.alphaWrong,JSON.stringify(alpha)).toBe(0);
    await page.evaluate(()=>{window.luma25d.setOpacity(1);window.luma25d.setPose({pitch:50,bearing:-25});window.luma25d.fit();});
    await page.waitForTimeout(120);await ready(page);
    const box=await page.locator('#stage').boundingBox();
    const x=Math.round(box.width*.63),y=Math.round(box.height*.61);
    await page.mouse.click(box.x+x,box.y+y);
    const anchor=await page.evaluate(({x,y})=>window.luma25d.unproject(x,y),{x,y});
    await page.mouse.wheel(0,-180);await page.waitForTimeout(200);
    const projected=await page.evaluate(p=>window.luma25d.project(...p),anchor);
    expect(projected[0]).toBeCloseTo(x,3);expect(projected[1]).toBeCloseTo(y,3);
    const before=await page.evaluate(()=>window.luma25d.snapshot);
    await page.mouse.move(box.x+x,box.y+y);await page.mouse.down({button:'right'});
    await page.mouse.move(box.x+x+80,box.y+y-25,{steps:6});await page.mouse.up({button:'right'});
    const after=await page.evaluate(()=>window.luma25d.snapshot);
    expect(after.bearing).not.toBe(before.bearing);expect(after.pitch).toBeGreaterThanOrEqual(before.pitch);
    await page.waitForTimeout(150);await ready(page);
    await page.screenshot({path:info.outputPath('perspective.png')});
    await page.locator('#flat').click();await page.waitForTimeout(100);await ready(page);
    expect(await page.evaluate(()=>window.luma25d.snapshot.rasterGpu.liveRegionUniforms)).toBe(0);
    await page.evaluate(()=>window.luma25d.dispose());
    const resources=await page.evaluate(()=>window.luma25d.snapshot);
    expect(resources.gpu.liveBufferBytes).toBe(0);expect(resources.gpu.liveTextureBytes).toBe(0);
    expect(resources.rasterGpu.liveTextureBytes).toBe(0);expect(resources.rasterGpu.liveRegionUniforms).toBe(0);
    expect(errors).toEqual([]);expect(resources.errors).toEqual([]);
    await info.attach('camera-regression',{body:JSON.stringify({backend,views,crop,alpha,resources},null,2),contentType:'application/json'});
  });
  test(`${backend}: tilted real GeoTIFF keeps the bounded native reader`,async({page},info)=>{
    test.skip(!process.env.EMAP_BENCHMARK_DATA_DIR,'Requires an authorized real TIFF; calibration does not replace this test.');
    test.setTimeout(180000);
    await page.goto('/mapseekai/emap/examples/luma-25d/?gpu='+backend);await ready(page);
    await page.locator('#raster-file').setInputFiles(join(process.env.EMAP_BENCHMARK_DATA_DIR,'GJ_COG_zip.tif'));
    await page.locator('#load-raster').click();await ready(page);
    await page.evaluate(()=>{window.luma25d.setPose({pitch:60,bearing:65});window.luma25d.zoom(3);});
    await page.waitForTimeout(200);await ready(page);
    const state=await page.evaluate(()=>window.luma25d.snapshot);
    expect(state.source).toBe('GJ_COG_zip.tif');expect(state.rasterGpu.liveTextures).toBeGreaterThan(0);
    expect(state.errors).toEqual([]);
    await page.screenshot({path:info.outputPath('real-tiff-25d.png')});
    await page.evaluate(()=>window.luma25d.dispose());
  });
}

async function optimizedFrameReady(page) {
  await page.waitForFunction(() => {
    const s = window.luma25d?.snapshot;
    return s?.phase === 'error' || (s?.phase === 'ready' && s.navigation.ready &&
      !s.navigation.pending && !s.pointLod.pending && !s.screen.pending &&
      !s.vector.pending && !s.vector.missingChunks);
  }, null, { timeout: 180000 });
  expect(await page.evaluate(() => window.luma25d.snapshot.errors)).toEqual([]);
}
for (const gpu of ['webgl', 'webgpu']) for (const file of ['points.geojson', 'lucc.geojson']) {
  test(`${gpu} ${file}: perspective retains vector optimization and snapshot navigation`, async ({page}, info) => {
    const directory = process.env.EMAP_BENCHMARK_DATA_DIR;
    test.skip(!directory, 'Requires complete authorized vector files.');
    test.setTimeout(240000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/mapseekai/emap/examples/luma-25d/?gpu=' + gpu);
    await optimizedFrameReady(page);
    await page.locator('#file-input').setInputFiles(join(directory, file));
    await optimizedFrameReady(page);
    const initial = await page.evaluate(() => window.luma25d.snapshot);
    expect(initial.source).toBe(file);
    expect(initial.pointLod.enabled).toBe(true);
    expect(initial.screen.smallArcs && initial.screen.halfPixel).toBe(true);
    if (file === 'points.geojson') {
      expect(initial.vector.geometryMode).toBe('point-lod');
      expect(initial.vector.displayVertices).toBeLessThan(initial.vector.sourceVertices / 2);
    } else {
      expect(initial.screen.applied).toBe(true);
      expect(initial.screen.outputSegments).toBeGreaterThan(0);
      expect(initial.screen.outputSegments).toBeLessThan(initial.screen.originalVertices);
    }
    const box = await page.locator('#stage').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const rays = await page.evaluate(() => [[80,80],[400,200],[600,300]].map(screen => ({
      screen, world: window.luma25d.unproject(...screen),
    })));
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(x + i * 2, y + i * 0.6);
      await page.waitForTimeout(12);
    }
    const during = await page.evaluate(() => window.luma25d.snapshot);
    expect(during.navigation.active).toBe(true);
    expect(during.navigation.previewFrames).toBeGreaterThan(initial.navigation.previewFrames);
    expect(during.gpu.frames).toBe(initial.gpu.frames);
    expect(during.gpu.uploads).toBe(initial.gpu.uploads);
    const alignment = await page.evaluate(rays => {
      const transform = document.querySelector('.luma-nav-preview').style.transform;
      const m = transform.slice(9, -1).split(',').map(Number);
      return rays.map(({screen: [x,y], world}) => {
        const w = m[3]*x + m[7]*y + m[15];
        const expected = window.luma25d.project(...world);
        return Math.hypot((m[0]*x+m[4]*y+m[12])/w-expected[0],
          (m[1]*x+m[5]*y+m[13])/w-expected[1]);
      });
    }, rays);
    // CSSOM serializes small matrix coefficients with reduced precision.
    // Require subpixel preview alignment; final GPU geometry has separate pixel tests.
    for (const error of alignment) expect(error).toBeLessThan(0.05);
    await page.mouse.up();
    await optimizedFrameReady(page);
    const settled = await page.evaluate(() => window.luma25d.snapshot);
    expect(settled.navigation.active).toBe(false);
    await page.evaluate(() => window.luma25d.setPose({pitch:55,bearing:20}));
    await page.waitForTimeout(220);
    await optimizedFrameReady(page);
    const rotated = await page.evaluate(() => window.luma25d.snapshot);
    if (file === 'lucc.geojson')
      expect(rotated.screen.preparedViews).toBeGreaterThan(settled.screen.preparedViews);
    await page.locator('#flat').click();
    await page.waitForTimeout(220);
    await optimizedFrameReady(page);
    const flat = await page.evaluate(() => window.luma25d.snapshot);
    expect(flat.pitch).toBe(0);
    expect(flat.bearing).toBe(0);
    expect(flat.pointLod.enabled).toBe(true);
    expect(flat.vector.sourceVertices).toBe(initial.vector.sourceVertices);
    await page.evaluate(() => window.luma25d.dispose());
    await expect.poll(() => page.workers().length).toBe(0);
    expect(await page.evaluate(() => window.luma25d.snapshot.gpu.liveBufferBytes)).toBe(0);
    expect(errors).toEqual([]);
    await info.attach('vector-performance-contract', {
      body: JSON.stringify({file,gpu,initial,during,settled,rotated,flat,alignment},null,2),
      contentType: 'application/json',
    });
  });
}

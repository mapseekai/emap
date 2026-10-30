import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
const directory=process.env.EMAP_BENCHMARK_DATA_DIR;
const gpu=process.env.EMAP_GPU_BACKEND??'webgl';
const route='/mapseekai/emap/examples/luma-vertex-editing/?parameters=open&gpu='+gpu;
async function ready(page){await page.goto(route);await page.waitForFunction(()=>window.lumaEditor?.state==='idle');}
async function settled(page){await page.waitForFunction(()=>['ready','error'].includes(window.lumaEditor.state),null,{timeout:240000});expect(await page.locator('#status').getAttribute('data-state'),await page.locator('#status').textContent()).toBe('ready');}
async function digest(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
test('luma editor starts without generated data and advertises real precision',async({page})=>{
  await ready(page);await expect(page.locator('#renderer')).toContainText(gpu==='webgpu'?'WebGPU':'WebGL2');
  expect(await page.evaluate(()=>window.lumaEditor.scene)).toBeNull();
  await expect(page.locator('#mode')).toBeDisabled();expect(page.workers()).toHaveLength(0);
  await page.evaluate(()=>window.lumaEditor.dispose());
  expect(await page.evaluate(()=>window.lumaEditor.gpuStats.liveBufferBytes)).toBe(0);
});
test.describe('original coordinates from the five authorized real files',()=>{
  test.skip(!directory,'Set EMAP_BENCHMARK_DATA_DIR; no generated substitute is used.');test.setTimeout(300000);
  for(const filename of ['points.geojson','building.geojson','lucc.geojson','pppp.geojson','big.geojson'])test(`${filename}: select, drag, cancel, undo, redo, patch full geometry and dispose`,async({page},info)=>{
    const path=join(directory,filename),hash=await digest(path),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await ready(page);await page.locator('#file-input').setInputFiles(path);const start=Date.now();await page.locator('#load').click();await settled(page);
    const selection=await page.evaluate(()=>{
      const s=window.lumaEditor.session,d=s.dataset,l=d.layers[0],nn=d.arcs?.getVertexData().nn;
      let id=0;if(l.geometry_type!=='point')id=l.shapes.findIndex(sh=>sh&&sh.reduce((sum,part)=>sum+part.reduce((n,arc)=>n+nn[arc<0?~arc:arc],0),0)<500);
      if(id<0)id=0;
      return {id,features:window.lumaEditor.scene.featureCount,vertices:window.lumaEditor.scene.vertexCount,type:l.geometry_type};
    });
    await page.locator('#feature-id').fill(String(selection.id));await page.locator('#select-id').click();await page.locator('#fit-selected').click();
    await page.selectOption('#mode','vertex');await page.waitForTimeout(150);
    const before=await page.evaluate(()=>{
      const e=window.lumaEditor,s=e.session,r=document.querySelector('#stage').getBoundingClientRect();
      const handle=s.vertexHandles.find(h=>{const p=e.project(...h.position);return p[0]>20&&p[0]<r.width-25&&p[1]>20&&p[1]<r.height-25;});
      return {handle,pixel:e.project(...handle.position),export:s.exportSelected(),revision:s.dataset.editVersion??0};
    });
    const box=await page.locator('#stage').boundingBox();const x=box.x+before.pixel[0],y=box.y+before.pixel[1];
    // A real cancelled pointer drag never writes the source dataset or history.
    await page.mouse.move(x,y);await page.mouse.down();expect((await page.locator('#stage').boundingBox()).y).toBe(box.y);await page.mouse.move(x+14,y+8,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
    expect(await page.evaluate(()=>window.lumaEditor.session.exportSelected())).toBe(before.export);
    expect(await page.evaluate(()=>window.lumaEditor.session.history.size())).toBe(0);
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+18,y+12,{steps:6});
    expect(await page.evaluate(()=>window.lumaEditor.session.exportSelected())).toBe(before.export);
    await page.mouse.up();await settled(page);
    const after=await page.evaluate(()=>({export:window.lumaEditor.session.exportSelected(),patch:window.lumaEditor.lastPatch,chunks:window.lumaEditor.lastChunks,history:window.lumaEditor.session.history.size(),selected:window.lumaEditor.session.selected}));
    expect(after.patch.revision).toBe(before.revision+1);expect(after.history).toBe(1);expect(after.export).not.toBe(before.export);expect(after.chunks.length).toBeGreaterThan(0);
    await page.locator('#undo').click();await settled(page);expect(await page.evaluate(()=>window.lumaEditor.session.exportSelected())).toBe(before.export);
    await page.locator('#redo').click();await settled(page);expect(await page.evaluate(()=>window.lumaEditor.session.exportSelected())).toBe(after.export);
    const gpuCheck=await page.evaluate(async()=>{
      const e=window.lumaEditor,worker=e.scene.lodSource,p=e.lastPatch;
      const target=p.vertices[0]??p.points[0];
      let found=false;
      for(const id of e.lastChunks){
        const c=worker.chunks[id];if(c.kind==='fill')continue;
        const g=(await worker.build(c,-30)).geometry,v=g.vertices,step=g.kind==='path'?7:c.kind==='line'?10:4;
        for(let i=0;i<v.length;i+=step){
          for(const offset of g.kind==='line'?[0,4]:[0]){
            const k=i+offset;if(Math.abs(v[k]+v[k+2]-target.x)<1e-6&&Math.abs(v[k+1]+v[k+3]-target.y)<1e-6)found=true;
          }
        }
        if(found)break;
      }
      const pixels=await e.capturePixels();
      return {workerHasEditedCoordinate:found,painted:pixels.painted,backend:pixels.backend,revision:e.session.dataset.editVersion};
    });
    expect(gpuCheck.workerHasEditedCoordinate).toBe(true);expect(gpuCheck.painted).toBeGreaterThan(0);expect(gpuCheck.backend).toBe(gpu);expect(gpuCheck.revision).toBe(3);
    await page.screenshot({path:info.outputPath(filename+'-editing.png')});
    // Original features can also be picked by a real canvas click, not only by row number.
    {
      const pixel=await page.evaluate(()=>window.lumaEditor.project(...window.lumaEditor.session.vertexHandles[0].position));
      await page.locator('#clear').click();await page.selectOption('#mode','select');
      await page.mouse.click(box.x+pixel[0],box.y+pixel[1]);expect(await page.evaluate(()=>window.lumaEditor.session.selected)).not.toBeNull();
    }
    await page.evaluate(()=>window.lumaEditor.dispose());await expect.poll(()=>page.workers().length).toBe(0);
    expect(await page.evaluate(()=>window.lumaEditor.gpuStats.liveBufferBytes)).toBe(0);expect(errors).toEqual([]);expect(await digest(path)).toBe(hash);
    const result={filename,sha256:hash,...selection,elapsedMs:Date.now()-start,editedTopologyVertices:after.patch.vertices.length,editedPointComponents:after.patch.points.length,affectedChunks:after.chunks.length,...gpuCheck,errors};
    console.log('LUMA_EDITOR_REAL',JSON.stringify(result));await info.attach('real-file-edit-result',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  });
});

import {test,expect} from '@playwright/test';
import {join} from 'node:path';
const points={type:'FeatureCollection',features:[[-2,2],[2,2],[-2,-2],[2,-2]].map((coordinates,i)=>({type:'Feature',properties:{name:`POI ${i+1}`,rank:i+1},geometry:{type:'Point',coordinates}}))};
const nameFor=route=>route==='luma-25d'?'luma25d':'lumaBenchmark';
async function load(page,route,backend){
 const name=nameFor(route);
 await page.goto(`/mapseekai/emap/examples/${route}/?parameters=open&gpu=${backend}`);await page.waitForFunction(name=>window[name],name);
 await page.waitForFunction(name=>['ready','idle'].includes(window[name].state),name);
 await page.locator('#file-input').setInputFiles({name:'icon-points.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(points))});
 if(route==='luma-benchmark')await page.evaluate(()=>lumaBenchmark.loadFile(document.querySelector('#file-input').files[0]));
 await page.waitForFunction(name=>['ready','error'].includes(window[name].state),name);
 expect(await page.evaluate(name=>window[name].state,name)).toBe('ready');
 await page.evaluate(async name=>{const a=window[name];if(a.setView)await a.setView(.7);else{a.zoom(.7);a.draw();}},name);
 return name;
}
async function atlas(page){return page.evaluate(()=>{const c=document.createElement('canvas');c.width=128;c.height=64;const g=c.getContext('2d');g.fillStyle='#d6236c';g.fillRect(4,4,56,56);g.clearRect(24,24,16,16);g.fillStyle='#19b85a';g.fillRect(68,4,56,56);return c.toDataURL();});}
async function setIcon(page,name,options){
 await page.evaluate(async({name,options})=>{const a=window[name],id=a.layers.find(l=>l.type==='circle').id;a.setLayerIcon(id,options);a.draw('luma');await a.settleIcons();a.draw('luma');}, {name,options});
 await expect.poll(()=>page.evaluate(name=>window[name].iconStats.pending,name)).toBe(0);
}
async function sample(page,name,u,v){return page.evaluate(async({name,u,v})=>{
 const a=window[name];a.draw('luma');const canvas=document.querySelector('#webgl');const image=await createImageBitmap(canvas),copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;const c=copy.getContext('2d');c.drawImage(image,0,0);image.close();
 const opts=a.layers.find(l=>l.type==='circle').icon;const size=typeof opts.size==='number'?[opts.size,opts.size]:(opts.size??[32,32]);const anchor=opts.anchor??[.5,.5],offset=opts.offset??[0,0],angle=(opts.rotation??0)*Math.PI/180;
 const dx=(u-anchor[0])*size[0],dy=(v-anchor[1])*size[1];
 const project=p=>a.project?a.project(...p):[a.view.mx*p[0]+a.view.bx,a.view.my*p[1]+a.view.by];
 const stage=document.querySelector('#stage'),rx=copy.width/stage.clientWidth,ry=copy.height/stage.clientHeight;
 return [[-2,2],[2,2],[-2,-2],[2,-2]].map(p=>{const [x,y]=project(p);return [...c.getImageData(Math.floor((x+dx*Math.cos(angle)-dy*Math.sin(angle)+offset[0])*rx),Math.floor((y+dx*Math.sin(angle)+dy*Math.cos(angle)+offset[1])*ry),1,1).data];});
 },{name,u,v});}
async function gpuStats(page,name){return page.evaluate(name=>{const a=window[name];return {...(a.gpuStats??a.snapshot.gpu)};},name);}
for(const backend of ['webgl','webgpu'])for(const route of ['luma-benchmark','luma-25d'])test(`${backend} ${route}: icons retain point identity, anchors, sprite UV, tint and GPU buffers`,async({page},info)=>{
 test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const name=await load(page,route,backend),url=await atlas(page);
 const original=await page.evaluate(name=>window[name].layers.map(l=>[l.id,l.type]),name),before=await gpuStats(page,name);
 let options={url,rect:[0,0,64,64],size:32,anchor:[.5,1]};await setIcon(page,name,options);
 expect(await page.evaluate(name=>window[name].layers.map(l=>[l.id,l.type]),name)).toEqual(original);
 expect((await page.evaluate(name=>window[name].iconStats,name)).instances).toBe(4);
 for(const pixel of await sample(page,name,.2,.2)){expect(pixel[0]).toBeGreaterThan(200);expect(pixel[1]).toBeLessThan(50);expect(pixel[3]).toBe(255);}
 for(const pixel of await sample(page,name,.5,.5))expect(pixel[3]).toBe(0);
 const warm=await gpuStats(page,name);expect(warm.uploads).toBe(before.uploads);expect(warm.textureUploads-before.textureUploads).toBe(1);
 options={...options,size:40,rotation:90,offset:[3,-2],opacity:.5,tint:'#00a4ff'};await setIcon(page,name,options);
 for(const pixel of await sample(page,name,.2,.2)){expect(pixel[0]).toBeLessThan(5);expect(pixel[1]).toBeGreaterThan(155);expect(pixel[2]).toBeGreaterThan(245);expect(Math.abs(pixel[3]-128)).toBeLessThanOrEqual(1);}
 options={url,rect:[64,0,64,64],size:40,anchor:[.5,.5]};await setIcon(page,name,options);
 for(const pixel of await sample(page,name,.2,.2)){expect(pixel[0]).toBeLessThan(40);expect(pixel[1]).toBeGreaterThan(175);expect(pixel[3]).toBe(255);}
 const after=await gpuStats(page,name);expect(after.uploads).toBe(warm.uploads);expect(after.textureUploads).toBe(warm.textureUploads);
 expect((await page.evaluate(name=>window[name].iconStats,name)).loads).toBe(1);
 await page.evaluate(async name=>{const a=window[name];a.setLayerLabel(a.layers[0].id,{field:'name',fontSize:14});a.draw('luma');await a.settleLabels();a.draw('luma');},name);
 expect((await page.evaluate(name=>window[name].labelPlacements,name)).length).toBeGreaterThan(0);
 if(route==='luma-25d') {
  await page.locator('#icon-settings summary').click();await expect(page.locator('#icon-owner option')).toHaveCount(1);
  await page.locator('#icon-preset').selectOption('pin');await page.evaluate(async name=>{const a=window[name];a.draw('luma');await a.settleIcons();a.draw('luma');},name);
  expect((await page.evaluate(name=>window[name].iconStats,name)).errors).toEqual([]);
  expect((await page.evaluate(name=>window[name].iconStats,name)).instances).toBe(4);
 }
 await page.evaluate(async name=>{const a=window[name];a.draw('luma');await a.settleLabels();a.draw('luma');},name);
 await page.screenshot({path:info.outputPath('point-icons.png')});
 await setIcon(page,name,null);const removed=await page.evaluate(name=>window[name].iconStats,name);expect(removed.images).toBe(0);expect(removed.imageBytes).toBe(0);expect(removed.instances).toBe(0);
 await page.evaluate(name=>window[name].dispose(),name);expect(errors).toEqual([]);
 await info.attach('icon-resource-reuse',{body:JSON.stringify({backend,route,before,warm,after,removed}),contentType:'application/json'});
});
for(const backend of ['webgl','webgpu'])test(`${backend}: DPR 2 keeps icon CSS size and a failed image does not freeze the map`,async({browser},info)=>{
 test.setTimeout(90000);const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:2});const page=await context.newPage();
 try{const name=await load(page,'luma-25d',backend),url=await atlas(page);await setIcon(page,name,{url,rect:[0,0,64,64],size:32,anchor:[.5,1]});
 for(const pixel of await sample(page,name,.2,.2))expect(pixel[0]).toBeGreaterThan(200);
 for(const pixel of await sample(page,name,1.2,.2))expect(pixel[3]).toBe(0);
 await setIcon(page,name,{url:'/missing-icon-test.png'});expect((await page.evaluate(name=>window[name].iconStats,name)).errors.length).toBeGreaterThan(0);
 expect(await page.evaluate(name=>window[name].state,name)).not.toBe('error');
 await page.evaluate(()=>{luma25d.pan(10,10);luma25d.draw();});await setIcon(page,name,{url,rect:[0,0,64,64],size:32});
 expect((await page.evaluate(name=>window[name].iconStats,name)).errors).toEqual([]);
 await info.attach('hidpi-icons',{body:JSON.stringify(await page.evaluate(name=>window[name].iconStats,name)),contentType:'application/json'});
 }finally{await context.close();}
});
test('real point data: enabling image symbols preserves point LOD and warm geometry uploads',async({page},info)=>{
 test.skip(!process.env.EMAP_BENCHMARK_DATA_DIR,'Requires authorized points.geojson');test.setTimeout(120000);
 await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open');await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
 await page.locator('#file-input').setInputFiles(join(process.env.EMAP_BENCHMARK_DATA_DIR,'points.geojson'));
 await page.evaluate(()=>lumaBenchmark.loadFile(document.querySelector('#file-input').files[0]));await page.waitForFunction(()=>lumaBenchmark.state==='ready');
 const before=await page.evaluate(()=>({gpu:{...lumaBenchmark.gpuStats},lod:{...lumaBenchmark.lodStats},source:lumaBenchmark.scene.vertexCount}));const url=await atlas(page);
 await setIcon(page,'lumaBenchmark',{url,rect:[0,0,64,64],size:24});
 const after=await page.evaluate(()=>({gpu:{...lumaBenchmark.gpuStats},lod:{...lumaBenchmark.lodStats},icons:lumaBenchmark.iconStats}));
 expect(after.lod.geometryMode).toBe('point-lod');expect(after.icons.instances).toBe(after.lod.displayVertices);expect(after.icons.instances).toBeLessThan(before.source);expect(after.gpu.uploads).toBe(before.gpu.uploads);
 await page.evaluate(async()=>{for(let i=0;i<12;i++){lumaBenchmark.draw('luma');await new Promise(requestAnimationFrame);}});
 const warm=await page.evaluate(()=>({...lumaBenchmark.gpuStats}));expect(warm.uploads).toBe(after.gpu.uploads);expect(warm.textureUploads).toBe(after.gpu.textureUploads);
 await info.attach('real-point-icon-reuse',{body:JSON.stringify({before,after,warm}),contentType:'application/json'});
 await page.evaluate(()=>lumaBenchmark.dispose());
});


test('public Emap icon API preserves filters, visibility, parent order and ordinary point fallback',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open');await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');const url=await atlas(page);
 await page.evaluate(async({url,points})=>{
  lumaBenchmark.dispose();const host=document.createElement('div');host.id='formal-icon-test';Object.assign(host.style,{position:'fixed',inset:'0',width:'800px',height:'600px',background:'white',zIndex:'9999'});document.body.append(host);
  const map=await emap.Emap.create({container:host,preset:'viewer',renderer:'canvas2d'}),source=new emap.TopologySource('poi');
  await source.setData({filename:'poi.geojson',content:new TextEncoder().encode(JSON.stringify(points))});await map.addSource('poi',source);
  map.addLayer({id:'poi',source:'poi',type:'circle',icon:{url,rect:[0,0,64,64],size:40,anchor:[.5,1]}});
  map.setExtent(new emap.Bounds(-4,-4,4,4));window.formalIconMap=map;
  window.countIconPixels=()=>{const c=host.querySelector('canvas'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<data.length;i+=4)if(data[i]>180&&data[i+1]<65&&data[i+2]>80&&data[i+3]>100)n++;return n;};
 },{url,points});
 await expect.poll(()=>page.evaluate(()=>countIconPixels())).toBeGreaterThan(1000);const before=await page.evaluate(()=>countIconPixels());
 expect(await page.evaluate(()=>formalIconMap.getLayers().map(l=>[l.id,l.type]))).toEqual([['poi','circle']]);
 await page.evaluate(()=>formalIconMap.setFilter('poi',['==',['get','rank'],1]));
 await expect.poll(()=>page.evaluate(before=>{const n=countIconPixels();return n>100&&n<before/2;},before)).toBe(true);
 await page.evaluate(()=>formalIconMap.setLayerVisibility('poi','none'));await expect.poll(()=>page.evaluate(()=>countIconPixels())).toBe(0);
 await page.evaluate(()=>formalIconMap.setLayerVisibility('poi','visible'));await expect.poll(()=>page.evaluate(()=>countIconPixels())).toBeGreaterThan(100);
 await page.evaluate(()=>formalIconMap.setLayerIcon('poi',null));await expect.poll(()=>page.evaluate(()=>countIconPixels())).toBe(0);
 expect(await page.evaluate(()=>formalIconMap.getLayers().length)).toBe(1);
 await page.evaluate(async()=>{formalIconMap.removeSource('poi');await formalIconMap.dispose();});expect(errors).toEqual([]);
});

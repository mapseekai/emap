import { test, expect } from '@playwright/test';
const svg = 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path d="M32 62 5 20 Q32 -10 59 20Z" fill="#3366dd"/><circle cx="32" cy="22" r="8" fill="white"/></svg>');
const data={type:'FeatureCollection',features:[
 {type:'Feature',properties:{name:'北京 Alpha',rank:4},geometry:{type:'Point',coordinates:[-2,2]}},
 {type:'Feature',properties:{name:'上海 Beta',rank:3},geometry:{type:'Point',coordinates:[2,2]}},
 {type:'Feature',properties:{name:'道路 Road',rank:2},geometry:{type:'LineString',coordinates:[[-3,0],[0,.5],[3,0]]}},
 {type:'Feature',properties:{name:'地块 A',rank:1},geometry:{type:'Polygon',coordinates:[[[-2.5,-2.5],[2.5,-2.5],[2.5,-1],[-2.5,-1],[-2.5,-2.5]]]}}
]};
async function settle(page,name){
 await page.evaluate(async name=>{const a=window[name];for(let i=0;i<3;i++){a.draw('luma');await a.settleIcons();a.draw('luma');await a.settleLabels();a.draw('luma');}},name);
 await expect.poll(()=>page.evaluate(name=>!!window[name].labelStats.pending,name)).toBe(false);
}
async function hash(page,name){return page.evaluate(async name=>{
 window[name].draw('luma');const source=document.querySelector('#webgl'),image=await createImageBitmap(source);
 const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();
 const pixels=ctx.getImageData(0,0,c.width,c.height).data;const digest=await crypto.subtle.digest('SHA-256',pixels);
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
},name);}
for(const gpu of ['webgl','webgpu'])for(const route of ['luma-benchmark','luma-25d'])test(`${gpu} ${route}: mapped symbols equal native pixels and retain existing GPU caches`,async({page},info)=>{
 test.setTimeout(120000);const name=route==='luma-25d'?'luma25d':'lumaBenchmark', errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`/mapseekai/emap/examples/${route}/?parameters=open&gpu=${gpu}&nav=off`);
 await page.waitForFunction(name=>window[name]&&['ready','idle'].includes(window[name].state),name);
 await page.locator('#file-input').setInputFiles({name:'mapped-symbols.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(data))});
 if(route==='luma-benchmark')await page.evaluate(()=>lumaBenchmark.loadFile(document.querySelector('#file-input').files[0]));
 await page.waitForFunction(name=>window[name].state==='ready',name);
 // Leave room for the marker and its fixed above-point label; fit covers geometry only.
 await page.evaluate(async name=>{const a=window[name];if(name==='lumaBenchmark')await a.setView(.75);else a.zoom(.75);},name);
 const before=await page.evaluate(name=>window[name].layers.map(l=>[l.id,l.type]),name);
 await page.evaluate(({name,svg})=>{const a=window[name];for(const l of a.layers)a.setLayerSymbol(l.id,{
  ...(l.type==='circle'?{images:{marker:{url:svg,size:[24,32]}}}:{}),
  layout:{'text-field':['get','name'],'text-size':18,'text-offset':[0,.2],'text-allow-overlap':false,
   ...(l.type==='circle'?{'icon-image':'marker','icon-size':1,'icon-anchor':'bottom','icon-offset':[2,-1]}:{})},
  paint:{'text-color':'#dd1177','text-halo-color':'#fff','text-halo-width':1.5,...(l.type==='circle'?{'icon-opacity':.8}:{})},
  labeling:{priority:['get','rank']}
 });},{name,svg});
 await settle(page,name);
 expect(await page.evaluate(name=>window[name].labelPlacements.length,name)).toBe(4);
 const mappedHash=await hash(page,name);
 const native=await page.evaluate(name=>window[name].layers.map(l=>({id:l.id,type:l.type,label:l.label,icon:l.icon,symbol:l.symbol})),name);
 expect(await page.evaluate(name=>window[name].layers.map(l=>[l.id,l.type]),name)).toEqual(before);
 await page.evaluate(({name,native})=>{const a=window[name];for(const l of native){a.setLayerSymbol(l.id,null);if(l.icon)a.setLayerIcon(l.id,l.icon);a.setLayerLabel(l.id,l.label);}}, {name,native});
 await settle(page,name);expect(await hash(page,name)).toBe(mappedHash);
 await page.evaluate(({name,native})=>{for(const l of native)window[name].setLayerSymbol(l.id,l.symbol);},{name,native});await settle(page,name);
 const pointId=native.find(l=>l.type==='circle').id;
 const warm=await page.evaluate(name=>({gpu:window[name].gpuStats??window[name].snapshot.gpu,label:window[name].labelStats.gpu}),name);
 await page.evaluate(({name,id})=>{const a=window[name];a.setSymbolLayoutProperty(id,'text-size',20);a.setSymbolLayoutProperty(id,'text-offset',[0,1.2]);a.setSymbolLayoutProperty(id,'icon-size',1.5);a.setSymbolLayoutProperty(id,'icon-rotate',90);a.setSymbolLayoutProperty(id,'icon-offset',[2,3]);a.setSymbolPaintProperty(id,'text-color','#bb2255');a.setSymbolPaintProperty(id,'icon-opacity',.6);},{name,id:pointId});
 await settle(page,name);
 const state=await page.evaluate(({name,id})=>{const a=window[name];return {layer:a.layers.find(l=>l.id===id),gpu:a.gpuStats??a.snapshot.gpu,label:a.labelStats.gpu};},{name,id:pointId});
 expect(state.layer.label.offset).toEqual([0,24]);expect(state.layer.icon.size).toEqual([36,48]);
 expect(state.layer.icon.offset[0]).toBeCloseTo(-4.5);expect(state.layer.icon.offset[1]).toBeCloseTo(3);
 expect(state.gpu.uploads).toBe(warm.gpu.uploads);expect(state.gpu.textureUploads).toBe(warm.gpu.textureUploads);
 expect(state.label.textureUploads).toBe(warm.label.textureUploads);
 const rejected=await page.evaluate(({name,id})=>{const a=window[name],before=JSON.stringify(a.layers);let message='';try{a.setSymbolLayoutProperty(id,'icon-image','unregistered');}catch(e){message=e.message;}return {message,unchanged:before===JSON.stringify(a.layers)};},{name,id:pointId});
 expect(rejected.message).toContain('unregistered');expect(rejected.unchanged).toBe(true);
 // The 2.5D panels write the canonical layout/paint object, preserving the other channel.
 if(route==='luma-25d') {
 await page.locator('#label-settings>summary').click();await page.locator('#label-owner').selectOption(pointId);
 await page.locator('#label-size').fill('22');await page.locator('#label-size').dispatchEvent('change');await settle(page,name);
 expect(await page.evaluate(({name,id})=>window[name].layers.find(l=>l.id===id).symbol.layout['text-size'],{name,id:pointId})).toBe(22);
 expect(await page.evaluate(({name,id})=>window[name].layers.find(l=>l.id===id).label.offset,{name,id:pointId})).toEqual([0,26.4]);
 await page.locator('#icon-settings>summary').click();await page.locator('#icon-owner').selectOption(pointId);
 await page.locator('#icon-size').fill('2');await page.locator('#icon-size').dispatchEvent('change');await settle(page,name);
 expect(await page.evaluate(({name,id})=>window[name].layers.find(l=>l.id===id).symbol.layout['icon-size'],{name,id:pointId})).toBe(2);
 const other=native.find(l=>l.type!=='circle').id;await page.locator('#label-owner').selectOption(other);
 expect(JSON.parse(await page.locator('#label-symbol-json').textContent())).toEqual(await page.evaluate(({name,id})=>window[name].layers.find(l=>l.id===id).symbol,{name,id:other}));
 await page.locator('#label-owner').selectOption(pointId);
 }
 await page.screenshot({path:info.outputPath('symbol-mapping.png')});
 await page.evaluate(name=>window[name].dispose(),name);expect(errors).toEqual([]);
 console.log('SYMBOL_MAPPING',JSON.stringify({gpu,route,pixelEquivalent:true,geometryUploads:warm.gpu.uploads,unchangedAtlas:true}));
});

test('public Emap addLayer symbol maps settings with no new layer, keeps parent filter and rolls back invalid edits',async({page})=>{
 await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open');await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
 const result=await page.evaluate(async({svg,data})=>{
  lumaBenchmark.dispose();const host=document.createElement('div');Object.assign(host.style,{position:'fixed',inset:'0',width:'800px',height:'600px'});document.body.append(host);
  const map=await emap.Emap.create({container:host,preset:'viewer'}),source=new emap.TopologySource('poi');
  await source.setData({filename:'points.geojson',content:new TextEncoder().encode(JSON.stringify({...data,features:data.features.slice(0,2)}))});await map.addSource('poi',source);
  map.addLayer({id:'poi',source:'poi',type:'circle',paint:{'circle-radius':4,'circle-color':'#2563eb'},symbol:{images:{marker:{url:svg,size:[24,32]}},layout:{'icon-image':'marker','icon-size':1,'icon-anchor':'bottom','text-field':['get','name'],'text-size':14,'text-offset':[0,1.2]},paint:{'icon-opacity':1,'text-color':'#243447','text-halo-color':'#fff','text-halo-width':1.5}}});
  map.setSymbolLayoutProperty('poi','text-size',20);map.setSymbolPaintProperty('poi','icon-opacity',.5);map.setFilter('poi',['==',['get','name'],'北京 Alpha']);
  const current=map.getLayer('poi');let rejected=false;try{map.setSymbolLayoutProperty('poi','icon-image','missing');}catch{rejected=true;}
  const unchanged=JSON.stringify(current)===JSON.stringify(map.getLayer('poi'));
  map.setLayerVisibility('poi','none');const hidden=map.getLayer('poi');map.removeLayerSymbol('poi');const cleared=map.getLayer('poi');const ids=map.getLayers().map(l=>[l.id,l.type]);
  await map.dispose();host.remove();return {current,rejected,unchanged,hidden,cleared,ids};
 },{svg,data});
 expect(result.current.label.offset).toEqual([0,24]);expect(result.current.icon.opacity).toBe(.5);
 expect(result.rejected&&result.unchanged).toBe(true);expect(result.hidden.layout.visibility).toBe('none');
 expect(result.cleared.symbol).toBeUndefined();expect(result.cleared.label).toBeUndefined();expect(result.cleared.icon).toBeUndefined();expect(result.ids).toEqual([['poi','circle']]);
});


test('local image URLs live as long as their named symbol resource, not only its visible icon',async({page})=>{
 await page.goto('/mapseekai/emap/examples/luma-25d/?parameters=open');await page.waitForFunction(()=>window.luma25d&&['idle','ready'].includes(luma25d.state));
 await page.locator('#file-input').setInputFiles({name:'points.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify({...data,features:data.features.slice(0,2)}))});
 await page.waitForFunction(()=>luma25d.state==='ready');
 await page.locator('#icon-settings>summary').click();
 await page.locator('#icon-file').setInputFiles({name:'pin.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>')});
 await settle(page,'luma25d');
 const image=await page.evaluate(()=>{const l=luma25d.layers[0],name=l.symbol.layout['icon-image'];return {id:l.id,name,url:l.symbol.images[name].url};});
 expect(image.url.startsWith('blob:')).toBe(true);
 await page.evaluate(({id})=>{luma25d.setSymbolLayoutProperty(id,'icon-image',null);luma25d.draw('luma');},image);
 await page.waitForFunction(()=>luma25d.iconStats.images===0);
 // Allow the normal UI refresh that used to revoke still-declared resources.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 expect(await page.evaluate(async({url})=>{try{return (await fetch(url)).ok;}catch{return false;}},image)).toBe(true);
 await page.evaluate(({id,name})=>luma25d.setSymbolLayoutProperty(id,'icon-image',name),image);await settle(page,'luma25d');
 expect(await page.evaluate(()=>luma25d.iconStats.errors)).toEqual([]);expect(await page.evaluate(()=>luma25d.iconStats.images)).toBe(1);
 await page.evaluate(()=>luma25d.dispose());
 expect(await page.evaluate(async({url})=>{try{return (await fetch(url)).ok;}catch{return false;}},image)).toBe(false);
});

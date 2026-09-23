import { PointIconImages, type PointIcon } from '../../../../src/engine/rendering/icons/images';
import { cloneIconOptions, type IconOptions } from '../../../../src/engine/map/icon';
import { MsdfLabelAtlas } from '../../../../src/integrations/msdf/atlas';
import { BoundLabelManager, drawCanvasLabels, type LabelFrame } from '../../../../src/engine/rendering/labels/manager';
import { cloneLabelOptions, type LabelOptions } from '../../../../src/engine/map/label';
import { cloneLayerSpecification, type LayerSpecification } from '../../../../src/engine/map/layer';
import { resolveLayerInList } from '../../../../src/engine/map/layer-registry';
import { getLayerId } from '../../../../src/domain/source/layer-utils';
import { perspectiveActive, cameraUniforms } from '../../../../src/domain/geo/perspective-transform';
import { ScreenPathCache, drawScreenPaths, type ScreenPathEntry } from './screen-path-cache';
import type { ScreenPathRequest } from '../../../../src/engine/rendering/luma/screen-paths';
import { FastNavPreview } from './fast-nav';
import { PathRangeIndex } from '../../../../src/engine/rendering/luma/path-ranges';
import { PointLodRenderCache } from './point-lod-cache';
import { DEFAULT_LUMA_POINT_LOD_CELL_SIZE, validatePointLodCellSize } from '../../../../src/engine/rendering/luma/point-lod-source';
import { CanvasPainter } from '../../../../src/engine/rendering/canvas-painter';
import { GpuRenderer, type GpuMesh } from '../../../../src/integrations/luma/gpu-renderer';
import { FullGeometrySource, lodYield, type DisplayChunk, type SpatialChunk, type ChunkGeometryAccess } from '../../../../src/engine/rendering/luma/spatial-chunks';
import type { CoordinatePatch } from '../../../../src/engine/rendering/luma/edit-patch';
import type { MeshPaint } from '../../../../src/integrations/luma/types';
import { AffineTransform } from '../../../../src/domain/geo/transform';
import { Bounds } from '../../../../src/domain/geo/bounds';
import type { Scene } from './scene';
export type Backend = 'canvas' | 'luma';
export type PassMode = 'all' | 'fill' | 'stroke' | 'points';
const LINE_COLOR='#0f766e', FILL_COLOR='#d97706';

const linePaint:MeshPaint={color:[15/255,118/255,110/255,1],width:1.2};
const fillPaint:MeshPaint={color:[217/255,119/255,6/255,0.55]};
const outlinePaint:MeshPaint={color:[15/255,118/255,110/255,1],width:0.6};
// Soft budget for non-visible data. A visible full-detail working set is never simplified.
const CACHE_BYTES=256*1024**2;
interface Entry {display:DisplayChunk;mesh:GpuMesh|null;used:number;rangeIndex?:PathRangeIndex}
interface FrameEntry {chunk:SpatialChunk;raw?:Entry;filtered?:ScreenPathEntry}
export class BenchmarkRenderers {
 private iconImages:PointIconImages|null=null;
 private frameIcons=new Map<number,PointIcon>();
 get iconStats(){return {...(this.iconImages?.stats??{pending:0,images:0,imageBytes:0,loads:0,errors:[]}),drawCalls:this.gpu?.stats.iconDrawCalls??0,instances:this.gpu?.stats.iconFrameInstances??0};}
 async settleIcons():Promise<void>{this.syncIcons();await this.iconImages?.settled();this.syncIcons();}
 setLayerIcon(id:string,options:IconOptions|null):void {
  const spec=this.layerSpecs.find(l=>l.id===id);if(!spec)throw new Error(`Unknown vector layer: ${id}`);
  if(spec.type!=='circle')throw new Error('Icons require an existing point layer.');
  spec.icon=options===null?undefined:cloneIconOptions(options);
  this.iconImages?.retry();this.syncIcons();this.frameEpoch++;this.signature='';
  this.navigation.reset();this.labelManager?.invalidateLayout();this.invalidate();
 }
 private syncIcons():void {
  this.frameIcons??=new Map();this.frameIcons.clear();
  const active=(this.layerSpecs??[]).flatMap((spec,index)=>spec.type==='circle'&&spec.icon&&spec.icon.enabled!==false&&spec.layout?.visibility!=='none'?[{index,icon:spec.icon}]:[]);
  if(!active.length){this.iconImages?.dispose();this.iconImages=null;return;}
  this.iconImages??=new PointIconImages(()=>{this.frameEpoch++;this.navigation.invalidateFrame();this.labelManager?.invalidateLayout();this.invalidate();},asset=>{this.gpu?.forgetImage(asset.image);this.cpu.clearIcons?.();});
  this.iconImages.retain(active.map(o=>o.icon));
  for(const {index,icon} of active){const ready=this.iconImages.get(icon);if(ready)this.frameIcons.set(index,ready);}
 }
 private pointSymbolPadding():number {let padding=Math.max(8,(this.pointPaint.radius??3)+0.5);for(const icon of this.frameIcons?.values()??[])padding=Math.max(padding,icon.radius);return padding;}

 private labelManager:BoundLabelManager|null=null;
 private labelError:string|null=null;
 private layerSpecs:LayerSpecification[]=[];
 getLayers():readonly LayerSpecification[]{return this.layerSpecs.map(cloneLayerSpecification);}
 getLabelFields(id:string):string[]{
  const spec=this.layerSpecs.find(l=>l.id===id);
  const layer=spec&&this.scene?resolveLayerInList(this.scene.dataset.layers,this.layerSpecs.indexOf(spec)):null;
  return layer?.data?.getFields?.()??Object.keys(layer?.data?.getRecordAt?.(0)??layer?.data?.getRecords?.()[0]??{});
 }
 setLayerLabel(id:string,options:LabelOptions|null):void {
  const spec=this.layerSpecs.find(l=>l.id===id);if(!spec)throw new Error(`Unknown vector layer: ${id}`);
  spec.label=options===null?undefined:cloneLabelOptions(options);this.labelError=null;
  this.frameEpoch++;this.navigation.reset();this.labelManager?.invalidateLayout();this.invalidate();
 }
 setLayerVisibility(id:string,visibility:'visible'|'none'):void {
  if(!['visible','none'].includes(visibility))throw new Error('Invalid layer visibility');
  const spec=this.layerSpecs.find(l=>l.id===id);if(!spec)throw new Error(`Unknown vector layer: ${id}`);
  spec.layout={...spec.layout,visibility};this.syncIcons();this.frameEpoch++;this.navigation.reset();this.labelManager?.invalidateLayout();this.invalidate();
 }
 get labelControlRevision(){return `${this.generation}:${this.scene?.dataset.attributeVersion??0}`;}
 get labelPlacements(){return this.labelManager?.placements??[];}
 get labelStats(){return {...this.labelManager?.stats,error:this.labelError,gpu:this.gpu?.textStats};}
 async settleLabels():Promise<void>{await this.labelManager?.settled();}
 private labels(view:AffineTransform):LabelFrame {
  const bindings=(this.layerSpecs??[]).flatMap(spec=>{
   if(!spec.label||spec.label.enabled===false||spec.layout?.visibility==='none'||!this.scene)return [];
   if(this.passMode!=='all'&&((this.passMode==='points')!==(spec.type==='circle')))return [];
   const layer=resolveLayerInList(this.scene.dataset.layers,this.layerSpecs.indexOf(spec));
   return layer?[{id:spec.id,dataset:this.scene.dataset,layer,options:spec.label,pointRadius:Math.max(this.pointPaint.radius??3,this.frameIcons?.get(this.layerSpecs.indexOf(spec))?.radius??0)}]:[];
  });
  if(!bindings.length){if(this.labelManager){this.labelManager.dispose();this.labelManager=null;this.labelError=null;this.gpu?.clearLabels();}return {key:'',labels:[]};}
  this.labelManager??=new BoundLabelManager(()=>{this.frameEpoch++;this.navigation.invalidateFrame();this.invalidate();},error=>{this.labelError=error.message;this.invalidate();},globalThis.document,new MsdfLabelAtlas(new URL(`${import.meta.env.BASE_URL}emap-msdf-worker.js`,location.href)));
  this.labelManager.pause(this.interacting);
  return this.labelManager.request(bindings,view,this.dimensions[0],this.dimensions[1],this.dimensions[2]);
 }

 readonly cpu:CanvasPainter;
 readonly navigation:FastNavPreview;
 pathCullingEnabled=true;
 smallArcFilterEnabled=true;
 halfPixelFilterEnabled=true;
 private screenPaths:ScreenPathCache|null=null;
 private initialScale=1;
 private preparing=false;
 private editing=false;
 private renderRevision=0;
 private frameEpoch=0;
 private editView:AffineTransform|null=null;
 private editSelection:SpatialChunk[]=[];
 editorFrameKey(view:AffineTransform):string {
  return JSON.stringify([this.generation,this.frameEpoch,this.renderRevision,view,this.dimensions,this.pointPaint,this.passMode,this.gpu?.pathMode,
    this.gpu?.circleOptimizationEnabled,this.smallArcFilterEnabled,this.halfPixelFilterEnabled,this.pathCullingEnabled,this.pointLodEnabled,this.pointLodCellSize]);
 }
 editorFrameReady(view:AffineTransform):boolean {
  if(this.preparing||!this.source)return false;
  this.setView(view);const request=this.screenRequest(view);
  if(this.screenEnabled()&&!this.screenPaths!.get(request,this.selected)&&!this.screenPaths!.failed(request,this.selected))return false;
  return this.requiredRaw(view).every(c=>this.cache.has(c.id));
 }
 get displayRevision(){return this.renderRevision;}
 readonly editStats={pending:false,revision:0,patchMs:0,geometryMs:0,screenMs:0,totalMs:0,rebuiltChunks:0};
 screenFilterApplied=false;
 get screenFilterStats(){return {smallArcs:this.smallArcFilterEnabled,halfPixel:this.halfPixelFilterEnabled,applied:this.screenFilterApplied,
  pending:0,outputSegments:0,duplicateVertices:0,tinyArcs:0,collapsedArcs:0,outsideArcs:0,rawFallbackChunks:0,
  buildWallMs:0,uploads:0,cacheBytes:0,...this.screenPaths?.stats};}
 setScreenFilters(smallArcs:boolean,halfPixel:boolean):void {
  if(typeof smallArcs!=='boolean'||typeof halfPixel!=='boolean')throw new Error('Invalid screen filter flags');
  this.smallArcFilterEnabled=smallArcs;this.halfPixelFilterEnabled=halfPixel;this.screenPaths?.clear();this.navigation.reset();
 }
 private screenRequest(view:AffineTransform):ScreenPathRequest {
  return {view:[view.mx,view.my,view.bx,view.by],width:this.dimensions[0],height:this.dimensions[1],pixelRatio:this.dimensions[2],
    ...(perspectiveActive(view)?{perspective:{pitch:view.pitch,bearing:view.bearing}}:{}),
    initialScale:this.initialScale,smallArcs:this.smallArcFilterEnabled,halfPixel:this.halfPixelFilterEnabled,
    cull:this.pathCullingEnabled,padding:8,revision:this.renderRevision??this.scene?.dataset.editVersion??0};
 }
 async warmScreenPaths(view:AffineTransform,signal:AbortSignal):Promise<void> {
  if(!(this.smallArcFilterEnabled||this.halfPixelFilterEnabled))return;
  this.setView(view);await this.screenPaths?.warm(this.screenRequest(view),this.selected,signal);
 }
 drawScreenFrame(backend:Backend,view:AffineTransform,overlay?:(gpu:GpuRenderer)=>void):number {
  this.setView(view);
  const screen=(this.smallArcFilterEnabled||this.halfPixelFilterEnabled)?this.screenPaths?.get(this.screenRequest(view),this.selected)??undefined:undefined;
  return this.draw(backend,view,overlay,screen);
 }

 readonly initializationMs:{canvas:number;luma:number|null};
 private pointLod:PointLodRenderCache|null=null;
 pointLodEnabled=true;
 pointLodCellSize=DEFAULT_LUMA_POINT_LOD_CELL_SIZE;
 get pointLodStats(){return {enabled:this.pointLodEnabled,cellSize:this.pointLodCellSize,
  pending:0,builds:0,uploads:0,cacheBytes:0,cacheEntries:0,evictions:0,...this.pointLod?.stats};}
 setPointLod(enabled:boolean,cellSize=this.pointLodCellSize):void {
  if(typeof enabled!=='boolean')throw new Error('Point LOD enabled must be boolean.');
  validatePointLodCellSize(cellSize);this.pointLodEnabled=enabled;this.pointLodCellSize=cellSize;
  this.pointLod?.configure(enabled,cellSize);
 }
 private scene:Scene|null=null;
 private source:ChunkGeometryAccess|null=null;
 private cache=new Map<number,Entry>();
 // Tiny immutable counts survive GPU eviction; displaying screen paths never requires
 // reconstructing the full source-coordinate buffer just to obtain its statistics.
 private geometryMetadata=new Map<number,{points:number;segments:number}>();
 readonly refillStats={lineBuilds:0,fillBuilds:0,pointBuilds:0};
 get cacheDiagnostics(){
  let fillBytes=0,lineBytes=0,pointBytes=0,fillChunks=0,lineChunks=0;
  for(const e of this.cache.values()){
   if(e.display.chunk.kind==='fill'){fillBytes+=e.display.bytes;fillChunks++;}
   else if(e.display.chunk.kind==='line'){lineBytes+=e.display.bytes;lineChunks++;}
   else pointBytes+=e.display.bytes;
  }
  return {...this.refillStats,fillBytes,lineBytes,pointBytes,fillChunks,lineChunks,budgetBytes:CACHE_BYTES};
 }
 private building=new Map<number,Promise<Entry>>();
 private dimensions=[1,1,1];
 private generation=0;
 private cacheBytes=0;
 private clock=0;
 private selected:SpatialChunk[]=[];
 private pump:AbortController|null=null;
 private signature='';
 private pendingTransform:AffineTransform|null=null;
 private interacting=false;
 private disposed=false;
 private pinned:Set<number>|null=null;
 buildMs=0;
 uploadSubmitMs=0;
 passMode:PassMode='all';
 readonly pointPaint:MeshPaint={color:[37/255,99/255,235/255,1],radius:3};
 setPointStyle(radius:number,opacity:number):void {
  if(!Number.isFinite(radius)||radius<=0||radius>64||!Number.isFinite(opacity)||opacity<0||opacity>1)throw new Error('Invalid point radius or opacity');
  this.pointPaint.radius=radius;this.pointPaint.color[3]=opacity;
 }
 readonly lodStats={geometryMode:'full' as 'full'|'point-lod',totalChunks:0,visibleChunks:0,drawnChunks:0,
  fallbackChunks:0,displayVertices:0,targetLevel:0,baseLevel:0,cacheBytes:0,cacheEntries:0,
  pending:0,evictions:0,sourceVertices:0,sourceFeatures:0,builds:0,omitted:0,budgetFallbacks:0,
  missingChunks:0,frameDrawCalls:0,workingSetOverBudgetBytes:0,submittedSegments:0,candidateSegments:0,culledSegments:0};
 static async create(canvas:HTMLCanvasElement,glCanvas:HTMLCanvasElement,restored:()=>void,
  report:(error:Error)=>void,invalidate:()=>void=()=>{},backend:'webgl'|'webgpu'='webgl') {
  const start=performance.now();let gpu:GpuRenderer|null=null,reason:string|null=null;
  const startupErrors:Error[]=[];let initialized=false;
  const errorHandler=(error:Error)=>{if(initialized)report(error);else startupErrors.push(error);};
  try {gpu=await GpuRenderer.create(glCanvas,restored,errorHandler,backend);
    if(startupErrors.length)throw startupErrors[0];}
  catch(error){gpu?.dispose();gpu=null;reason=error instanceof Error?error.message:String(error);}
  const result=new BenchmarkRenderers(canvas,glCanvas,gpu,reason,performance.now()-start,report,invalidate);
  initialized=true;return result;
 }
 private constructor(readonly canvas:HTMLCanvasElement,readonly glCanvas:HTMLCanvasElement,
  readonly gpu:GpuRenderer|null,readonly unavailableReason:string|null,gpuMs:number,
  private report:(error:Error)=>void,private invalidate:()=>void) {
  const start=performance.now();this.cpu=new CanvasPainter(canvas);
  this.initializationMs={canvas:performance.now()-start,luma:gpu?gpuMs:null};
  this.navigation=new FastNavPreview(glCanvas.parentElement!,invalidate);
  canvas.dataset.renderer='canvas2d';glCanvas.dataset.renderer=gpu?`luma-${gpu.backend==='webgpu'?'webgpu':'webgl2'}`:'unavailable';
 }
 resize(width:number,height:number,dpr:number):void {
  if(this.disposed||this.dimensions.every((v,i)=>v===[width,height,dpr][i]))return;
  this.navigation.reset();
  this.dimensions=[width,height,dpr];this.cpu.setPixelRatio(dpr);this.cpu.resize(width,height);
  this.canvas.width=Math.max(1,Math.round(width*dpr));this.canvas.height=Math.max(1,Math.round(height*dpr));
  this.gpu?.resize(width,height,dpr);this.signature='';
 }
 async prepare(scene:Scene,signal:AbortSignal,initial?:AffineTransform,progress:(message:string)=>void=()=>{},options:{preload?:'all'|'visible'}={}):Promise<void>{
  this.clear();this.scene=scene;this.renderRevision=scene.dataset.editVersion??0;this.preparing=true;this.buildMs=0;this.uploadSubmitMs=0;const prepareGeneration=this.generation;
  try {
  const source=scene.lodSource??new FullGeometrySource(scene.dataset,[scene.bounds.xmin,scene.bounds.ymin,scene.bounds.xmax,scene.bounds.ymax]);
  this.source=source;
  this.layerSpecs=scene.dataset.layers.map((layer,i)=>({id:`vector-${i}`,source:'luma',
   'source-layer':getLayerId(layer,i),type:layer.geometry_type==='point'?'circle':layer.geometry_type==='polygon'?'fill':'line'}));
  const start=performance.now();await source.initialize(signal,progress);
  if(scene.dataset.layers.some(l=>l.geometry_type==='point')){
   this.pointLod=new PointLodRenderCache(source,scene.dataset,this.gpu,()=>{this.frameEpoch++;this.navigation.invalidateFrame();this.invalidate();},this.report);
   this.pointLod.configure(this.pointLodEnabled,this.pointLodCellSize);
  }
  const [width,height]=this.dimensions;
  initial??=AffineTransform.fromBounds(scene.bounds.clone().fillOut(width/height),new Bounds(24,24,width-24,height-24),true);
  this.initialScale=Math.abs(initial.mx);
  if(source.chunks.some(c=>c.kind==='line'))this.screenPaths=new ScreenPathCache(source,this.gpu,()=>{this.frameEpoch++;this.navigation.invalidateFrame();this.invalidate();},this.report);
  this.lodStats.totalChunks=source.chunks.length;this.lodStats.sourceVertices=scene.vertexCount;this.lodStats.sourceFeatures=scene.featureCount;
  this.setView(initial);
  const visibleOnly=options.preload==='visible';
  if(visibleOnly) {
   // Interactive entry points need a drawable view, not an A/B cache of every
   // original mesh. Keep the comparison harness's eager preparation unchanged.
   await this.pointLod?.warm(initial,this.dimensions,this.selected,signal);
   await this.warmScreenPaths(initial,signal);
  }
  const jobs=visibleOnly?this.requiredRaw(initial):source.chunks;
  this.pinned=new Set(jobs.map(c=>c.id));
  try {
   for(let i=0;i<jobs.length;i++){
    await lodYield(signal);await this.ensure(source,jobs[i]);
    if(i%16===0)progress(`准备${visibleOnly?'可见':'全量'}原始几何 ${i+1}/${jobs.length}（源数据不化简）`);
   }
  } finally {this.pinned=null;}
  if(!visibleOnly) {
   await this.pointLod?.warm(initial,this.dimensions,this.selected,signal);
   await this.warmScreenPaths(initial,signal);
  }
  this.buildMs=performance.now()-start;this.signature='';
  } finally {if(this.generation===prepareGeneration)this.preparing=false;}
 }
 private async ensure(source:ChunkGeometryAccess,chunk:SpatialChunk,stage?:Map<number,Entry>):Promise<Entry>{
  const existing=stage?undefined:this.cache.get(chunk.id);if(existing){existing.used=++this.clock;return existing;}
  const pending=this.building.get(chunk.id);if(pending)return pending;
  const generation=this.generation;
  const task=(async()=>{
   const display=await source.build(chunk,0);
   if(this.source!==source||generation!==this.generation||this.disposed)throw new DOMException('Stale geometry','AbortError');
   const t=performance.now(),mesh=this.gpu?.createMesh(display.geometry)??null;
   this.uploadSubmitMs+=performance.now()-t;
   // Canvas uses the shared full-detail coordinate view; GPU owns the uploaded data.
   // Retain counts, but not a second CPU copy of GPU-packed positions and indices.
   if(mesh){display.geometry.vertices=new Float32Array(0);delete display.geometry.indices;}
   const rangeIndex=display.geometry.pathRanges ? new PathRangeIndex(display.geometry.pathRanges,display.geometry.count) : undefined;
   if(rangeIndex)display.bytes+=rangeIndex.data.bounds.byteLength+rangeIndex.data.segments.byteLength;
   this.refillStats[chunk.kind==='fill'?'fillBuilds':chunk.kind==='line'?'lineBuilds':'pointBuilds']++;
   const entry={display,mesh,used:++this.clock,rangeIndex};
   if(stage)stage.set(chunk.id,entry);else this.install(chunk.id,entry);
   this.lodStats.builds++;return entry;
  })().finally(()=>{if(this.building.get(chunk.id)===task)this.building.delete(chunk.id);});
  this.building.set(chunk.id,task);return task;
 }
 private install(id:number,entry:Entry):void {
  this.frameEpoch++;
  const old=this.cache.get(id);
  if(old){if(old.mesh)this.gpu?.destroyMesh(old.mesh);this.cacheBytes-=old.display.bytes;}
  this.cache.set(id,entry);this.cacheBytes+=entry.display.bytes;
  this.geometryMetadata.set(id,{points:entry.display.points,segments:entry.display.geometry.segmentCount??0});
 }
 private setView(t:AffineTransform):void {
  if(!this.source)return;
  if(this.editing&&this.editView&&t.mx===this.editView.mx&&t.my===this.editView.my&&t.bx===this.editView.bx&&t.by===this.editView.by&&cameraUniforms(t).every((v,i)=>v===cameraUniforms(this.editView!)[i])){this.selected=this.editSelection;return;}
  this.selected=this.source.visible(t,this.dimensions[0],this.dimensions[1],this.pointSymbolPadding());
  this.lodStats.visibleChunks=this.selected.length;
 }
 setInteracting(value:boolean):void {
  this.interacting=value;this.navigation.setInteracting(value);this.screenPaths?.pause(value);
  if(value){this.pump?.abort();this.pump=null;this.signature='';}
  else if(this.pendingTransform)this.requestView(this.pendingTransform);
 }
 private screenEnabled():boolean {
  return !!this.screenPaths&&(this.smallArcFilterEnabled||this.halfPixelFilterEnabled);
 }
 /** Screen commands are a complete drawable, not an accessory of the raw mesh.
  * Reserve raw builds for fill/point draws and explicitly reported screen fallbacks.
  */
 private requiredRaw(view:AffineTransform):SpatialChunk[] {
  const request=this.screenRequest(view);
  const filtered=this.screenEnabled()&&!this.screenPaths!.failed(request,this.selected);
  const screen=filtered?this.screenPaths!.get(request,this.selected):null;
  const pointLayers=this.pointLod?.view(view,this.dimensions,this.selected);
  return this.selected.filter(c=>this.enabled(c)&&
   !(c.kind==='point'&&pointLayers?.get(c.layer))&&
   !(filtered&&c.kind==='line'&&!screen?.get(c.id)?.packet.fallback));
 }
 requestView(transform:AffineTransform):void {
  this.pendingTransform=transform.clone();this.setView(transform);
  if(this.interacting||this.preparing||this.editing||!this.source||this.disposed)return;
  // Start the cheap display request first. It must not sit behind discarded raw
  // line uploads or a whole near-to-far geometry refill on the same Worker.
  if(this.screenEnabled())this.screenPaths!.request(this.screenRequest(transform),this.selected);
  this.pointLod?.request(transform,this.dimensions,this.selected);
  const required=this.requiredRaw(transform);
  const signature=JSON.stringify([this.selected.map(c=>c.id),required.map(c=>c.id)]);if(signature===this.signature)return;
  this.signature=signature;this.pump?.abort();
  const controller=new AbortController(),source=this.source,missing=required.filter(c=>!this.cache.has(c.id));
  this.pump=controller;this.lodStats.pending=missing.length;
  if(!missing.length){this.pump=null;this.trim();return;}
  void(async()=>{
   for(const c of missing){await lodYield(controller.signal);await this.ensure(source,c);
    controller.signal.throwIfAborted();
    if(this.pump===controller)this.lodStats.pending--;this.invalidate();}
  })().catch(error=>{if(!controller.signal.aborted)this.report(error instanceof Error?error:new Error(String(error)));})
   .finally(()=>{if(this.pump===controller){this.pump=null;this.lodStats.pending=0;this.trim();this.invalidate();}});
 }
 async warmViews(views:readonly AffineTransform[],signal:AbortSignal):Promise<void>{
  this.pump?.abort();this.pump=null;const source=this.source;if(!source)return;
  const jobs=new Map<number,SpatialChunk>();
  for(const view of views)for(const c of source.visible(view,this.dimensions[0],this.dimensions[1],this.pointSymbolPadding()))jobs.set(c.id,c);
  this.pinned=new Set(jobs.keys());
  try{for(const c of jobs.values()){if(this.cache.has(c.id))continue;await lodYield(signal);await this.ensure(source,c);}}
  finally{this.pinned=null;}this.lodStats.pending=0;
  for(const view of views) await this.pointLod?.warm(view,this.dimensions,
   source.visible(view,this.dimensions[0],this.dimensions[1],this.pointSymbolPadding()),signal);
 }
 private paint(c:SpatialChunk):MeshPaint{return c.kind==='fill'?fillPaint:c.kind==='point'?this.pointPaint:
  this.scene?.dataset.layers[c.layer].geometry_type==='polygon'?outlinePaint:linePaint;}
 private enabled(c:SpatialChunk):boolean{return this.layerSpecs?.[c.layer]?.layout?.visibility!=='none'&&(this.passMode==='all'||
  (this.passMode==='fill'&&c.kind==='fill')||(this.passMode==='stroke'&&c.kind==='line')||(this.passMode==='points'&&c.kind==='point'));}
 draw(backend:Backend,transform:AffineTransform,overlay?:(gpu:GpuRenderer)=>void,screen?:ReadonlyMap<number,ScreenPathEntry>):number {
  if(this.disposed||this.preparing||!this.scene||!this.source)return 0;
  if(perspectiveActive(transform)) {
    if(backend!=='luma')throw new Error('Perspective rendering requires the luma backend.');
  }
  const start=performance.now();this.syncIcons();this.setView(transform);this.screenFilterApplied=!!screen;
  const entries:FrameEntry[]=[];let vertices=0,missing=0,segments=0,submitted=0,culled=0;
  const pointLayers=this.pointLod?.view(transform,this.dimensions,this.selected)??new Map();
  const drawnPointLayers=new Set<number>();
  this.lodStats.geometryMode='full';
  // Iterate the stable source order. Never use completion order for transparency.
  for(const c of this.selected){if(!this.enabled(c))continue;
   const aggregate=c.kind==='point'?pointLayers.get(c.layer):null;
   if(aggregate){
    this.lodStats.geometryMode='point-lod';
    if(!drawnPointLayers.has(c.layer)){drawnPointLayers.add(c.layer);entries.push({chunk:c,raw:aggregate});vertices+=aggregate.display.points;}
    continue;
   }
   const filtered=c.kind==='line'?screen?.get(c.id):undefined;
   if(filtered&&!filtered.packet.fallback){
    // Including empty filtered chunks: nothing needs drawing and no raw refill is needed.
    const counts=this.geometryMetadata.get(c.id);
    vertices+=counts?.points??c.rawVertices;segments+=counts?.segments??0;
    submitted+=filtered.packet.geometry.segmentCount??0;
    entries.push({chunk:c,filtered});continue;
   }
   const raw=this.cache.get(c.id);
   if(!raw){missing++;continue;}raw.used=++this.clock;entries.push({chunk:c,raw});vertices+=raw.display.points;
   segments+=raw.display.geometry.segmentCount??0;submitted+=raw.display.geometry.segmentCount??0;
  }
  Object.assign(this.lodStats,{drawnChunks:entries.filter(e=>(e.filtered?.packet.geometry.count??e.raw?.display.geometry.count??0)>0).length,displayVertices:vertices,
   missingChunks:missing,cacheBytes:this.cacheBytes,cacheEntries:this.cache.size,submittedSegments:submitted,
   candidateSegments:segments,culledSegments:0,workingSetOverBudgetBytes:Math.max(0,this.cacheBytes-CACHE_BYTES)});
  const labelFrame=this.labels(transform);
  const calls=this.gpu?.stats.drawCalls??0;
  if(backend==='canvas'){
   this.cpu.setTransform(transform);this.cpu.clear();
   for(const t of this.scene.tiles)this.cpu.drawRasterImage(t.image,t.bounds,1,true);
   for(const {chunk,raw,filtered} of entries){
    if(filtered){drawScreenPaths(this.canvas.getContext('2d')!,filtered.packet,this.paint(chunk),this.dimensions[2]);continue;}
    const {shapes,arcs}=raw!.display;
    if(chunk.kind==='point'){const icon=this.frameIcons.get(chunk.layer);if(icon)this.cpu.drawPointIcons(shapes,icon);else this.cpu.drawPoints(shapes,{color:`rgba(37,99,235,${this.pointPaint.color[3]})`,radius:this.pointPaint.radius});}
    else if(chunk.kind==='fill'&&arcs)this.cpu.drawPolygonFill(shapes,arcs,FILL_COLOR,undefined,.55);
    else if(arcs)this.cpu.drawArcs(arcs,{color:LINE_COLOR,width:this.paint(chunk).width});
   }
   if(labelFrame.labels.length)drawCanvasLabels(this.canvas.getContext('2d')!,labelFrame,this.dimensions[2]);
  }else{
   const gpu=this.gpu;if(!gpu)throw new Error(this.unavailableReason??'GPU unavailable');
   if(!gpu.begin(transform))throw new Error('GPU device unavailable');
   try{for(const t of this.scene.tiles)gpu.drawImage(t.image,t.bounds,1,true,undefined,true);
    for(const {chunk,raw,filtered} of entries){
      const paint=this.paint(chunk);
      if(filtered){if(filtered.mesh)gpu.drawMesh(filtered.mesh,{...paint,screenSpace:true});continue;}
      if(!raw?.mesh)continue;
      const icon=chunk.kind==='point'?this.frameIcons.get(chunk.layer):undefined;
      if(icon){gpu.drawPointIcons(raw.mesh,icon);continue;}
      const selected=this.pathCullingEnabled ? raw.rangeIndex?.select(transform,this.dimensions[0],this.dimensions[1],Math.max(8,(paint.width??1)*4+2)) : undefined;
      culled+=selected?.rejected??0;
      gpu.drawMesh(raw.mesh,paint,selected?.ranges);
    }gpu.drawLabels?.(labelFrame);overlay?.(gpu);
   }finally{gpu.end();}
  }
  this.lodStats.culledSegments=culled;this.lodStats.submittedSegments=submitted-culled;
  this.lodStats.frameDrawCalls=(this.gpu?.stats.drawCalls??0)-calls;
  return performance.now()-start;
 }
 /** Interactive navigation only. Raw A/B draw() never substitutes a bitmap. */
 drawInteractive(backend:Backend,transform:AffineTransform,overlay?:(gpu:GpuRenderer)=>void,allowPreview=true):number {
  if(this.disposed||this.preparing||!this.scene)return 0;
  this.pendingTransform=transform.clone();
  const key=JSON.stringify([this.generation,this.scene.dataset.editVersion??0,this.dimensions,backend,
    this.passMode,this.pointPaint,this.gpu?.pathMode,this.gpu?.circleOptimizationEnabled,this.pathCullingEnabled,
    this.pointLodEnabled,this.pointLodCellSize,this.smallArcFilterEnabled,this.halfPixelFilterEnabled]);
  if(!allowPreview){
    this.navigation.reset();this.requestView(transform);
    if(!this.editing&&(this.smallArcFilterEnabled||this.halfPixelFilterEnabled))this.screenPaths?.request(this.screenRequest(transform),this.selected);
    return this.drawScreenFrame(backend,transform,overlay);
  }
  if(this.navigation.preview(transform,key))return 0;
  this.requestView(transform);
  if(this.requiredRaw(transform).some(c=>!this.cache.has(c.id))&&this.navigation.hold(transform))return 0;
  const useScreen=!!this.screenPaths&&(this.smallArcFilterEnabled||this.halfPixelFilterEnabled);
  if(useScreen){
    const request=this.screenRequest(transform);
    this.screenPaths!.request(request,this.selected);
    if(!this.screenPaths!.get(request,this.selected)&&!this.screenPaths!.failed(request,this.selected)&&this.navigation.hold(transform))return 0;
  }
  const ms=this.drawScreenFrame(backend,transform,overlay);
  if(this.navigation.canCapture&&!this.lodStats.missingChunks)this.navigation.record(backend==='luma'?this.glCanvas:this.canvas,transform,key,ms,backend==='luma'?this.gpu?.waitForIdle():undefined);
  return ms;
 }
 async applyEdit(patch:CoordinatePatch,view:AffineTransform,signal:AbortSignal):Promise<number[]>{
  if(this.editing)throw new Error('A geometry revision is already being synchronized.');
  const source=this.source,generation=this.generation,start=performance.now();
  if(!source?.patch)throw new Error('Source cannot apply coordinate patches');
  const current=()=>{signal.throwIfAborted();if(this.disposed||generation!==this.generation||this.source!==source)throw new DOMException('Stale edit','AbortError');};
  const stage=new Map<number,Entry>();let committed=false;
  this.setView(view);this.editView=view.clone();this.editSelection=[...this.selected];this.editing=true;Object.assign(this.editStats,{pending:true,revision:patch.revision,patchMs:0,geometryMs:0,screenMs:0,totalMs:0,rebuiltChunks:0});
  this.pump?.abort();this.pump=null;this.signature='';this.screenPaths?.pause(true);
  try {
    // Old meshes and the old screen revision remain drawable during all awaits.
    await Promise.allSettled(this.building.values());current();
    let at=performance.now();const changed=await source.patch(patch,signal);current();
    this.editStats.patchMs=performance.now()-at;at=performance.now();
    this.pinned=new Set(changed.map(c=>c.id));
    for(const c of changed){current();await this.ensure(source,c,stage);}
    current();this.editStats.geometryMs=performance.now()-at;at=performance.now();
    const nextSelected=source.visible(view,this.dimensions[0],this.dimensions[1],this.pointSymbolPadding());
    if(patch.points.length){this.pointLod?.clear();await this.pointLod?.warm(view,this.dimensions,this.selected,signal);current();}
    if(this.screenEnabled())await this.screenPaths!.warmChanged({...this.screenRequest(view),revision:patch.revision},nextSelected,new Set(changed.map(c=>c.id)),signal);
    current();this.editStats.screenMs=performance.now()-at;
    // Synchronous handover: no blank frame, missing chunks or new fill/old outline mix.
    for(const [id,entry] of stage)this.install(id,entry);
    this.renderRevision=patch.revision;this.selected=nextSelected;committed=true;
    this.editStats.rebuiltChunks=changed.length;this.navigation.invalidateFrame();
    return changed.map(c=>c.id);
  } finally {
    if(!committed)for(const e of stage.values())if(e.mesh)this.gpu?.destroyMesh(e.mesh);
    if(generation===this.generation){
      this.pinned=null;this.editing=false;this.editView=null;this.editSelection=[];this.screenPaths?.pause(this.interacting);
      this.editStats.pending=false;this.editStats.totalMs=performance.now()-start;
      this.trim();this.invalidate();
    }
  }
 }
 private trim():void {
  if(this.cacheBytes<=CACHE_BYTES)return;
  const protectedIds=this.pinned??new Set(this.selected.map(c=>c.id));
  // Full polygon triangulation is much more expensive than a screen stroke.
  // Keep it before unused raw lines, without enlarging the byte budget or pinning
  // every fill unconditionally. Oversized fill working sets still use bounded LRU.
  const candidates=[...this.cache.entries()].filter(([id])=>!protectedIds.has(id)).sort((a,b)=>
    Number(a[1].display.chunk.kind==='fill')-Number(b[1].display.chunk.kind==='fill')||a[1].used-b[1].used);
  for(const [id,e] of candidates){if(this.cacheBytes<=CACHE_BYTES)break;if(e.mesh)this.gpu?.destroyMesh(e.mesh);
   this.cache.delete(id);this.cacheBytes-=e.display.bytes;this.lodStats.evictions++;}
 }
 show(backend:Backend):void {if(this.canvas.hidden!==(backend!=='canvas'))this.navigation.reset();this.canvas.hidden=backend!=='canvas';this.glCanvas.hidden=backend!=='luma';}
 clear():void {
  this.iconImages?.dispose();this.iconImages=null;this.frameIcons?.clear();this.cpu.clearIcons?.();
  this.labelManager?.dispose();this.labelManager=null;this.layerSpecs=[];this.gpu?.clearLabels?.();
  this.preparing=false;this.editing=false;this.editView=null;this.editSelection=[];this.frameEpoch++;this.renderRevision=0;this.editStats.pending=false;
  this.navigation.reset();this.screenPaths?.dispose();this.screenPaths=null;this.screenFilterApplied=false;
  this.pointLod?.clear();this.pointLod=null;
  this.lodStats.geometryMode='full';
  this.generation++;this.pump?.abort();this.pump=null;this.signature='';this.pendingTransform=null;
  for(const e of this.cache.values())if(e.mesh)this.gpu?.destroyMesh(e.mesh);
  this.cache.clear();this.geometryMetadata.clear();Object.assign(this.refillStats,{lineBuilds:0,fillBuilds:0,pointBuilds:0});this.building.clear();this.cacheBytes=0;this.selected=[];this.pinned=null;
  this.source?.dispose();this.source=null;this.scene=null;
  for(const key of Object.keys(this.lodStats) as (keyof typeof this.lodStats)[])if(key!=='geometryMode')this.lodStats[key]=0;
  this.cpu.clear();this.gpu?.clearImages();if(this.gpu?.begin(new AffineTransform()))this.gpu.end();
 }
 dispose():void {if(this.disposed)return;this.clear();this.disposed=true;this.navigation.dispose();this.gpu?.dispose();this.canvas.width=this.canvas.height=this.glCanvas.width=this.glCanvas.height=0;}
}

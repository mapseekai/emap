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
interface Entry {display:DisplayChunk;mesh:GpuMesh|null;used:number}
export class BenchmarkRenderers {
 readonly cpu:CanvasPainter;
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
  missingChunks:0,frameDrawCalls:0,workingSetOverBudgetBytes:0,submittedSegments:0};
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
  canvas.dataset.renderer='canvas2d';glCanvas.dataset.renderer=gpu?`luma-${gpu.backend==='webgpu'?'webgpu':'webgl2'}`:'unavailable';
 }
 resize(width:number,height:number,dpr:number):void {
  if(this.disposed||this.dimensions.every((v,i)=>v===[width,height,dpr][i]))return;
  this.dimensions=[width,height,dpr];this.cpu.setPixelRatio(dpr);this.cpu.resize(width,height);
  this.canvas.width=Math.max(1,Math.round(width*dpr));this.canvas.height=Math.max(1,Math.round(height*dpr));
  this.gpu?.resize(width,height,dpr);this.signature='';
 }
 async prepare(scene:Scene,signal:AbortSignal,initial?:AffineTransform,progress:(message:string)=>void=()=>{}):Promise<void>{
  this.clear();this.scene=scene;this.buildMs=0;this.uploadSubmitMs=0;
  const source=scene.lodSource??new FullGeometrySource(scene.dataset,[scene.bounds.xmin,scene.bounds.ymin,scene.bounds.xmax,scene.bounds.ymax]);
  this.source=source;const start=performance.now();await source.initialize(signal,progress);
  if(scene.dataset.layers.some(l=>l.geometry_type==='point')){
   this.pointLod=new PointLodRenderCache(source,scene.dataset,this.gpu,this.invalidate,this.report);
   this.pointLod.configure(this.pointLodEnabled,this.pointLodCellSize);
  }
  const [width,height]=this.dimensions;
  initial??=AffineTransform.fromBounds(scene.bounds.clone().fillOut(width/height),new Bounds(24,24,width-24,height-24),true);
  this.lodStats.totalChunks=source.chunks.length;this.lodStats.sourceVertices=scene.vertexCount;this.lodStats.sourceFeatures=scene.featureCount;
  this.setView(initial);this.pinned=new Set(source.chunks.map(c=>c.id));
  try {
   for(let i=0;i<source.chunks.length;i++){
    await lodYield(signal);await this.ensure(source,source.chunks[i]);
    if(i%16===0)progress(`准备全精度几何 ${i+1}/${source.chunks.length}（不化简、不抽稀）`);
   }
  } finally {this.pinned=null;}
  await this.pointLod?.warm(initial,this.dimensions,this.selected,signal);
  this.buildMs=performance.now()-start;this.signature='';
 }
 private async ensure(source:ChunkGeometryAccess,chunk:SpatialChunk):Promise<Entry>{
  const existing=this.cache.get(chunk.id);if(existing){existing.used=++this.clock;return existing;}
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
   const entry={display,mesh,used:++this.clock};this.cache.set(chunk.id,entry);
   this.cacheBytes+=display.bytes;this.lodStats.builds++;return entry;
  })().finally(()=>{if(this.building.get(chunk.id)===task)this.building.delete(chunk.id);});
  this.building.set(chunk.id,task);return task;
 }
 private setView(t:AffineTransform):void {
  if(!this.source)return;
  this.selected=this.source.visible(t,this.dimensions[0],this.dimensions[1],Math.max(8,(this.pointPaint.radius??3)+0.5));
  this.lodStats.visibleChunks=this.selected.length;
 }
 setInteracting(value:boolean):void {
  this.interacting=value;
  if(value){this.pump?.abort();this.pump=null;this.signature='';}
  else if(this.pendingTransform)this.requestView(this.pendingTransform);
 }
 requestView(transform:AffineTransform):void {
  this.pendingTransform=transform.clone();this.setView(transform);
  this.pointLod?.request(transform,this.dimensions,this.selected);
  if(this.interacting||!this.source||this.disposed)return;
  const signature=this.selected.map(c=>c.id).join(',');if(signature===this.signature)return;
  this.signature=signature;this.pump?.abort();
  const controller=new AbortController(),source=this.source,missing=this.selected.filter(c=>!this.cache.has(c.id));
  this.pump=controller;this.lodStats.pending=missing.length;
  if(!missing.length){this.pump=null;this.trim();return;}
  void(async()=>{
   for(const c of missing){await lodYield(controller.signal);await this.ensure(source,c);
    if(this.pump===controller)this.lodStats.pending--;this.invalidate();}
  })().catch(error=>{if(!controller.signal.aborted)this.report(error instanceof Error?error:new Error(String(error)));})
   .finally(()=>{if(this.pump===controller){this.pump=null;this.lodStats.pending=0;this.trim();this.invalidate();}});
 }
 async warmViews(views:readonly AffineTransform[],signal:AbortSignal):Promise<void>{
  this.pump?.abort();this.pump=null;const source=this.source;if(!source)return;
  const jobs=new Map<number,SpatialChunk>();
  for(const view of views)for(const c of source.visible(view,this.dimensions[0],this.dimensions[1],Math.max(8,(this.pointPaint.radius??3)+0.5)))jobs.set(c.id,c);
  this.pinned=new Set(jobs.keys());
  try{for(const c of jobs.values()){if(this.cache.has(c.id))continue;await lodYield(signal);await this.ensure(source,c);}}
  finally{this.pinned=null;}this.lodStats.pending=0;
  for(const view of views) await this.pointLod?.warm(view,this.dimensions,
   source.visible(view,this.dimensions[0],this.dimensions[1],Math.max(8,(this.pointPaint.radius??3)+0.5)),signal);
 }
 private paint(c:SpatialChunk):MeshPaint{return c.kind==='fill'?fillPaint:c.kind==='point'?this.pointPaint:
  this.scene?.dataset.layers[c.layer].geometry_type==='polygon'?outlinePaint:linePaint;}
 private enabled(c:SpatialChunk):boolean{return this.passMode==='all'||
  (this.passMode==='fill'&&c.kind==='fill')||(this.passMode==='stroke'&&c.kind==='line')||(this.passMode==='points'&&c.kind==='point');}
 draw(backend:Backend,transform:AffineTransform,overlay?:(gpu:GpuRenderer)=>void):number {
  if(this.disposed||!this.scene||!this.source)return 0;
  const start=performance.now();this.setView(transform);
  const entries:Entry[]=[];let vertices=0,missing=0,segments=0;
  const pointLayers=this.pointLod?.view(transform,this.dimensions,this.selected)??new Map();
  const drawnPointLayers=new Set<number>();
  this.lodStats.geometryMode='full';
  for(const c of this.selected){if(!this.enabled(c))continue;
   const aggregate=c.kind==='point'?pointLayers.get(c.layer):null;
   if(aggregate){
    this.lodStats.geometryMode='point-lod';
    if(!drawnPointLayers.has(c.layer)){drawnPointLayers.add(c.layer);entries.push(aggregate);vertices+=aggregate.display.points;}
    continue;
   }
   const entry=this.cache.get(c.id);
   if(!entry){missing++;continue;}entry.used=++this.clock;entries.push(entry);vertices+=entry.display.points;
   segments+=entry.display.geometry.segmentCount??0;
  }
  Object.assign(this.lodStats,{drawnChunks:entries.filter(e=>e.display.geometry.count).length,displayVertices:vertices,
   missingChunks:missing,cacheBytes:this.cacheBytes,cacheEntries:this.cache.size,submittedSegments:segments,
   workingSetOverBudgetBytes:Math.max(0,this.cacheBytes-CACHE_BYTES)});
  const calls=this.gpu?.stats.drawCalls??0;
  if(backend==='canvas'){
   this.cpu.setTransform(transform);this.cpu.clear();
   for(const t of this.scene.tiles)this.cpu.drawRasterImage(t.image,t.bounds,1,true);
   for(const {display} of entries){const {chunk,shapes,arcs}=display;
    if(chunk.kind==='point')this.cpu.drawPoints(shapes,{color:`rgba(37,99,235,${this.pointPaint.color[3]})`,radius:this.pointPaint.radius});
    else if(chunk.kind==='fill'&&arcs)this.cpu.drawPolygonFill(shapes,arcs,FILL_COLOR,undefined,.55);
    else if(arcs)this.cpu.drawArcs(arcs,{color:LINE_COLOR,width:this.paint(chunk).width});
   }
  }else{
   const gpu=this.gpu;if(!gpu)throw new Error(this.unavailableReason??'GPU unavailable');
   if(!gpu.begin(transform))throw new Error('GPU device unavailable');
   try{for(const t of this.scene.tiles)gpu.drawImage(t.image,t.bounds,1,true,undefined,true);
    for(const entry of entries)if(entry.mesh)gpu.drawMesh(entry.mesh,this.paint(entry.display.chunk));overlay?.(gpu);
   }finally{gpu.end();}
  }
  this.lodStats.frameDrawCalls=(this.gpu?.stats.drawCalls??0)-calls;
  return performance.now()-start;
 }
 async applyEdit(patch:CoordinatePatch,view:AffineTransform,signal:AbortSignal):Promise<number[]>{
  this.pump?.abort();this.pump=null;this.signature='';
  this.pointLod?.clear();
  await Promise.allSettled(this.building.values());signal.throwIfAborted();
  const source=this.source;if(!source||!source.patch)throw new Error('Source cannot apply coordinate patches');
  const changed=await source.patch(patch,signal);signal.throwIfAborted();
  for(const c of changed){const entry=this.cache.get(c.id);if(entry){if(entry.mesh)this.gpu?.destroyMesh(entry.mesh);this.cacheBytes-=entry.display.bytes;this.cache.delete(c.id);}}
  this.setView(view);this.pinned=new Set(changed.map(c=>c.id));
  try{for(const c of changed){await lodYield(signal);await this.ensure(source,c);}}finally{this.pinned=null;}
  await this.pointLod?.warm(view,this.dimensions,this.selected,signal);
  this.trim();return changed.map(c=>c.id);
 }
 private trim():void {
  if(this.cacheBytes<=CACHE_BYTES)return;
  const protectedIds=this.pinned??new Set(this.selected.map(c=>c.id));
  const candidates=[...this.cache.entries()].filter(([id])=>!protectedIds.has(id)).sort((a,b)=>a[1].used-b[1].used);
  for(const [id,e] of candidates){if(this.cacheBytes<=CACHE_BYTES)break;if(e.mesh)this.gpu?.destroyMesh(e.mesh);
   this.cache.delete(id);this.cacheBytes-=e.display.bytes;this.lodStats.evictions++;}
 }
 show(backend:Backend):void {this.canvas.hidden=backend!=='canvas';this.glCanvas.hidden=backend!=='luma';}
 clear():void {
  this.pointLod?.clear();this.pointLod=null;
  this.lodStats.geometryMode='full';
  this.generation++;this.pump?.abort();this.pump=null;this.signature='';this.pendingTransform=null;
  for(const e of this.cache.values())if(e.mesh)this.gpu?.destroyMesh(e.mesh);
  this.cache.clear();this.building.clear();this.cacheBytes=0;this.selected=[];this.pinned=null;
  this.source?.dispose();this.source=null;this.scene=null;
  for(const key of Object.keys(this.lodStats) as (keyof typeof this.lodStats)[])if(key!=='geometryMode')this.lodStats[key]=0;
  this.cpu.clear();this.gpu?.clearImages();if(this.gpu?.begin(new AffineTransform()))this.gpu.end();
 }
 dispose():void {if(this.disposed)return;this.clear();this.disposed=true;this.gpu?.dispose();this.canvas.width=this.canvas.height=this.glCanvas.width=this.glCanvas.height=0;}
}

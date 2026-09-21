import type { ChunkGeometryAccess, SpatialChunk } from '../../../../src/engine/rendering/luma/spatial-chunks';
import { emptyScreenPathStats, type ScreenPathPacket, type ScreenPathRequest } from '../../../../src/engine/rendering/luma/screen-paths';
import type { GpuMesh, GpuRenderer } from '../../../../src/integrations/luma/gpu-renderer';
import type { MeshPaint } from '../../../../src/integrations/luma/types';

export interface ScreenPathEntry { packet: ScreenPathPacket; mesh: GpuMesh | null }
type Job = { key: string; request: ScreenPathRequest; chunks: readonly SpatialChunk[]; epoch: number; reuse?: ReadonlyMap<number, ScreenPathEntry> };
const CACHE_BYTES = 128 * 1024 ** 2;
/** One coalesced view job. Never upload stale-view coordinates or build inside pointermove.
 * Screen-space snapping is translation- and DPR-dependent: exact view keys, no LOD buckets.
 */
export class ScreenPathCache {
  private entries = new Map<number, ScreenPathEntry>();
  private key = '';
  private preparedView = '';
  private desired: Job | null = null;
  private job: Promise<void> | null = null;
  private epoch = 0;
  private paused = false;
  private disposed = false;
  private failedKey = '';
  readonly stats = { ...emptyScreenPathStats(), pending: 0, builds: 0, uploads: 0,
    discardedJobs: 0, cacheBytes: 0, buildWallMs: 0, preparedViews: 0 };
  constructor(private source: ChunkGeometryAccess, private gpu: GpuRenderer | null,
    private invalidate: () => void, private report: (error: Error) => void) {}
  viewKey(request: ScreenPathRequest, chunks: readonly SpatialChunk[]): string {
    return JSON.stringify([request,chunks.filter(c=>c.kind==='line').map(c=>c.id)]);
  }
  get(request: ScreenPathRequest, chunks: readonly SpatialChunk[]): ReadonlyMap<number, ScreenPathEntry> | null {
    return this.key === this.viewKey(request,chunks) ? this.entries : null;
  }
  failed(request: ScreenPathRequest, chunks: readonly SpatialChunk[]): boolean {
    return this.failedKey === this.viewKey(request,chunks);
  }
  request(request: ScreenPathRequest, chunks: readonly SpatialChunk[]): void {
    if(this.disposed||this.paused||!this.source.buildScreenPaths)return;
    const key=this.viewKey(request,chunks);
    if(key===this.key||key===this.failedKey||key===this.desired?.key)return;
    this.desired={key,request,chunks:chunks.filter(c=>c.kind==='line'),epoch:++this.epoch};
    this.stats.pending=this.desired.chunks.length;
    this.pump();
  }
  pause(value: boolean): void {
    this.paused=value;
    if(value){this.epoch++;this.desired=null;this.stats.pending=0;}
  }
  async warm(request: ScreenPathRequest, chunks: readonly SpatialChunk[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if(this.paused||this.disposed)return;
    this.request(request,chunks);
    while(this.job){await this.job;signal.throwIfAborted();}
  }
  /** Keep unaffected same-view packets across a coordinate-only revision. A complete
   * replacement is staged first; never expose a mixture of old and new packets. */
  async warmChanged(request: ScreenPathRequest, chunks: readonly SpatialChunk[], changed: ReadonlySet<number>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const view=JSON.stringify({...request,revision:0});
    const reuse=this.preparedView===view ? new Map([...this.entries].filter(([id])=>!changed.has(id))) : new Map<number,ScreenPathEntry>();
    this.paused=false;
    this.desired={key:this.viewKey(request,chunks),request,chunks:chunks.filter(c=>c.kind==='line'),epoch:++this.epoch,reuse};
    this.stats.pending=this.desired.chunks.filter(c=>!reuse.has(c.id)).length;
    this.pump();
    while(this.job){await this.job;signal.throwIfAborted();}
    if(!this.get(request,chunks))throw new Error('Edited screen geometry did not finish for the requested revision.');
  }
  private release(entries: ReadonlyMap<number,ScreenPathEntry>): void {
    for(const e of entries.values())if(e.mesh)this.gpu?.destroyMesh(e.mesh);
  }
  private pump(): void {
    if(this.job||!this.desired||this.paused||this.disposed)return;
    const task=this.run().finally(()=>{if(this.job===task)this.job=null;if(this.desired&&!this.disposed&&!this.paused)this.pump();});
    this.job=task;
  }
  private async run(): Promise<void> {
    const desired=this.desired!;
    const stage=new Map<number,ScreenPathEntry>(), counts=emptyScreenPathStats();
    const current=()=>!this.disposed&&!this.paused&&desired.epoch===this.epoch;
    const started=performance.now();let bytes=0,committed=false;
    try {
      for(const chunk of desired.chunks){
        if(!current())return;
        const retained=desired.reuse?.get(chunk.id);
        if(retained){
          stage.set(chunk.id,retained);
          const p=retained.packet;
          bytes+=(retained.mesh?.bytes??p.geometry.vertices.byteLength)+p.coordinates.byteLength+p.offsets.byteLength+p.arcIds.byteLength;
          for(const name of Object.keys(counts) as (keyof typeof counts)[])counts[name]+=p.stats[name];
          continue;
        }
        const packet=await this.source.buildScreenPaths!(chunk,desired.request);
        if(!current())return;
        this.stats.builds++;
        let mesh:GpuMesh|null=null;
        const needed=packet.geometry.vertices.byteLength+packet.coordinates.byteLength+packet.offsets.byteLength+packet.arcIds.byteLength;
        if(!packet.fallback && bytes+needed>CACHE_BYTES){
          packet.fallback=true;packet.geometry.vertices=new Float32Array(0);packet.coordinates=new Float64Array(0);
          packet.offsets=new Uint32Array(0);packet.arcIds=new Uint32Array(0);packet.stats={...emptyScreenPathStats(),rawFallbackChunks:1};
        }
        if(!packet.fallback){
          mesh=this.gpu?.createMesh(packet.geometry)??null;
          bytes+=needed;if(mesh){this.stats.uploads++;packet.geometry.vertices=new Float32Array(0);}
          // No viewport-range index on CSS-space geometry; filtering was done before packing.
          delete packet.geometry.pathRanges;
        }
        stage.set(chunk.id,{packet,mesh});
        for(const name of Object.keys(counts) as (keyof typeof counts)[])counts[name]+=packet.stats[name];
        this.stats.pending--;
      }
      if(!current())return;
      this.release(new Map([...this.entries].filter(([id,e])=>stage.get(id)!==e)));this.entries=stage;this.key=desired.key;this.preparedView=JSON.stringify({...desired.request,revision:0});this.desired=null;this.failedKey='';committed=true;
      Object.assign(this.stats,counts,{cacheBytes:bytes,pending:0,buildWallMs:performance.now()-started});
      this.stats.preparedViews++;this.invalidate();
    } catch(error){
      if(current()){this.failedKey=desired.key;this.desired=null;this.stats.pending=0;
        this.report(error instanceof Error?error:new Error(String(error)));}
    } finally {
      if(!committed){this.release(new Map([...stage].filter(([id,e])=>desired.reuse?.get(id)!==e)));this.stats.discardedJobs++;}
    }
  }
  clear(): void {
    this.epoch++;this.desired=null;this.failedKey='';this.key='';this.preparedView='';this.release(this.entries);this.entries.clear();
    Object.assign(this.stats,emptyScreenPathStats(),{cacheBytes:0,pending:0});
  }
  dispose(): void {this.disposed=true;this.clear();}
}
/** Replays already-filtered Canvas commands without a second round of floating-point snapping. */
export function drawScreenPaths(ctx:CanvasRenderingContext2D,packet:ScreenPathPacket,paint:MeshPaint,dpr:number):void {
  if(packet.fallback)return;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.strokeStyle=`rgba(${paint.color[0]*255},${paint.color[1]*255},${paint.color[2]*255},${paint.color[3]})`;
  ctx.lineWidth=(paint.width??1)*dpr;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);
  let arcs=0,vertices=0;ctx.beginPath();
  for(let p=0;p+1<packet.offsets.length;p++){
    const start=packet.offsets[p],end=packet.offsets[p+1];if(end<=start)continue;
    if(arcs && (arcs>=100||vertices+end-start>12000)){ctx.stroke();ctx.beginPath();arcs=0;vertices=0;}
    ctx.moveTo(packet.coordinates[start*2],packet.coordinates[start*2+1]);
    for(let i=start+1;i<end;i++)ctx.lineTo(packet.coordinates[i*2],packet.coordinates[i*2+1]);
    arcs++;vertices+=end-start;
  }
  if(arcs)ctx.stroke();ctx.restore();
}

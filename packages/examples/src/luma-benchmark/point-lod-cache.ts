import { perspectiveActive } from '../../../../src/domain/geo/perspective-transform';
import { normalizePointShape } from '../../../../src/domain/source/layer-utils';
import type { AffineTransform } from '../../../../src/domain/geo/transform';
import type { MapshaperDataset } from '../../../../src/shared/types/mapshaper-types';
import type { GpuRenderer, GpuMesh } from '../../../../src/integrations/luma/gpu-renderer';
import type { ChunkGeometryAccess, DisplayChunk, SpatialChunk } from '../../../../src/engine/rendering/luma/spatial-chunks';
import { DEFAULT_LUMA_POINT_LOD_CELL_SIZE, validatePointLodCellSize,
  type PointLodRequest } from '../../../../src/engine/rendering/luma/point-lod-source';

export interface LodRenderEntry { display: DisplayChunk; mesh: GpuMesh | null; used: number }
interface LodView { key: string; request: PointLodRequest }
type LayerEntries = Map<number, LodRenderEntry | null>;
const MAX_CACHE_BYTES = 64 * 1024 ** 2;
/** Main-thread cache only. Grid construction and representative selection run in
 * the existing file Worker. Latest-view coalescing prevents a wheel gesture from
 * enqueuing one expensive build for every intermediate pointer event.
 */
export class PointLodRenderCache {
  enabled = true;
  cellSize = DEFAULT_LUMA_POINT_LOD_CELL_SIZE;
  private generation = 0;
  private clock = 0;
  private latest: LodView | null = null;
  private active: LayerEntries = new Map();
  private snapshots = new Map<string, LayerEntries>();
  private entries = new Map<string, LodRenderEntry>();
  private pending = new Map<string, Promise<LayerEntries>>();
  private tail: Promise<unknown> = Promise.resolve();
  private pumping = false;
  private held = new Set<LodRenderEntry>();
  readonly stats = { pending: 0, builds: 0, uploads: 0, cacheBytes: 0, cacheEntries: 0, evictions: 0 };
  constructor(private source: ChunkGeometryAccess, private dataset: MapshaperDataset,
    private gpu: GpuRenderer | null, private invalidate: () => void,
    private report: (error: Error) => void) {}

  configure(enabled: boolean, cellSize: number): void {
    validatePointLodCellSize(cellSize);
    if (this.enabled === enabled && this.cellSize === cellSize) return;
    this.clear(); this.enabled = enabled; this.cellSize = cellSize;
  }
  private describe(t: AffineTransform, dimensions: readonly number[], chunks: readonly SpatialChunk[]): LodView {
    const [width, height] = dimensions;
    // Use the near-side sampling scale, while retaining the existing world-anchored
    // grid and original feature/component identity. Visible chunks already use the camera footprint.
    const scale=perspectiveActive(t)?1/t.groundResolution():Math.max(Math.abs(t.mx),Math.abs(t.my));
    const mx=perspectiveActive(t)?Math.sign(t.mx)*scale:t.mx;
    const my=perspectiveActive(t)?Math.sign(t.my)*scale:t.my;
    const request: PointLodRequest = {
      transform: { mx, my, bx: t.bx, by: t.by }, width, height,
      cellSize: this.cellSize, visibleChunkIds: chunks.filter(c => c.kind === 'point').map(c => c.id),
      knownKeys: [],
    };
    // The existing LOD uses world-anchored binary scale cells. DPR and pan offset
    // do not change a global representative set; visible chunk IDs only control
    // the original policy's cheap-local-full-detail bypass at fine scales.
    const exponent = Math.floor(Math.log2(this.cellSize / scale));
    const key = [this.dataset.editVersion ?? 0, this.dataset.attributeVersion ?? 0,
      width, height, this.cellSize, exponent, ...request.visibleChunkIds].join(',');
    return { key, request };
  }
  view(t: AffineTransform, dimensions: readonly number[], chunks: readonly SpatialChunk[]): LayerEntries {
    if (!this.enabled) return new Map();
    const result = this.snapshots.get(this.describe(t, dimensions, chunks).key) ?? this.active;
    for (const entry of result.values()) if (entry) entry.used = ++this.clock;
    return result;
  }
  request(t: AffineTransform, dimensions: readonly number[], chunks: readonly SpatialChunk[]): void {
    if (!this.enabled || !this.source.queryPointLod) return;
    this.held.clear();
    const view = this.describe(t, dimensions, chunks);
    this.latest = view;
    const cached = this.snapshots.get(view.key);
    if (cached) { this.active = cached; this.stats.pending = 0; this.trim(); return; }
    this.stats.pending = 1;
    if (this.pumping) return;
    this.pumping = true;
    const generation = this.generation;
    void (async () => {
      while (generation === this.generation && this.latest) {
        const next = this.latest;
        const result = await this.ensure(next);
        if (generation !== this.generation) return;
        if (this.latest.key === next.key) {
          this.active = result; this.stats.pending = 0; this.trim(); this.invalidate(); return;
        }
      }
    })().catch(error => {
      if (generation === this.generation) { this.stats.pending = 0; this.report(error instanceof Error ? error : new Error(String(error))); }
    }).finally(() => { if (generation === this.generation) this.pumping = false; });
  }
  async warm(t: AffineTransform, dimensions: readonly number[], chunks: readonly SpatialChunk[], signal: AbortSignal): Promise<void> {
    if (!this.enabled || !this.source.queryPointLod) return;
    signal.throwIfAborted();
    const generation = this.generation;
    const result = await this.ensure(this.describe(t, dimensions, chunks));
    signal.throwIfAborted();
    if (generation !== this.generation) throw new DOMException('Stale point LOD', 'AbortError');
    if (!this.active.size) this.active = result;
    for (const entry of result.values()) if (entry) this.held.add(entry);
  }
  private ensure(view: LodView): Promise<LayerEntries> {
    const cached = this.snapshots.get(view.key); if (cached) return Promise.resolve(cached);
    const old = this.pending.get(view.key); if (old) return old;
    const generation = this.generation;
    const task = this.tail.catch(() => {}).then(async () => {
      if (generation !== this.generation) throw new DOMException('Stale point LOD', 'AbortError');
      const packets = await this.source.queryPointLod!({ ...view.request, knownKeys: [...this.entries.keys()] });
      if (generation !== this.generation) throw new DOMException('Stale point LOD', 'AbortError');
      const result: LayerEntries = new Map();
      for (const packet of packets) {
        if (packet.key === null) { result.set(packet.layer, null); continue; }
        let entry = this.entries.get(packet.key);
        if (!entry) {
          if (!packet.geometry || !packet.featureIds || !packet.componentIds ||
              packet.featureIds.length !== packet.count || packet.componentIds.length !== packet.count)
            throw new Error('Invalid point LOD packet.');
          const layer = this.dataset.layers[packet.layer];
          const points = Array.from(packet.featureIds, (id, i) => normalizePointShape(layer.shapes![id])[packet.componentIds![i]]);
          const mesh = this.gpu?.createMesh(packet.geometry) ?? null;
          const bytes = packet.geometry.vertices.byteLength + packet.count * 16;
          const chunk: SpatialChunk = { id: -1 - packet.layer, layer: packet.layer, kind: 'point',
            ids: packet.featureIds, bounds: [-Infinity, -Infinity, Infinity, Infinity], rawVertices: packet.sourcePoints };
          entry = { mesh, used: ++this.clock, display: { chunk, geometry: { ...packet.geometry, vertices: new Float32Array() },
            shapes: [points], arcs: null, paths: [], points: packet.count, bytes, omitted: 0, level: 0 } };
          this.entries.set(packet.key, entry); this.stats.cacheBytes += bytes;
          this.stats.builds++; if (mesh) this.stats.uploads++;
        }
        result.set(packet.layer, entry);
      }
      this.snapshots.set(view.key, result); this.stats.cacheEntries = this.entries.size;
      while (this.snapshots.size > 2048) this.snapshots.delete(this.snapshots.keys().next().value!);
      return result;
    }).finally(() => { if (this.pending.get(view.key) === task) this.pending.delete(view.key); });
    this.tail = task; this.pending.set(view.key, task); return task;
  }
  private trim(): void {
    const protectedEntries = new Set([...this.active.values(), ...this.held]);
    const candidates = [...this.entries.entries()].filter(([, e]) => !protectedEntries.has(e)).sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of candidates) {
      if (this.stats.cacheBytes <= MAX_CACHE_BYTES && this.entries.size <= 12) break;
      if (e.mesh) this.gpu?.destroyMesh(e.mesh);
      this.entries.delete(key); this.stats.cacheBytes -= e.display.bytes; this.stats.evictions++;
      for (const [viewKey, value] of this.snapshots) if ([...value.values()].includes(e)) this.snapshots.delete(viewKey);
    }
    this.stats.cacheEntries = this.entries.size;
  }
  clear(): void {
    this.generation++; this.latest = null; this.pumping = false; this.tail = Promise.resolve();
    for (const e of this.entries.values()) if (e.mesh) this.gpu?.destroyMesh(e.mesh);
    this.entries.clear(); this.snapshots.clear(); this.pending.clear(); this.active.clear(); this.held.clear();
    Object.assign(this.stats, { pending: 0, builds: 0, uploads: 0, cacheBytes: 0, cacheEntries: 0, evictions: 0 });
  }
}

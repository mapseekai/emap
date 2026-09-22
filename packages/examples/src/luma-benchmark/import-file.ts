import { groundBounds } from '../../../../src/domain/geo/perspective-transform';
import type { ScreenPathRequest, ScreenPathPacket } from '../../../../src/engine/rendering/luma/screen-paths';
import type { PointLodRequest, PointLodPacket } from '../../../../src/engine/rendering/luma/point-lod-source';
import type { CoordinatePatch } from '../../../../src/engine/rendering/luma/edit-patch';
import Flatbush from 'flatbush';
import {
  restoreTransferredArcs,
  getDefaultMapshaperAdapter,
} from '../../../../src/integrations/mapshaper/adapter';
import {
  unpackDisplayChunk,
  type DisplayPacket,
  type SpatialChunk,
  type ChunkGeometryAccess,
} from '../../../../src/engine/rendering/luma/spatial-chunks';
import type { AffineTransform } from '../../../../src/domain/geo/transform';
import type { Rect } from '../../../../src/integrations/luma/types';
import type {
  ArcVertexData,
  MapshaperDataset,
  MapshaperLayer,
} from '../../../../src/shared/types/mapshaper-types';
type Response = {
  type: string;
  id?: number;
  message?: string;
  bytes?: number;
  features?: number;
  result?: unknown;
  layers?: (Omit<MapshaperLayer, 'data'> & { records?: Record<string, unknown>[] })[];
  info?: MapshaperDataset['info'];
  arcs?: Pick<ArcVertexData, 'nn' | 'xx' | 'yy'>;
  buildMs?: number;
  triangulationStats?: Record<string, number>;
};

export class BenchmarkFileWorker implements ChunkGeometryAccess {
  readonly chunks: SpatialChunk[] = [];
  workerBuildMs = 0;
  triangulationStats: Record<string, number> = {};
  private index: InstanceType<typeof Flatbush> | null = null;
  private bounds: Rect = [0, 0, 1, 1];
  private serial = 0;
  private closed = false;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  private imported!: {
    resolve: (dataset: MapshaperDataset) => void;
    reject: (reason: unknown) => void;
  };
  constructor(
    private file: File,
    private worker: Worker,
    private progress: (message: string) => void,
  ) {
    worker.onerror = (error) => this.close(new Error(error.message));
    worker.onmessage = (event: MessageEvent<Response>) => {
      const data = event.data;
      if (data.type === 'progress')
        this.progress(
          `流式导入 ${file.name}：${(((data.bytes ?? 0) / file.size) * 100).toFixed(1)}% · ${(data.features ?? 0).toLocaleString()} 要素`,
        );
      else if (data.type === 'stage') this.progress(data.message ?? '构建显示缓存');
      else if (data.id !== undefined) {
        const request = this.pending.get(data.id);
        this.pending.delete(data.id);
        this.workerBuildMs += data.buildMs ?? 0;
        if(data.triangulationStats)this.triangulationStats=data.triangulationStats;
        if (data.type === 'error') request?.reject(new Error(data.message));
        else request?.resolve(data.result);
      } else if (data.type === 'error') this.imported.reject(new Error(data.message));
      else if (data.type === 'result') {
        try {
          const layers: MapshaperLayer[] = (data.layers ?? []).map(({ records, ...layer }) => ({
            ...layer,
            ...(records ? { data: getDefaultMapshaperAdapter().createDataTable(records) } : {}),
          }));
          this.imported.resolve({
            layers,
            info: data.info,
            ...(data.arcs ? { arcs: restoreTransferredArcs(data.arcs) } : {}),
          });
        } catch (error) {
          this.imported.reject(error);
        }
      }
    };
  }
  open(): Promise<MapshaperDataset> {
    return new Promise((resolve, reject) => {
      this.imported = { resolve, reject };
      this.worker.postMessage({
        file: this.file,
        vendorUrl: new URL(`${import.meta.env.BASE_URL}vendor/mapshaper-vendor.js`, location.href)
          .href,
      });
    });
  }
  setBounds(bounds: Rect): void {
    this.bounds = bounds;
  }
  private request(type: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new DOMException('Worker closed', 'AbortError'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type, id, ...args });
    });
  }
  async initialize(signal: AbortSignal, progress?: (message: string) => void): Promise<void> {
    signal.throwIfAborted();
    if (progress) this.progress = progress;
    this.chunks.length = 0;
    const chunks = (await this.request('initialize', { bounds: this.bounds })) as Omit<
      SpatialChunk,
      'ids'
    >[];
    signal.throwIfAborted();
    for (const chunk of chunks) this.chunks.push({ ...chunk, ids: new Uint32Array(0) });
    if (this.chunks.length) {
      this.index = new Flatbush(this.chunks.length);
      for (const chunk of this.chunks) this.index.add(...chunk.bounds);
      this.index.finish();
    }
  }
  visible(transform: AffineTransform, width: number, height: number, padding = 8): SpatialChunk[] {
    const ids: number[] = this.index?.search(...groundBounds(transform, width, height, padding)) ?? [];
    return ids.sort((a, b) => a - b).map((id) => this.chunks[id]);
  }
  level(_transform: AffineTransform): number { return 0; }
  async queryPointLod(pointView: PointLodRequest): Promise<PointLodPacket[]> {
    return await this.request('point-lod', { pointView }) as PointLodPacket[];
  }
  async buildScreenPaths(chunk: SpatialChunk, screenView: ScreenPathRequest): Promise<ScreenPathPacket> {
    return await this.request('screen-paths',{chunk:chunk.id,screenView}) as ScreenPathPacket;
  }
  async build(chunk: SpatialChunk, level: number) {
    const packet = (await this.request('build', { chunk: chunk.id, level })) as DisplayPacket;
    return unpackDisplayChunk(chunk, packet);
  }
  async patch(patch: CoordinatePatch, signal?: AbortSignal): Promise<SpatialChunk[]> {
    signal?.throwIfAborted();
    const changed = (await this.request('patch', { patch })) as Omit<SpatialChunk, 'ids'>[];
    for (const update of changed) Object.assign(this.chunks[update.id], update);
    if (this.chunks.length) {
      this.index = new Flatbush(this.chunks.length);
      for (const chunk of this.chunks) this.index.add(...chunk.bounds);
      this.index.finish();
    }
    signal?.throwIfAborted();
    return changed.map((chunk) => this.chunks[chunk.id]);
  }
  // The scene owns the Worker. Renderer cache resets (e.g. context restoration) only reset this index.
  dispose(): void {
    this.index = null;
    this.chunks.length = 0;
  }
  close(reason: unknown = new DOMException('Scene disposed', 'AbortError')): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.imported?.reject(reason);
    for (const task of this.pending.values()) task.reject(reason);
    this.pending.clear();
    this.dispose();
  }
}
export async function importBenchmarkFile(
  file: File,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  signal.throwIfAborted();
  const source = new BenchmarkFileWorker(
    file,
    new Worker(new URL('./import-worker.ts', import.meta.url), {
      type: 'module',
      name: 'emap-benchmark-data-lod',
    }),
    progress,
  );
  const abort = () => source.close(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    return { dataset: await source.open(), source };
  } catch (error) {
    source.close();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

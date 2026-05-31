import type {
  WebGLCoordinateOrigin,
  WebGLPointGeometry,
  WebGLPolygonTessellatedGeometry,
} from './geometry';
import type {
  WebGLArcChunkWorkerVertexData,
  WebGLArcSegmentChunk,
} from './cache';

interface WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transferList?: Transferable[]): void;
  terminate(): void;
}

type WorkerCtor = new (url: string) => WorkerLike;

export interface WebGLGeometryWorkerPoolOptions {
  workerUrl: string;
  WorkerCtor?: WorkerCtor;
}

interface PendingPointRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

type GeometryWorkerResponse =
  | {
    id: number;
    type: 'ok';
    geometryType: 'ack';
  }
  | {
    id: number;
    type: 'ok';
    geometryType: 'point';
    positions: Float32Array;
    vertexCount: number;
    origin: WebGLCoordinateOrigin;
  }
  | {
    id: number;
    type: 'error';
    message: string;
  }
  | {
    id: number;
    type: 'ok';
    geometryType: 'arc-chunks';
    chunks: WebGLArcSegmentChunk[];
  }
  | {
    id: number;
    type: 'ok';
    geometryType: 'polygon';
    geometry: WebGLPolygonTessellatedGeometry;
  };

export interface BuildArcSegmentChunksRequest {
  vertexData: WebGLArcChunkWorkerVertexData;
  arcIds: Uint32Array;
  origin: WebGLCoordinateOrigin;
  targetChunkArcCount: number;
  idPrefix: string;
}

export interface BuildPolygonTessellationRequest {
  shapes: any[];
  vertexData: WebGLArcChunkWorkerVertexData;
  flags?: Uint8Array | null;
  origin: WebGLCoordinateOrigin;
}

export interface RegisterSourceSnapshotRequest {
  id: string;
  shapes: any[];
  vertexData: WebGLArcChunkWorkerVertexData;
}

export interface RegisterPolygonMaskRequest {
  id: string;
  flags: Uint8Array;
}

export interface BuildPolygonChunkRequest {
  snapshotId: string;
  chunkId: string;
  featureIds: Uint32Array;
  flags?: Uint8Array | null;
  flagsId?: string | null;
  origin: WebGLCoordinateOrigin;
}

export class WebGLGeometryWorkerPool {
  private _WorkerCtor: WorkerCtor;
  private _worker: WorkerLike | null = null;
  private _pending = new Map<number, PendingPointRequest>();
  private _nextId = 1;
  private _destroyed = false;

  constructor(private _options: WebGLGeometryWorkerPoolOptions) {
    this._WorkerCtor = _options.WorkerCtor ?? (globalThis as any).Worker;
  }

  buildPointGeometry(
    shapes: any[],
    origin: WebGLCoordinateOrigin,
  ): Promise<WebGLPointGeometry> {
    if (this._destroyed) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: destroyed'));
    }
    if (!this._WorkerCtor) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: Worker unavailable'));
    }

    const worker = this._ensureWorker();
    const id = this._nextId++;
    return new Promise<WebGLPointGeometry>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: 'build-point-geometry',
        shapes,
        origin,
      });
    });
  }

  buildArcSegmentChunks(
    args: BuildArcSegmentChunksRequest,
  ): Promise<WebGLArcSegmentChunk[]> {
    if (this._destroyed) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: destroyed'));
    }
    if (!this._WorkerCtor) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: Worker unavailable'));
    }

    const worker = this._ensureWorker();
    const id = this._nextId++;
    return new Promise<WebGLArcSegmentChunk[]>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: 'build-arc-segment-chunks',
        vertexData: args.vertexData,
        arcIds: args.arcIds,
        origin: args.origin,
        targetChunkArcCount: args.targetChunkArcCount,
        idPrefix: args.idPrefix,
      });
    });
  }

  buildPolygonTessellation(
    args: BuildPolygonTessellationRequest,
  ): Promise<WebGLPolygonTessellatedGeometry> {
    if (this._destroyed) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: destroyed'));
    }
    if (!this._WorkerCtor) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: Worker unavailable'));
    }

    const worker = this._ensureWorker();
    const id = this._nextId++;
    return new Promise<WebGLPolygonTessellatedGeometry>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: 'build-polygon-tessellation',
        shapes: args.shapes,
        vertexData: args.vertexData,
        flags: args.flags,
        origin: args.origin,
      });
    });
  }

  registerSourceSnapshot(
    snapshot: RegisterSourceSnapshotRequest,
  ): Promise<void> {
    if (this._destroyed) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: destroyed'));
    }
    if (!this._WorkerCtor) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: Worker unavailable'));
    }

    const worker = this._ensureWorker();
    const id = this._nextId++;
    const { vertexData, transferList } = cloneVertexDataForTransfer(snapshot.vertexData);
    return new Promise<void>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: 'register-source-snapshot',
        snapshot: {
          id: snapshot.id,
          shapes: snapshot.shapes,
          vertexData,
        },
      }, transferList);
    });
  }

  registerPolygonMask(
    mask: RegisterPolygonMaskRequest,
  ): Promise<void> {
    if (this._destroyed) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: destroyed'));
    }
    if (!this._WorkerCtor) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: Worker unavailable'));
    }

    const worker = this._ensureWorker();
    const id = this._nextId++;
    const flags = new Uint8Array(mask.flags);
    return new Promise<void>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: 'register-polygon-mask',
        mask: {
          id: mask.id,
          flags,
        },
      }, [flags.buffer]);
    });
  }

  buildPolygonChunk(
    args: BuildPolygonChunkRequest,
  ): Promise<WebGLPolygonTessellatedGeometry> {
    if (this._destroyed) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: destroyed'));
    }
    if (!this._WorkerCtor) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: Worker unavailable'));
    }

    const worker = this._ensureWorker();
    const id = this._nextId++;
    return new Promise<WebGLPolygonTessellatedGeometry>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: 'build-polygon-chunk',
        snapshotId: args.snapshotId,
        chunkId: args.chunkId,
        featureIds: args.featureIds,
        flags: args.flags,
        flagsId: args.flagsId,
        origin: args.origin,
      });
    });
  }

  clearRetainedGeometry(): Promise<void> {
    if (this._destroyed) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: destroyed'));
    }
    if (!this._WorkerCtor) {
      return Promise.reject(new Error('WebGLGeometryWorkerPool: Worker unavailable'));
    }

    const worker = this._ensureWorker();
    const id = this._nextId++;
    return new Promise<void>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: 'clear-retained-geometry',
      });
    });
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._rejectAll(new Error('WebGLGeometryWorkerPool: destroyed'));
    this._worker?.terminate();
    this._worker = null;
  }

  private _ensureWorker(): WorkerLike {
    if (this._worker) return this._worker;
    const worker = new this._WorkerCtor(this._options.workerUrl);
    worker.onmessage = (event: MessageEvent) => this._handleMessage(event.data);
    worker.onerror = (event: ErrorEvent) => {
      this._rejectAll(new Error(event.message || 'WebGLGeometryWorkerPool: worker error'));
      worker.terminate();
      if (this._worker === worker) this._worker = null;
    };
    this._worker = worker;
    return worker;
  }

  private _handleMessage(data: GeometryWorkerResponse): void {
    const pending = this._pending.get(data.id);
    if (!pending) return;
    this._pending.delete(data.id);
    if (data.type === 'error') {
      pending.reject(new Error(data.message));
      return;
    }
    if (data.geometryType === 'ack') {
      pending.resolve(undefined);
    } else if (data.geometryType === 'point') {
      pending.resolve({
        positions: data.positions,
        vertexCount: data.vertexCount,
        origin: data.origin,
      });
    } else if (data.geometryType === 'arc-chunks') {
      pending.resolve(data.chunks);
    } else {
      pending.resolve(data.geometry);
    }
  }

  private _rejectAll(err: Error): void {
    for (const pending of this._pending.values()) pending.reject(err);
    this._pending.clear();
  }
}

function cloneVertexDataForTransfer(vertexData: WebGLArcChunkWorkerVertexData): {
  vertexData: WebGLArcChunkWorkerVertexData;
  transferList: Transferable[];
} {
  const copy: WebGLArcChunkWorkerVertexData = {
    xx: new Float64Array(vertexData.xx),
    yy: new Float64Array(vertexData.yy),
    nn: new (vertexData.nn.constructor as any)(vertexData.nn),
    ii: new (vertexData.ii.constructor as any)(vertexData.ii),
    bb: vertexData.bb ? new Float64Array(vertexData.bb) : null,
  };
  const transferList: Transferable[] = [
    copy.xx.buffer,
    copy.yy.buffer,
    copy.nn.buffer,
    copy.ii.buffer,
  ];
  if (copy.bb) transferList.push(copy.bb.buffer);
  return { vertexData: copy, transferList };
}

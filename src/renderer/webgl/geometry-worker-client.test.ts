import { describe, expect, it } from 'vitest';
import { WebGLGeometryWorkerPool } from './geometry-worker-client';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  transferLists: Transferable[][] = [];
  terminated = false;

  constructor(public url: string) {
    MockWorker.instances.push(this);
  }

  postMessage(message: unknown, transferList?: Transferable[]): void {
    this.posted.push(message);
    this.transferLists.push(transferList ?? []);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('WebGLGeometryWorkerPool', () => {
  it('round-trips point geometry requests through a worker', async () => {
    MockWorker.instances = [];
    const pool = new WebGLGeometryWorkerPool({
      workerUrl: 'emap-geometry-worker.js',
      WorkerCtor: MockWorker as any,
    });

    const result = pool.buildPointGeometry([[[4, 5], [6, 7]]], [4, 5]);
    const worker = MockWorker.instances[0];

    expect(worker.url).toBe('emap-geometry-worker.js');
    expect(worker.posted).toEqual([{
      id: 1,
      type: 'build-point-geometry',
      shapes: [[[4, 5], [6, 7]]],
      origin: [4, 5],
    }]);

    worker.onmessage?.({
      data: {
        id: 1,
        type: 'ok',
        geometryType: 'point',
        positions: new Float32Array([0, 0, 2, 2]),
        vertexCount: 2,
        origin: [4, 5],
      },
    } as MessageEvent);

    await expect(result).resolves.toEqual({
      positions: new Float32Array([0, 0, 2, 2]),
      vertexCount: 2,
      origin: [4, 5],
    });
  });

  it('rejects pending geometry requests when destroyed', async () => {
    MockWorker.instances = [];
    const pool = new WebGLGeometryWorkerPool({
      workerUrl: 'emap-geometry-worker.js',
      WorkerCtor: MockWorker as any,
    });

    const result = pool.buildPointGeometry([[[1, 2]]], [0, 0]);
    pool.destroy();

    await expect(result).rejects.toThrow('WebGLGeometryWorkerPool: destroyed');
    expect(MockWorker.instances[0].terminated).toBe(true);
  });

  it('round-trips arc chunk build requests through a worker', async () => {
    MockWorker.instances = [];
    const pool = new WebGLGeometryWorkerPool({
      workerUrl: 'emap-geometry-worker.js',
      WorkerCtor: MockWorker as any,
    });
    const vertexData = {
      xx: new Float64Array([0, 10]),
      yy: new Float64Array([0, 0]),
      nn: new Int32Array([2]),
      ii: new Int32Array([0]),
      bb: new Float64Array([0, 0, 10, 0]),
    };

    const result = pool.buildArcSegmentChunks({
      vertexData,
      arcIds: new Uint32Array([0]),
      origin: [0, 0],
      targetChunkArcCount: 1,
      idPrefix: '1:0',
    });
    const worker = MockWorker.instances[0];

    expect(worker.posted[0]).toEqual({
      id: 1,
      type: 'build-arc-segment-chunks',
      vertexData,
      arcIds: new Uint32Array([0]),
      origin: [0, 0],
      targetChunkArcCount: 1,
      idPrefix: '1:0',
    });

    const chunks = [{
      id: '1:0:0',
      bbox: [0, 0, 10, 0],
      arcIds: new Uint32Array([0]),
      geometry: {
        leftPositions: new Float32Array([0, 0]),
        startPositions: new Float32Array([0, 0]),
        endPositions: new Float32Array([10, 0]),
        rightPositions: new Float32Array([10, 0]),
        segmentTypes: new Uint8Array([3]),
        segmentTypesFloat: new Float32Array([3]),
        arcIds: new Uint32Array([0]),
        arcSegmentStarts: new Uint32Array([0]),
        arcSegmentCounts: new Uint32Array([1]),
        segmentCount: 1,
        origin: [0, 0],
      },
    }];
    worker.onmessage?.({
      data: {
        id: 1,
        type: 'ok',
        geometryType: 'arc-chunks',
        chunks,
      },
    } as MessageEvent);

    await expect(result).resolves.toEqual(chunks);
  });

  it('round-trips polygon tessellation requests through a worker', async () => {
    MockWorker.instances = [];
    const pool = new WebGLGeometryWorkerPool({
      workerUrl: 'emap-geometry-worker.js',
      WorkerCtor: MockWorker as any,
    });
    const vertexData = {
      xx: new Float64Array([0, 10, 10, 0]),
      yy: new Float64Array([0, 0, 10, 10]),
      nn: new Int32Array([4]),
      ii: new Int32Array([0]),
      bb: new Float64Array([0, 0, 10, 10]),
    };
    const flags = new Uint8Array([1]);

    const result = pool.buildPolygonTessellation({
      shapes: [[[0]]],
      vertexData,
      flags,
      origin: [0, 0],
    });
    const worker = MockWorker.instances[0];

    expect(worker.posted[0]).toEqual({
      id: 1,
      type: 'build-polygon-tessellation',
      shapes: [[[0]]],
      vertexData,
      flags,
      origin: [0, 0],
    });

    const geometry = {
      positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      vertexCount: 6,
      origin: [0, 0],
    };
    worker.onmessage?.({
      data: {
        id: 1,
        type: 'ok',
        geometryType: 'polygon',
        geometry,
      },
    } as MessageEvent);

    await expect(result).resolves.toEqual(geometry);
  });

  it('builds polygon chunks from a registered source snapshot without resending source geometry', async () => {
    MockWorker.instances = [];
    const pool = new WebGLGeometryWorkerPool({
      workerUrl: 'emap-geometry-worker.js',
      WorkerCtor: MockWorker as any,
    });
    const vertexData = {
      xx: new Float64Array([0, 10, 10, 0]),
      yy: new Float64Array([0, 0, 10, 10]),
      nn: new Int32Array([4]),
      ii: new Int32Array([0]),
      bb: new Float64Array([0, 0, 10, 10]),
    };
    const flags = new Uint8Array([1]);

    const registered = pool.registerSourceSnapshot({
      id: 'source:1',
      shapes: [[[0]]],
      vertexData,
    });
    const worker = MockWorker.instances[0];
    expect(worker.posted[0]).toEqual({
      id: 1,
      type: 'register-source-snapshot',
      snapshot: {
        id: 'source:1',
        shapes: [[[0]]],
        vertexData,
      },
    });
    expect(worker.transferLists[0]).toHaveLength(5);
    expect(worker.transferLists[0]).not.toContain(vertexData.xx.buffer);
    worker.onmessage?.({
      data: {
        id: 1,
        type: 'ok',
        geometryType: 'ack',
      },
    } as MessageEvent);
    await expect(registered).resolves.toBeUndefined();

    const result = pool.buildPolygonChunk({
      snapshotId: 'source:1',
      chunkId: 'chunk:0',
      featureIds: new Uint32Array([0]),
      flags,
      origin: [0, 0],
    });
    expect(worker.posted[1]).toEqual({
      id: 2,
      type: 'build-polygon-chunk',
      snapshotId: 'source:1',
      chunkId: 'chunk:0',
      featureIds: new Uint32Array([0]),
      flags,
      origin: [0, 0],
    });
    expect(JSON.stringify(worker.posted[1])).not.toContain('vertexData');
    expect(JSON.stringify(worker.posted[1])).not.toContain('shapes');

    const geometry = {
      positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      vertexCount: 6,
      origin: [0, 0],
    };
    worker.onmessage?.({
      data: {
        id: 2,
        type: 'ok',
        geometryType: 'polygon',
        geometry,
      },
    } as MessageEvent);

    await expect(result).resolves.toEqual(geometry);
  });

  it('registers polygon masks once and builds chunks by mask id', async () => {
    MockWorker.instances = [];
    const pool = new WebGLGeometryWorkerPool({
      workerUrl: 'emap-geometry-worker.js',
      WorkerCtor: MockWorker as any,
    });
    const flags = new Uint8Array([1, 0, 1]);

    const registered = pool.registerPolygonMask({
      id: 'mask:1',
      flags,
    });
    const worker = MockWorker.instances[0];
    expect(worker.posted[0]).toEqual({
      id: 1,
      type: 'register-polygon-mask',
      mask: {
        id: 'mask:1',
        flags,
      },
    });
    expect(worker.transferLists[0]).toHaveLength(1);
    expect(worker.transferLists[0]).not.toContain(flags.buffer);
    worker.onmessage?.({
      data: {
        id: 1,
        type: 'ok',
        geometryType: 'ack',
      },
    } as MessageEvent);
    await expect(registered).resolves.toBeUndefined();

    pool.buildPolygonChunk({
      snapshotId: 'source:1',
      chunkId: 'chunk:0',
      featureIds: new Uint32Array([0]),
      flagsId: 'mask:1',
      origin: [0, 0],
    });
    expect(worker.posted[1]).toEqual({
      id: 2,
      type: 'build-polygon-chunk',
      snapshotId: 'source:1',
      chunkId: 'chunk:0',
      featureIds: new Uint32Array([0]),
      flagsId: 'mask:1',
      origin: [0, 0],
    });
    expect(JSON.stringify(worker.posted[1])).not.toContain('flags":');
  });

  it('clears retained worker geometry snapshots', async () => {
    MockWorker.instances = [];
    const pool = new WebGLGeometryWorkerPool({
      workerUrl: 'emap-geometry-worker.js',
      WorkerCtor: MockWorker as any,
    });

    const cleared = pool.clearRetainedGeometry();
    const worker = MockWorker.instances[0];

    expect(worker.posted[0]).toEqual({
      id: 1,
      type: 'clear-retained-geometry',
    });
    worker.onmessage?.({
      data: {
        id: 1,
        type: 'ok',
        geometryType: 'ack',
      },
    } as MessageEvent);
    await expect(cleared).resolves.toBeUndefined();
  });
});

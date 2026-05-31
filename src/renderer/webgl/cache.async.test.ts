import { describe, expect, it, vi } from 'vitest';
import { WebGLGeometryCache } from './cache';
import type { WebGLArcSegmentChunk, WebGLPointGeometry } from './cache';
import type { WebGLPolygonTessellatedGeometry } from './geometry';

describe('WebGLGeometryCache async point geometry', () => {
  it('returns a placeholder while a worker builds large point geometry, then reuses the result', async () => {
    const geometry: WebGLPointGeometry = {
      positions: new Float32Array([0, 0, 2, 2]),
      vertexCount: 2,
      origin: [4, 5],
    };
    const worker = {
      buildPointGeometry: vi.fn().mockResolvedValue(geometry),
    };
    const onGeometryReady = vi.fn();
    const cache = new WebGLGeometryCache({ pointWorker: worker, onGeometryReady });
    const shapes = [[[4, 5], [6, 7]]];

    const pending = cache.getPointGeometry(shapes, 1, [4, 5], {
      async: true,
      minPointCount: 1,
    });

    expect(pending.vertexCount).toBe(0);
    expect(worker.buildPointGeometry).toHaveBeenCalledWith(shapes, [4, 5]);

    await vi.waitFor(() => expect(onGeometryReady).toHaveBeenCalledTimes(1));

    const cached = cache.getPointGeometry(shapes, 1, [4, 5], {
      async: true,
      minPointCount: 1,
    });

    expect(cached).toBe(geometry);
    expect(worker.buildPointGeometry).toHaveBeenCalledTimes(1);
  });

  it('keeps serving the previous point geometry while a newer revision rebuilds asynchronously', async () => {
    const oldGeometry: WebGLPointGeometry = {
      positions: new Float32Array([0, 0]),
      vertexCount: 1,
      origin: [4, 5],
    };
    const nextGeometry: WebGLPointGeometry = {
      positions: new Float32Array([1, 1]),
      vertexCount: 1,
      origin: [4, 5],
    };
    const worker = {
      buildPointGeometry: vi.fn().mockResolvedValue(nextGeometry),
    };
    const cache = new WebGLGeometryCache({ pointWorker: worker });
    const shapes = [[[4, 5]]];

    expect(cache.getPointGeometry(shapes, 1, [4, 5])).toEqual(oldGeometry);

    const stale = cache.getPointGeometry(shapes, 2, [4, 5], {
      async: true,
      minPointCount: 1,
    });

    expect(stale).toEqual(oldGeometry);

    await vi.waitFor(() => {
      expect(cache.getPointGeometry(shapes, 2, [4, 5])).toBe(nextGeometry);
    });
  });
});

describe('WebGLGeometryCache async arc chunks', () => {
  it('returns an empty chunk set while a worker builds line chunks, then reuses the result', async () => {
    const chunk: WebGLArcSegmentChunk = {
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
    };
    const arcChunkWorker = {
      buildArcSegmentChunks: vi.fn().mockResolvedValue([chunk]),
    };
    const onGeometryReady = vi.fn();
    const cache = new WebGLGeometryCache({ arcChunkWorker, onGeometryReady });
    const arcs = {
      size: () => 1,
      getPointCount: () => 2,
      getRetainedInterval: () => 0,
      getVertexData: () => ({
        xx: new Float64Array([0, 10]),
        yy: new Float64Array([0, 0]),
        zz: null,
        nn: new Int32Array([2]),
        ii: new Int32Array([0]),
        bb: new Float64Array([0, 0, 10, 0]),
      }),
      getArcIter: vi.fn(),
    };

    const pending = cache.getArcSegmentChunksForFlags(arcs as any, null, 1, {
      targetChunkArcCount: 1,
      async: true,
      minArcCount: 1,
    });

    expect(pending.chunks).toHaveLength(0);
    expect(arcChunkWorker.buildArcSegmentChunks).toHaveBeenCalledOnce();

    await vi.waitFor(() => expect(onGeometryReady).toHaveBeenCalledTimes(1));

    const cached = cache.getArcSegmentChunksForFlags(arcs as any, null, 1, {
      targetChunkArcCount: 1,
      async: true,
      minArcCount: 1,
    });

    expect(cached.chunks).toEqual([chunk]);
    expect(cached.search([0, -1, 20, 1])).toEqual([chunk]);
    expect(arcs.getArcIter).not.toHaveBeenCalled();
  });
});

describe('WebGLGeometryCache async polygon tessellation', () => {
  it('returns an empty fill while a worker tessellates complex flagged polygons, then reuses the result', async () => {
    const geometry: WebGLPolygonTessellatedGeometry = {
      positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      vertexCount: 6,
      origin: [0, 0],
    };
    const polygonWorker = {
      buildPolygonTessellation: vi.fn().mockResolvedValue(geometry),
    };
    const onGeometryReady = vi.fn();
    const cache = new WebGLGeometryCache({ polygonWorker, onGeometryReady });
    const arcs = {
      size: () => 2,
      getPointCount: () => 6,
      getRetainedInterval: () => 0,
      getVertexData: () => ({
        xx: new Float64Array([0, 10, 10, 0, 20, 30]),
        yy: new Float64Array([0, 0, 10, 10, 20, 20]),
        zz: null,
        nn: new Int32Array([4, 2]),
        ii: new Int32Array([0, 4]),
        bb: new Float64Array([0, 0, 10, 10, 20, 20, 30, 20]),
      }),
      getShapeIter: vi.fn(),
    };
    const shapes = [[[0]]];
    const flags = new Uint8Array([1, 0]);

    const pending = cache.getPolygonTessellationForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      { async: true, minPointCount: 1 },
    );

    expect(pending.vertexCount).toBe(0);
    expect(polygonWorker.buildPolygonTessellation).toHaveBeenCalledOnce();

    await vi.waitFor(() => expect(onGeometryReady).toHaveBeenCalledTimes(1));

    const cached = cache.getPolygonTessellationForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      { async: true, minPointCount: 1 },
    );

    expect(cached).toBe(geometry);
    expect(arcs.getShapeIter).not.toHaveBeenCalled();
  });

  it('registers polygon source snapshots once and builds chunks by snapshot id', async () => {
    const geometry: WebGLPolygonTessellatedGeometry = {
      positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      vertexCount: 6,
      origin: [0, 0],
    };
    const polygonWorker = {
      registerSourceSnapshot: vi.fn().mockResolvedValue(undefined),
      buildPolygonChunk: vi.fn().mockResolvedValue(geometry),
      buildPolygonTessellation: vi.fn().mockResolvedValue(geometry),
    };
    const onGeometryReady = vi.fn();
    const cache = new WebGLGeometryCache({ polygonWorker: polygonWorker as any, onGeometryReady });
    const arcs = {
      size: () => 2,
      getPointCount: () => 6,
      getRetainedInterval: () => 0,
      getVertexData: () => ({
        xx: new Float64Array([0, 10, 10, 0, 20, 30]),
        yy: new Float64Array([0, 0, 10, 10, 20, 20]),
        zz: null,
        nn: new Int32Array([4, 2]),
        ii: new Int32Array([0, 4]),
        bb: new Float64Array([0, 0, 10, 10, 20, 20, 30, 20]),
      }),
      getShapeIter: vi.fn(),
    };
    const shapes = [[[0]]];
    const flags = new Uint8Array([1, 0]);

    const pending = cache.getPolygonTessellationForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      { async: true, minPointCount: 1 },
    );

    expect(pending.vertexCount).toBe(0);
    expect(polygonWorker.registerSourceSnapshot).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(polygonWorker.buildPolygonChunk).toHaveBeenCalledOnce());
    expect(polygonWorker.buildPolygonChunk).toHaveBeenCalledOnce();
    expect(polygonWorker.buildPolygonTessellation).not.toHaveBeenCalled();
    expect(polygonWorker.buildPolygonChunk.mock.calls[0][0]).toEqual(expect.objectContaining({
      chunkId: 'all',
      featureIds: new Uint32Array([0]),
      flags,
      origin: [0, 0],
    }));
    expect(polygonWorker.buildPolygonChunk.mock.calls[0][0].snapshotId)
      .toBe(polygonWorker.registerSourceSnapshot.mock.calls[0][0].id);

    await vi.waitFor(() => expect(onGeometryReady).toHaveBeenCalledTimes(1));

    const cached = cache.getPolygonTessellationForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      { async: true, minPointCount: 1 },
    );

    expect(cached).toBe(geometry);
    expect(polygonWorker.registerSourceSnapshot).toHaveBeenCalledTimes(1);
    expect(polygonWorker.buildPolygonChunk).toHaveBeenCalledTimes(1);
  });

  it('registers polygon masks once and passes mask ids to chunk builds', async () => {
    const geometry: WebGLPolygonTessellatedGeometry = {
      positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      vertexCount: 6,
      origin: [0, 0],
    };
    const polygonWorker = {
      registerSourceSnapshot: vi.fn().mockResolvedValue(undefined),
      registerPolygonMask: vi.fn().mockResolvedValue(undefined),
      buildPolygonChunk: vi.fn().mockResolvedValue(geometry),
      buildPolygonTessellation: vi.fn(),
    };
    const cache = new WebGLGeometryCache({ polygonWorker: polygonWorker as any });
    const arcs = {
      size: () => 2,
      getPointCount: () => 6,
      getRetainedInterval: () => 0,
      getVertexData: () => ({
        xx: new Float64Array([0, 10, 10, 0, 20, 30]),
        yy: new Float64Array([0, 0, 10, 10, 20, 20]),
        zz: null,
        nn: new Int32Array([4, 2]),
        ii: new Int32Array([0, 4]),
        bb: new Float64Array([0, 0, 10, 10, 20, 20, 30, 20]),
      }),
    };
    const shapes = [[[0]]];
    const flags = new Uint8Array([1, 0]);

    cache.getPolygonTessellationChunksForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      [-5, -5, 20, 20],
      { async: true, minPointCount: 1, targetChunkFeatureCount: 1 },
    );

    expect(polygonWorker.registerPolygonMask).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(polygonWorker.buildPolygonChunk).toHaveBeenCalledOnce());
    expect(polygonWorker.buildPolygonChunk.mock.calls[0][0].flags).toBeUndefined();
    expect(polygonWorker.buildPolygonChunk.mock.calls[0][0].flagsId)
      .toBe(polygonWorker.registerPolygonMask.mock.calls[0][0].id);

    cache.getPolygonTessellationChunksForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      [-5, -5, 20, 20],
      { async: true, minPointCount: 1, targetChunkFeatureCount: 1 },
    );

    expect(polygonWorker.registerPolygonMask).toHaveBeenCalledTimes(1);
  });

  it('builds only visible polygon chunks from a retained source snapshot', async () => {
    const firstGeometry: WebGLPolygonTessellatedGeometry = {
      positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      vertexCount: 6,
      origin: [0, 0],
    };
    const secondGeometry: WebGLPolygonTessellatedGeometry = {
      positions: new Float32Array([100, 0, 110, 0, 110, 10, 100, 10]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      vertexCount: 6,
      origin: [0, 0],
    };
    const polygonWorker = {
      registerSourceSnapshot: vi.fn().mockResolvedValue(undefined),
      buildPolygonChunk: vi.fn()
        .mockResolvedValueOnce(firstGeometry)
        .mockResolvedValueOnce(secondGeometry),
      buildPolygonTessellation: vi.fn(),
    };
    const onGeometryReady = vi.fn();
    const cache = new WebGLGeometryCache({ polygonWorker: polygonWorker as any, onGeometryReady });
    const arcs = {
      size: () => 2,
      getPointCount: () => 8,
      getRetainedInterval: () => 0,
      getVertexData: () => ({
        xx: new Float64Array([0, 10, 10, 0, 100, 110, 110, 100]),
        yy: new Float64Array([0, 0, 10, 10, 0, 0, 10, 10]),
        zz: null,
        nn: new Int32Array([4, 4]),
        ii: new Int32Array([0, 4]),
        bb: new Float64Array([0, 0, 10, 10, 100, 0, 110, 10]),
      }),
    };
    const shapes = [[[0]], [[1]]];
    const flags = new Uint8Array([1, 1]);

    const firstPending = cache.getPolygonTessellationChunksForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      [-5, -5, 20, 20],
      { async: true, minPointCount: 1, targetChunkFeatureCount: 1 },
    );

    expect(firstPending.chunks).toEqual([]);
    expect(polygonWorker.registerSourceSnapshot).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(polygonWorker.buildPolygonChunk).toHaveBeenCalledOnce());
    expect(polygonWorker.buildPolygonChunk.mock.calls[0][0]).toEqual(expect.objectContaining({
      chunkId: expect.stringContaining(':0'),
      featureIds: new Uint32Array([0]),
      flags,
      origin: [0, 0],
    }));

    await vi.waitFor(() => expect(onGeometryReady).toHaveBeenCalledTimes(1));

    const firstVisible = cache.getPolygonTessellationChunksForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      [-5, -5, 20, 20],
      { async: true, minPointCount: 1, targetChunkFeatureCount: 1 },
    );

    expect(firstVisible.chunks.map(chunk => chunk.geometry)).toEqual([firstGeometry]);
    expect(polygonWorker.buildPolygonChunk).toHaveBeenCalledTimes(1);

    const secondPending = cache.getPolygonTessellationChunksForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      [90, -5, 120, 20],
      { async: true, minPointCount: 1, targetChunkFeatureCount: 1 },
    );

    expect(secondPending.chunks).toEqual([]);
    await vi.waitFor(() => expect(polygonWorker.buildPolygonChunk).toHaveBeenCalledTimes(2));
    expect(polygonWorker.buildPolygonChunk.mock.calls[1][0]).toEqual(expect.objectContaining({
      chunkId: expect.stringContaining(':1'),
      featureIds: new Uint32Array([1]),
      flags,
      origin: [0, 0],
    }));
    expect(polygonWorker.registerSourceSnapshot).toHaveBeenCalledTimes(1);
    expect(polygonWorker.buildPolygonTessellation).not.toHaveBeenCalled();
  });

  it('limits polygon chunk worker requests for one render pass', async () => {
    const polygonWorker = {
      registerSourceSnapshot: vi.fn().mockResolvedValue(undefined),
      buildPolygonChunk: vi.fn().mockResolvedValue({
        positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        vertexCount: 6,
        origin: [0, 0],
      }),
      buildPolygonTessellation: vi.fn(),
    };
    const cache = new WebGLGeometryCache({ polygonWorker: polygonWorker as any });
    const arcs = {
      size: () => 4,
      getPointCount: () => 16,
      getRetainedInterval: () => 0,
      getVertexData: () => ({
        xx: new Float64Array([
          0, 10, 10, 0,
          20, 30, 30, 20,
          40, 50, 50, 40,
          60, 70, 70, 60,
        ]),
        yy: new Float64Array([
          0, 0, 10, 10,
          0, 0, 10, 10,
          0, 0, 10, 10,
          0, 0, 10, 10,
        ]),
        zz: null,
        nn: new Int32Array([4, 4, 4, 4]),
        ii: new Int32Array([0, 4, 8, 12]),
        bb: new Float64Array([
          0, 0, 10, 10,
          20, 0, 30, 10,
          40, 0, 50, 10,
          60, 0, 70, 10,
        ]),
      }),
    };
    const shapes = [[[0]], [[1]], [[2]], [[3]]];
    const flags = new Uint8Array([1, 1, 1, 1]);

    cache.getPolygonTessellationChunksForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      [-5, -5, 80, 20],
      {
        async: true,
        minPointCount: 1,
        targetChunkFeatureCount: 1,
        maxChunkRequests: 2,
      },
    );

    await vi.waitFor(() => expect(polygonWorker.buildPolygonChunk).toHaveBeenCalledTimes(2));
    expect(polygonWorker.buildPolygonChunk.mock.calls.map(call => Array.from(call[0].featureIds)))
      .toEqual([[0], [1]]);
    expect(polygonWorker.buildPolygonTessellation).not.toHaveBeenCalled();
  });

  it('does not schedule polygon chunks beyond the visible cache budget', async () => {
    const polygonWorker = {
      registerSourceSnapshot: vi.fn().mockResolvedValue(undefined),
      buildPolygonChunk: vi.fn().mockResolvedValue({
        positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        vertexCount: 6,
        origin: [0, 0],
      }),
      buildPolygonTessellation: vi.fn(),
    };
    const cache = new WebGLGeometryCache({ polygonWorker: polygonWorker as any });
    const arcs = {
      size: () => 3,
      getPointCount: () => 12,
      getRetainedInterval: () => 0,
      getVertexData: () => ({
        xx: new Float64Array([0, 10, 10, 0, 20, 30, 30, 20, 40, 50, 50, 40]),
        yy: new Float64Array([0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 10, 10]),
        zz: null,
        nn: new Int32Array([4, 4, 4]),
        ii: new Int32Array([0, 4, 8]),
        bb: new Float64Array([0, 0, 10, 10, 20, 0, 30, 10, 40, 0, 50, 10]),
      }),
    };
    const shapes = [[[0]], [[1]], [[2]]];
    const flags = new Uint8Array([1, 1, 1]);

    cache.getPolygonTessellationChunksForFlags(
      shapes,
      arcs as any,
      flags,
      1,
      [-5, -5, 80, 20],
      {
        async: true,
        minPointCount: 1,
        targetChunkFeatureCount: 1,
        maxChunkRequests: 10,
        maxCachedChunks: 2,
      },
    );

    await vi.waitFor(() => expect(polygonWorker.buildPolygonChunk).toHaveBeenCalledTimes(2));
    expect(polygonWorker.buildPolygonChunk.mock.calls.map(call => Array.from(call[0].featureIds)))
      .toEqual([[0], [1]]);
  });

  it('clears retained worker polygon snapshots on full invalidation', () => {
    const polygonWorker = {
      buildPolygonTessellation: vi.fn(),
      clearRetainedGeometry: vi.fn().mockResolvedValue(undefined),
    };
    const cache = new WebGLGeometryCache({ polygonWorker: polygonWorker as any });

    cache.invalidateAll();

    expect(polygonWorker.clearRetainedGeometry).toHaveBeenCalledOnce();
  });
});

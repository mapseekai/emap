import { describe, expect, it, vi } from 'vitest';
import { WebGLGeometryCache } from './cache';

function makeArcIter(points: Array<[number, number]>) {
  let i = -1;
  return {
    x: 0,
    y: 0,
    hasNext() {
      i++;
      const p = points[i];
      if (!p) return false;
      this.x = p[0];
      this.y = p[1];
      return true;
    },
  };
}

function makeArcs() {
  let retainedInterval = 0;
  const getArcIter = vi.fn(() => makeArcIter([[0, 0], [1, 0], [1, 1]]));
  return {
    size: () => 1,
    getPointCount: () => 3,
    getRetainedInterval: () => retainedInterval,
    setRetainedInterval: (value: number) => { retainedInterval = value; },
    getArcIter,
  };
}

function makeChunkedArcs() {
  const points: Array<Array<[number, number]>> = [
    [[0, 0], [10, 0]],
    [[20, 0], [30, 0]],
    [[100, 0], [110, 0]],
    [[120, 0], [130, 0]],
  ];
  const bb = new Float64Array([
    0, 0, 10, 0,
    20, 0, 30, 0,
    100, 0, 110, 0,
    120, 0, 130, 0,
  ]);
  const getArcIter = vi.fn((arcId: number) => makeArcIter(points[arcId]));
  return {
    size: () => points.length,
    getPointCount: () => points.length * 2,
    getRetainedInterval: () => 0,
    getVertexData: () => ({
      xx: new Float64Array(points.flat().map(p => p[0])),
      yy: new Float64Array(points.flat().map(p => p[1])),
      zz: null,
      nn: new Int32Array(points.map(p => p.length)),
      ii: new Int32Array([0, 2, 4, 6]),
      bb,
    }),
    getArcIter,
  };
}

describe('WebGLGeometryCache', () => {
  it('reuses point geometry for stable point shapes and origin', () => {
    const cache = new WebGLGeometryCache();
    const shapes = [[[1, 2], [3, 4]]];

    const first = cache.getPointGeometry(shapes, 0, [0, 0]);
    const second = cache.getPointGeometry(shapes, 0, [0, 0]);

    expect(second).toBe(first);
    expect(Array.from(first.positions)).toEqual([1, 2, 3, 4]);
  });

  it('uses the first point as the default point geometry origin', () => {
    const cache = new WebGLGeometryCache();
    const shapes = [[[1_000_000, 2_000_000], [1_000_010, 2_000_020]]];

    const geometry = cache.getPointGeometry(shapes);

    expect(geometry.origin).toEqual([1_000_000, 2_000_000]);
    expect(Array.from(geometry.positions)).toEqual([0, 0, 10, 20]);
  });

  it('rebuilds point geometry when the local coordinate origin changes', () => {
    const cache = new WebGLGeometryCache();
    const shapes = [[[1_000_001, 2_000_002]]];

    const first = cache.getPointGeometry(shapes, 0, [0, 0]);
    const second = cache.getPointGeometry(shapes, 0, [1_000_000, 2_000_000]);

    expect(second).not.toBe(first);
    expect(Array.from(second.positions)).toEqual([1, 2]);
  });

  it('rebuilds point geometry when the render revision changes', () => {
    const cache = new WebGLGeometryCache();
    const shapes = [[[1, 2]]];

    const first = cache.getPointGeometry(shapes, 1, [0, 0]);
    const second = cache.getPointGeometry(shapes, 2, [0, 0]);

    expect(second).not.toBe(first);
  });

  it('reuses arc segment geometry for a stable arc collection and revision', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();

    const first = cache.getArcSegments(arcs as any, 1);
    const second = cache.getArcSegments(arcs as any, 1);

    expect(second).toBe(first);
    expect(arcs.getArcIter).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when the render revision changes', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();

    const first = cache.getArcSegments(arcs as any, 1);
    const second = cache.getArcSegments(arcs as any, 2);

    expect(second).not.toBe(first);
    expect(arcs.getArcIter).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when retained interval changes', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();

    const first = cache.getArcSegments(arcs as any, 1);
    arcs.setRetainedInterval(0.5);
    const second = cache.getArcSegments(arcs as any, 1);

    expect(second).not.toBe(first);
    expect(arcs.getArcIter).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when the local coordinate origin changes', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();

    const first = cache.getArcSegments(arcs as any, 1, [0, 0]);
    const second = cache.getArcSegments(arcs as any, 1, [100, 200]);

    expect(second).not.toBe(first);
    expect(arcs.getArcIter).toHaveBeenCalledTimes(2);
    expect(Array.from(second.startPositions)).toEqual([-100, -200, -99, -200]);
  });

  it('drops a specific arc collection on invalidation', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();

    const first = cache.getArcSegments(arcs as any, 1);
    cache.invalidateArcs(arcs as any);
    const second = cache.getArcSegments(arcs as any, 1);

    expect(second).not.toBe(first);
    expect(arcs.getArcIter).toHaveBeenCalledTimes(2);
  });

  it('reuses filtered arc segment geometry for stable layer flags', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();
    const flags = new Uint8Array([1]);

    const first = cache.getArcSegmentsForFlags(arcs as any, flags, 1);
    const second = cache.getArcSegmentsForFlags(arcs as any, flags, 1);

    expect(second).toBe(first);
    expect(arcs.getArcIter).toHaveBeenCalledTimes(1);
  });

  it('reuses filtered arc segment geometry for a stable filter function', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();
    const filter = (arcId: number) => arcId === 0;

    const first = cache.getArcSegmentsForFilter(arcs as any, filter, 1);
    const second = cache.getArcSegmentsForFilter(arcs as any, filter, 1);

    expect(second).toBe(first);
    expect(arcs.getArcIter).toHaveBeenCalledTimes(1);
  });

  it('rebuilds function-filtered arc segments when the render revision changes', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();
    const filter = (arcId: number) => arcId === 0;

    const first = cache.getArcSegmentsForFilter(arcs as any, filter, 1);
    const second = cache.getArcSegmentsForFilter(arcs as any, filter, 2);

    expect(second).not.toBe(first);
    expect(arcs.getArcIter).toHaveBeenCalledTimes(2);
  });

  it('returns base arc segment geometry when layer flags include every arc', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();
    const flags = new Uint8Array([1]);

    const base = cache.getArcSegments(arcs as any, 1);
    const flagged = cache.getArcSegmentsForFlags(arcs as any, flags, 1);

    expect(flagged).toBe(base);
  });

  it('builds retained spatial arc chunks and queries them by bbox', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeChunkedArcs();
    const flags = new Uint8Array([1, 1, 1, 1]);

    const first = cache.getArcSegmentChunksForFlags(arcs as any, flags, 1, {
      targetChunkArcCount: 2,
    });
    const second = cache.getArcSegmentChunksForFlags(arcs as any, flags, 1, {
      targetChunkArcCount: 2,
    });

    expect(second).toBe(first);
    expect(first.chunks).toHaveLength(2);
    expect(first.search([0, -1, 40, 1]).map(chunk => chunk.id)).toEqual(['1:1:0']);
    expect(first.search([90, -1, 140, 1]).map(chunk => chunk.id)).toEqual(['1:1:1']);
    expect(arcs.getArcIter).toHaveBeenCalledTimes(4);
  });

  it('reuses polygon tessellation for stable shapes and arc revision', () => {
    const cache = new WebGLGeometryCache();
    const points: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const getShapeIter = vi.fn(() => makeArcIter(points));
    const arcs = {
      size: () => 1,
      getPointCount: () => points.length,
      getRetainedInterval: () => 0,
      getShapeIter,
    };
    const shapes = [[[0]]];

    const first = cache.getPolygonTessellation(shapes, arcs as any, 1);
    const second = cache.getPolygonTessellation(shapes, arcs as any, 1);

    expect(second).toBe(first);
    expect(getShapeIter).toHaveBeenCalledTimes(1);
  });

  it('reuses polygon tessellation for stable arc visibility flags', () => {
    const cache = new WebGLGeometryCache();
    const points: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const getShapeIter = vi.fn(() => makeArcIter(points));
    const arcs = {
      size: () => 2,
      getPointCount: () => points.length,
      getRetainedInterval: () => 0,
      getShapeIter,
    };
    const shapes = [[[0], [1]]];
    const flags = new Uint8Array([1, 0]);

    const first = cache.getPolygonTessellationForFlags(shapes, arcs as any, flags, 1);
    const second = cache.getPolygonTessellationForFlags(shapes, arcs as any, flags, 1);

    expect(second).toBe(first);
    expect(getShapeIter).toHaveBeenCalledTimes(1);
  });
});

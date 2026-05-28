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

describe('WebGLGeometryCache', () => {
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

  it('returns base arc segment geometry when layer flags include every arc', () => {
    const cache = new WebGLGeometryCache();
    const arcs = makeArcs();
    const flags = new Uint8Array([1]);

    const base = cache.getArcSegments(arcs as any, 1);
    const flagged = cache.getArcSegmentsForFlags(arcs as any, flags, 1);

    expect(flagged).toBe(base);
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
});

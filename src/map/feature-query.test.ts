import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FeatureQuery } from './feature-query';
import { AffineTransform } from '../geo/transform';

/**
 * FeatureQuery's spatial-index path is exercised through Emap-level tests
 * elsewhere. This file pins the index correctness in isolation: build it
 * by hand on a small fixture, run `_getOrBuildIndex` directly via Reflect,
 * and assert search() returns the right shape ids.
 */

function setPrivate(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

function callPrivate<T>(target: any, name: string, ...args: unknown[]): T {
  return target[name](...args);
}

interface MockArcs {
  size: () => number;
  getSimpleShapeBbox: (parts: number[], out: number[]) => void;
}

/** Tiny mock arcs that returns hard-coded bboxes per arc id. */
function makeMockArcs(arcBboxes: number[][]): MockArcs {
  return {
    size: () => arcBboxes.length,
    getSimpleShapeBbox: (parts: number[], out: number[]) => {
      // `parts` is an array of (signed) arc ids. Compute union of those
      // arcs' bboxes.
      let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
      for (const raw of parts) {
        const id = raw >= 0 ? raw : ~raw;
        const bb = arcBboxes[id];
        if (!bb) continue;
        if (bb[0] < xmin) xmin = bb[0];
        if (bb[1] < ymin) ymin = bb[1];
        if (bb[2] > xmax) xmax = bb[2];
        if (bb[3] > ymax) ymax = bb[3];
      }
      out[0] = xmin; out[1] = ymin; out[2] = xmax; out[3] = ymax;
    },
  };
}

function makeFeatureQuery(): FeatureQuery {
  const sources = new Map();
  return new FeatureQuery(
    sources,
    () => new AffineTransform(1, 0, 0, 1),
    () => ({ width: 100, height: 100 }),
    () => 1,
  );
}

describe('FeatureQuery._getOrBuildIndex', () => {
  let fq: FeatureQuery;
  beforeEach(() => {
    fq = makeFeatureQuery();
  });

  it('returns null for shape-less layers', () => {
    const result = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, { shapes: [] }, undefined);
    expect(result).toBeNull();

    const result2 = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, {}, undefined);
    expect(result2).toBeNull();
  });

  it('returns null for layers with undefined shapes', () => {
    const result = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, { shapes: undefined }, undefined);
    expect(result).toBeNull();
  });

  it('builds an index for a point layer based on coord union per shape', () => {
    const layer = {
      geometry_type: 'point',
      shapes: [
        [[0, 0]],         // shape 0: single point at origin
        [[10, 10]],       // shape 1: single point
        [[5, 5], [15, 15]], // shape 2: multipoint
      ],
    };
    const result = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, undefined);
    expect(result).not.toBeNull();
    expect(result.shapeCount).toBe(3);

    // Query bbox covering only shape 0
    const a = result.index.search(-1, -1, 1, 1);
    expect(a.sort()).toEqual([0]);

    // Query bbox covering shapes 1 and 2
    const b = result.index.search(8, 8, 16, 16);
    expect(b.sort()).toEqual([1, 2]);

    // Query bbox covering everything
    const c = result.index.search(-1, -1, 20, 20);
    expect(c.sort()).toEqual([0, 1, 2]);
  });

  it('builds an index for a path layer using arc bboxes', () => {
    const arcs = makeMockArcs([
      [0, 0, 5, 5],   // arc 0
      [10, 10, 20, 20], // arc 1
      [50, 50, 60, 60], // arc 2
    ]);
    const layer = {
      geometry_type: 'polyline',
      shapes: [
        [[0]],         // shape 0 uses arc 0
        [[1]],         // shape 1 uses arc 1
        [[0, 1]],      // shape 2 spans arcs 0 + 1 (one part with two arcs)
        [[2]],         // shape 3 uses arc 2
      ],
    };
    const result = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs);
    expect(result).not.toBeNull();

    // Bbox over arc 0 only finds shapes 0 and 2
    const a = result.index.search(-1, -1, 6, 6);
    expect(a.sort()).toEqual([0, 2]);

    // Bbox over arc 1 finds shapes 1 and 2
    const b = result.index.search(11, 11, 19, 19);
    expect(b.sort()).toEqual([1, 2]);

    // Bbox over arc 2 finds only shape 3
    const c = result.index.search(55, 55, 56, 56);
    expect(c.sort()).toEqual([3]);
  });

  it('null shape entries get a degenerate placeholder bbox', () => {
    const arcs = makeMockArcs([[0, 0, 5, 5]]);
    const layer = {
      geometry_type: 'polyline',
      shapes: [
        [[0]],
        null,        // null shape
        [[0]],
      ],
    };
    const result = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer as any, arcs);
    expect(result).not.toBeNull();

    // Query that doesn't touch (0, 0) — null shape's degenerate placeholder
    // is at the origin, so it's filtered.
    const a = result.index.search(2, 2, 4, 4);
    expect(a.sort()).toEqual([0, 2]);
  });

  it('caches by (source, layer, shapeCount, arcCount)', () => {
    const arcs = makeMockArcs([[0, 0, 5, 5]]);
    const layer = {
      geometry_type: 'polyline',
      shapes: [[[0]]],
    };
    const a = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs);
    const b = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs);
    expect(a).toBe(b); // same instance — cache hit
  });

  it('cache invalidates when shape count changes', () => {
    const arcs = makeMockArcs([[0, 0, 5, 5]]);
    const layer1 = { geometry_type: 'polyline', shapes: [[[0]]] };
    const layer2 = { geometry_type: 'polyline', shapes: [[[0]], [[0]]] };

    const a = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer1, arcs);
    const b = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer2, arcs);
    expect(a).not.toBe(b);
    expect(a.shapeCount).toBe(1);
    expect(b.shapeCount).toBe(2);
  });

  it('cache invalidates when arc count changes', () => {
    const arcs1 = makeMockArcs([[0, 0, 5, 5]]);
    const arcs2 = makeMockArcs([[0, 0, 5, 5], [10, 10, 20, 20]]);
    const layer = { geometry_type: 'polyline', shapes: [[[0]]] };

    const a = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs1);
    const b = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs2);
    expect(a).not.toBe(b);
  });

  it('cache is partitioned per (sourceId, layerIndex)', () => {
    const arcs = makeMockArcs([[0, 0, 5, 5]]);
    const layer = { geometry_type: 'polyline', shapes: [[[0]]] };

    const a = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs);
    const b = callPrivate<any>(fq, '_getOrBuildIndex', 'src2', 0, layer, arcs);
    const c = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 1, layer, arcs);

    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});

describe('FeatureQuery.clear', () => {
  let fq: FeatureQuery;
  beforeEach(() => {
    fq = makeFeatureQuery();
  });

  function buildSomeIndexes(): void {
    const arcs = makeMockArcs([[0, 0, 5, 5]]);
    const layer = { geometry_type: 'polyline', shapes: [[[0]]] };
    callPrivate(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs);
    callPrivate(fq, '_getOrBuildIndex', 'src1', 1, layer, arcs);
    callPrivate(fq, '_getOrBuildIndex', 'src2', 0, layer, arcs);
  }

  function cacheSize(): number {
    return (Reflect.get(fq, '_indexCache') as Map<string, unknown>).size;
  }

  it('clear() with no arg drops everything', () => {
    buildSomeIndexes();
    expect(cacheSize()).toBe(3);
    fq.clear();
    expect(cacheSize()).toBe(0);
  });

  it('clear(sourceId) drops only that source\'s entries', () => {
    buildSomeIndexes();
    expect(cacheSize()).toBe(3);
    fq.clear('src1');
    expect(cacheSize()).toBe(1); // only src2 remains
  });

  it('clear(unknownSourceId) is a safe no-op', () => {
    buildSomeIndexes();
    fq.clear('nonexistent');
    expect(cacheSize()).toBe(3);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FeatureQuery } from './feature-query';
import { AffineTransform } from '../../domain/geo/transform';

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
      let xmin = Infinity,
        ymin = Infinity,
        xmax = -Infinity,
        ymax = -Infinity;
      for (const raw of parts) {
        const id = raw >= 0 ? raw : ~raw;
        const bb = arcBboxes[id];
        if (!bb) continue;
        if (bb[0] < xmin) xmin = bb[0];
        if (bb[1] < ymin) ymin = bb[1];
        if (bb[2] > xmax) xmax = bb[2];
        if (bb[3] > ymax) ymax = bb[3];
      }
      out[0] = xmin;
      out[1] = ymin;
      out[2] = xmax;
      out[3] = ymax;
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
    const result = callPrivate<any>(
      fq,
      '_getOrBuildIndex',
      'src1',
      0,
      { shapes: undefined },
      undefined,
    );
    expect(result).toBeNull();
  });

  it('builds an index for a point layer based on coord union per shape', () => {
    const layer = {
      geometry_type: 'point',
      shapes: [
        [[0, 0]], // shape 0: single point at origin
        [[10, 10]], // shape 1: single point
        [
          [5, 5],
          [15, 15],
        ], // shape 2: multipoint
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
      [0, 0, 5, 5], // arc 0
      [10, 10, 20, 20], // arc 1
      [50, 50, 60, 60], // arc 2
    ]);
    const layer = {
      geometry_type: 'polyline',
      shapes: [
        [[0]], // shape 0 uses arc 0
        [[1]], // shape 1 uses arc 1
        [[0, 1]], // shape 2 spans arcs 0 + 1 (one part with two arcs)
        [[2]], // shape 3 uses arc 2
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
        null, // null shape
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
    const arcs2 = makeMockArcs([
      [0, 0, 5, 5],
      [10, 10, 20, 20],
    ]);
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
    const cache = Reflect.get(fq, '_indexCache') as Map<string, Map<number, unknown>>;
    let size = 0;
    for (const layers of cache.values()) size += layers.size;
    return size;
  }

  it('clear() with no arg drops everything', () => {
    buildSomeIndexes();
    expect(cacheSize()).toBe(3);
    fq.clear();
    expect(cacheSize()).toBe(0);
  });

  it("clear(sourceId) drops only that source's entries", () => {
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

  it('clear(sourceId) preserves a delimiter-bearing sibling source cache', () => {
    const arcs = makeMockArcs([[0, 0, 5, 5]]);
    const layer = { geometry_type: 'polyline', shapes: [[[0]]] };
    callPrivate(fq, '_getOrBuildIndex', 'src', 0, layer, arcs);
    const sibling = callPrivate(fq, '_getOrBuildIndex', 'src|nested', 0, layer, arcs);

    fq.clear('src');

    expect(callPrivate(fq, '_getOrBuildIndex', 'src|nested', 0, layer, arcs)).toBe(sibling);
  });
});

// ===========================================================================
// Regression: editVersion-keyed cache invalidation
//
// Bug history (commit b40493d): vertex-edit-control mutated arcs in place
// (via adapter.snapVertices) without bumping `dataset.editVersion`. The
// spatial-index cache key includes editVersion, so the cache stayed valid
// against the OLD bbox. Hovering into the newly-expanded area produced no
// hit because Flatbush.search prefiltered the polygon out by stale bbox.
//
// These tests pin the cache-key invalidation contract in isolation:
//   - same dataset shape + arcs.size + layer.shapes.length
//   - editVersion bump → fresh index with current arc bboxes
// so a future refactor that loses the editVersion path fails loudly.
// ===========================================================================

describe('FeatureQuery editVersion cache invalidation (regression)', () => {
  it('rebuilds the index when editVersion changes (same shape/arc counts)', () => {
    const fq = makeFeatureQuery();
    // Mutable arcs holder so we can change bbox between queries.
    const arcBboxes = [[0, 0, 10, 10]];
    const arcs = makeMockArcs(arcBboxes);
    const layer = {
      geometry_type: 'polygon',
      shapes: [[[0]]], // one polygon using one arc
    };

    // First build at editVersion=0
    const dataset0 = { editVersion: 0 };
    const indexed0 = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs, dataset0);
    expect(indexed0.index.search(2, 2, 8, 8).sort()).toEqual([0]);
    // Probe outside the original bbox — should miss
    expect(indexed0.index.search(50, 50, 60, 60)).toEqual([]);

    // Simulate vertex drag expanding the arc's bbox in place (what
    // `adapter.snapVertices` does live during a drag).
    arcBboxes[0] = [0, 0, 100, 100];

    // Without editVersion bump, the cache returns the OLD index — the
    // bug we're guarding against.
    const indexedStale = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs, dataset0);
    expect(indexedStale).toBe(indexed0); // same reference, no rebuild
    expect(indexedStale.index.search(50, 50, 60, 60)).toEqual([]); // still miss

    // With editVersion bump, the index rebuilds and now sees (50,50).
    const dataset1 = { editVersion: 1 };
    const indexed1 = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs, dataset1);
    expect(indexed1).not.toBe(indexed0);
    expect(indexed1.index.search(50, 50, 60, 60).sort()).toEqual([0]);
  });

  it('drops stale entries (other editVersions for same source/layer) on rebuild', () => {
    const fq = makeFeatureQuery();
    const arcBboxes = [[0, 0, 10, 10]];
    const arcs = makeMockArcs(arcBboxes);
    const layer = { geometry_type: 'polygon', shapes: [[[0]]] };

    // Build at v=0, then v=1, then v=2. Each rebuild should evict the
    // previous (sourceId, layerIndex) entries so the cache doesn't grow
    // without bound across many in-place edits.
    callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs, { editVersion: 0 });
    callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs, { editVersion: 1 });
    callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs, { editVersion: 2 });
    const cache = Reflect.get(fq, '_indexCache') as Map<string, Map<number, unknown>>;
    // Only the latest entry should remain for this (source,layer) pair.
    expect(cache.get('src1')?.size).toBe(1);
  });

  it('treats undefined editVersion as 0 (back-compat path)', () => {
    const fq = makeFeatureQuery();
    const arcs = makeMockArcs([[0, 0, 10, 10]]);
    const layer = { geometry_type: 'polygon', shapes: [[[0]]] };

    const a = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs, undefined);
    const b = callPrivate<any>(fq, '_getOrBuildIndex', 'src1', 0, layer, arcs, {
      /* no editVersion */
    });
    expect(a).toBe(b); // same cache key
  });
});

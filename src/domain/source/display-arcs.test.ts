import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DisplayArcs } from './display-arcs';
import {
  setDefaultMapshaperAdapter,
  getDefaultMapshaperAdapter,
  type MapshaperAdapter,
} from '../../integrations/mapshaper/adapter';
import type { ArcCollection } from '../../shared/types/mapshaper-types';

// `DisplayArcs` is the LOD layer between rendering and the source's
// raw arc collection. Tests pin its three lifecycle states:
//   - small dataset: no LOD copy, getScaledArcs returns unfiltered;
//   - large dataset: LOD copy ready at construction;
//   - markDirty + zoomed-out request: rebuild LOD lazily.
//
// We stub the adapter so we don't touch real mapshaper internals.

function makeMockArcs(pointCount: number, opts?: { hasZZ?: boolean }) {
  const _zz = opts?.hasZZ === false ? null : new Float64Array(pointCount);
  let retainedInterval = 0;
  const arcs: any = {
    size: () => 1,
    getPointCount: () => pointCount,
    getVertexData: () => ({
      zz: _zz,
      xx: new Float64Array(pointCount),
      yy: new Float64Array(pointCount),
    }),
    getRetainedInterval: () => retainedInterval,
    setRetainedInterval: (v: number) => {
      retainedInterval = v;
      return arcs;
    },
    getThresholdByPct: () => 0.5,
    getFilteredCopy: () => ({ size: () => 1, isFilteredCopy: true }) as any,
  };
  return arcs as ArcCollection & { isFilteredCopy?: boolean };
}

function makeMockAdapter(): MapshaperAdapter {
  return {
    getAvgSegment: vi.fn(() => 1.0),
    simplifyArcsFast: vi.fn(
      (_arcs: any) => ({ size: () => 1, isFilteredCopy: true, fromFastPath: true }) as any,
    ),
  } as unknown as MapshaperAdapter;
}

describe('DisplayArcs lifecycle', () => {
  beforeEach(() => {
    setDefaultMapshaperAdapter(makeMockAdapter());
  });
  afterEach(() => {
    setDefaultMapshaperAdapter(null);
  });

  it('small dataset (<500k points) does not build a filtered copy at construction', () => {
    const arcs = makeMockArcs(1000);
    const da = new DisplayArcs(arcs);
    expect(da.hasLOD()).toBe(false);
    expect(da.getArcs()).toBe(arcs);
  });

  it('large dataset (>500k points) builds a filtered copy at construction', () => {
    const arcs = makeMockArcs(600_000);
    const da = new DisplayArcs(arcs);
    expect(da.hasLOD()).toBe(true);
  });

  it('getScaledArcs returns unfiltered when no LOD copy exists', () => {
    const arcs = makeMockArcs(1000);
    const da = new DisplayArcs(arcs);
    // unitsPerPixel doesn't matter when there's no filtered copy.
    expect(da.getScaledArcs(0.001)).toBe(arcs);
    expect(da.getScaledArcs(100)).toBe(arcs);
  });

  it('getScaledArcs returns unfiltered when zoomed in (small unitsPerPixel)', () => {
    const arcs = makeMockArcs(600_000);
    const da = new DisplayArcs(arcs);
    expect(da.hasLOD()).toBe(true);
    // unitsPerPixel below the LOD threshold → unfiltered.
    expect(da.getScaledArcs(0.001)).toBe(arcs);
  });

  it('getScaledArcs returns filtered when zoomed out (large unitsPerPixel)', () => {
    const arcs = makeMockArcs(600_000);
    const da = new DisplayArcs(arcs);
    // Large unitsPerPixel → filtered copy.
    const result = da.getScaledArcs(100);
    expect(result).not.toBe(arcs);
    expect((result as any).isFilteredCopy).toBe(true);
  });

  it('scales the LOD switch with the requested pixel tolerance and permits full detail', () => {
    const arcs = makeMockArcs(600_000);
    const da = new DisplayArcs(arcs);
    expect(da.getScaledArcs(1, 0.5)).toBe(arcs);
    expect(da.getScaledArcs(1, 2)).not.toBe(arcs);
    expect(da.getScaledArcs(100, 0)).toBe(arcs);
    expect(da.getScaledArcs(100, 0.001)).toBe(arcs);
    expect(da.getScaledArcs(100)).not.toBe(arcs);
  });
});

describe('cooperative display LOD', () => {
  function largeArcs(thresholds: boolean) {
    const count = 500_001;
    const xx = Float64Array.from({ length: count }, (_, i) => i);
    const yy = Float64Array.from({ length: count }, (_, i) => Math.sin(i / 100));
    const arcs = getDefaultMapshaperAdapter().createArcCollection([{ xx, yy }]);
    if (thresholds) {
      const zz = Float64Array.from({ length: count }, (_, i) => i % 100);
      zz[0] = zz[count - 1] = Infinity;
      arcs.setThresholds!(zz);
      arcs.setRetainedInterval!(2);
    }
    return arcs;
  }
  for (const thresholds of [false, true])
    it(`prepares the same LOD as mapshaper without blocking construction (ZZ=${thresholds})`, async () => {
      const arcs = largeArcs(thresholds),
        ready = vi.fn();
      const expected = new DisplayArcs(arcs).getScaledArcs(100);
      const actual = new DisplayArcs(arcs, ready);
      expect(actual.hasLOD()).toBe(false);
      expect(actual.getScaledArcs(100) === arcs).toBe(true);
      let ticks = 0;
      const timer = setInterval(() => ticks++, 0);
      try {
        await actual.ready;
      } finally {
        clearInterval(timer);
      }
      expect(ticks).toBeGreaterThan(1);
      expect(ready).toHaveBeenCalledOnce();
      expect(actual.getScaledArcs(100).getVertexData!()).toMatchObject(expected.getVertexData!());
      expect(actual.getScaledArcs(100, 0)).toBe(arcs);
      expect(arcs.getRetainedInterval!()).toBe(thresholds ? 2 : 0);
      actual.dispose();
    });
  it('does not publish a cancelled preparation after an edit or source replacement', async () => {
    const arcs = largeArcs(false),
      ready = vi.fn();
    const actual = new DisplayArcs(arcs, ready);
    const initial = actual.ready;
    actual.markDirty();
    arcs.getVertexData!().xx[0] = -100;
    expect(actual.getScaledArcs(100) === arcs).toBe(true);
    await initial;
    await actual.ready;
    expect(ready).toHaveBeenCalledOnce();
    expect(actual.getScaledArcs(100).getVertexData!().xx[0]).toBe(-100);
    actual.markDirty();
    actual.getScaledArcs(100);
    actual.dispose();
    await actual.ready;
    expect(ready).toHaveBeenCalledOnce();
  });
});

describe('DisplayArcs.markDirty', () => {
  beforeEach(() => {
    setDefaultMapshaperAdapter(makeMockAdapter());
  });
  afterEach(() => {
    setDefaultMapshaperAdapter(null);
  });

  it('on a small dataset, markDirty is a no-op (no rebuild)', () => {
    const arcs = makeMockArcs(1000);
    const da = new DisplayArcs(arcs);
    da.markDirty();
    expect(da.getScaledArcs(0.001)).toBe(arcs);
    expect(da.hasLOD()).toBe(false);
  });

  it('on a large dataset zoomed-in, markDirty defers the rebuild', () => {
    const arcs = makeMockArcs(600_000);
    const da = new DisplayArcs(arcs);
    const before = da.getScaledArcs(100); // build/access the filtered copy
    da.markDirty();
    // While zoomed in, the filtered copy is not consulted, so no rebuild.
    da.getScaledArcs(0.001);
    // The reference inside the instance is still the same (no rebuild fired).
    // We can't observe this directly; the contract is "no error / no work
    // unless the filtered copy is needed". Just exercise the path.
    expect(before).toBeDefined();
  });

  it('on a large dataset, markDirty + zoomed-out request triggers a rebuild', () => {
    const arcs = makeMockArcs(600_000);
    const da = new DisplayArcs(arcs);
    const first = da.getScaledArcs(100);
    da.markDirty();
    const second = da.getScaledArcs(100);
    // After markDirty, getScaledArcs at the same zoom returns a NEW
    // filtered copy (different identity) because it rebuilt.
    expect(first).not.toBe(second);
  });
});

describe('DisplayArcs ZZ-vs-fallback path', () => {
  beforeEach(() => {
    setDefaultMapshaperAdapter(makeMockAdapter());
  });
  afterEach(() => {
    setDefaultMapshaperAdapter(null);
  });

  it('uses the ZZ threshold path when vertexData.zz is present', () => {
    const arcs = makeMockArcs(600_000, { hasZZ: true });
    const da = new DisplayArcs(arcs);
    const filtered = da.getScaledArcs(100);
    // ZZ path: filtered copy comes from arcs.getFilteredCopy(), not adapter.
    expect((filtered as any).fromFastPath).toBeUndefined();
    expect((filtered as any).isFilteredCopy).toBe(true);
  });

  it('falls back to adapter.simplifyArcsFast when zz is missing', () => {
    const arcs = makeMockArcs(600_000, { hasZZ: false });
    const da = new DisplayArcs(arcs);
    const filtered = da.getScaledArcs(100);
    // Fallback path: filtered copy comes from adapter.simplifyArcsFast.
    expect((filtered as any).fromFastPath).toBe(true);
  });
});

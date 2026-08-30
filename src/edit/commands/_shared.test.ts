import { describe, expect, it, vi } from 'vitest';
import type { MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { ArcCollection } from '../../types/mapshaper-types';
import { appendArcsCompat } from './_shared';

function legacyAdapter(appendArc = vi.fn()) {
  return {
    appendArc,
    adapter: { appendArc } as unknown as MapshaperAdapter,
  };
}

function arcsWithFlatness(size: number, isFlat: boolean): ArcCollection {
  // These fallback tests exercise only the two ArcCollection methods used here.
  return { size: () => size, isFlat: () => isFlat } as unknown as ArcCollection;
}

describe('appendArcsCompat', () => {
  it('rejects simplification thresholds for a non-flat legacy collection without mutation', () => {
    const arcs = arcsWithFlatness(1, false);
    const { adapter, appendArc } = legacyAdapter();

    expect(() =>
      appendArcsCompat(adapter, arcs, [
        {
          xx: new Float64Array([1, 2]),
          yy: new Float64Array([3, 4]),
          zz: new Float64Array([5, 6]),
        },
      ]),
    ).toThrow(
      'appendArcs: legacy adapter without appendArcs cannot preserve simplification thresholds; implement appendArcs/truncateArcs or flatten the collection',
    );
    expect(appendArc).not.toHaveBeenCalled();
  });

  it('rejects mismatched coordinate buffers before legacy fallback mutation', () => {
    const arcs = arcsWithFlatness(1, true);
    const { adapter, appendArc } = legacyAdapter();

    expect(() =>
      appendArcsCompat(adapter, arcs, [
        { xx: new Float64Array([1, 2]), yy: new Float64Array([3]) },
      ]),
    ).toThrow('appendArcs: arc at index 0 has mismatched buffer lengths (xx=2, yy=1, zz=none)');
    expect(appendArc).not.toHaveBeenCalled();
  });

  it('appends zz-less arcs through the legacy fallback on a flat collection', () => {
    const arcs = arcsWithFlatness(4, true);
    const { adapter, appendArc } = legacyAdapter();

    expect(
      appendArcsCompat(adapter, arcs, [
        { xx: new Float64Array([1, 2]), yy: new Float64Array([3, 4]) },
      ]),
    ).toBe(4);
    expect(appendArc).toHaveBeenCalledWith(arcs, [
      [1, 3],
      [2, 4],
    ]);
  });
});

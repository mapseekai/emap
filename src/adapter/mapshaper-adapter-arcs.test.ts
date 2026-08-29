import mapshaper from 'mapshaper';
import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from './mapshaper-adapter';

// Mock ArcCollection mirroring split-shared-arcs.test.ts: tracks vertex data
// plus retained interval / flatness so the batch APIs can be asserted against
// real adapter behavior without importing mapshaper internals.
function makeArcs(options?: { withZz?: boolean }) {
  let nn = new Int32Array([2, 2]);
  let xx = new Float64Array([0, 0, 1, 1]);
  let yy = new Float64Array([0, 1, 1, 0]);
  let zz: Float64Array | null = options?.withZz ? new Float64Array([5, 5, 5, 5]) : null;
  let retained = 0;
  const arcs = {
    size: () => nn.length,
    isFlat: () => zz === null,
    getRetainedInterval: () => retained,
    setRetainedInterval: (v: number) => {
      retained = v;
    },
    getVertexData: () => {
      const ii = new Int32Array(nn.length);
      let cursor = 0;
      for (let i = 0; i < nn.length; i++) {
        ii[i] = cursor;
        cursor += nn[i]!;
      }
      return { xx, yy, zz, nn, ii, bb: null };
    },
    updateVertexData(newNn: Int32Array, newXx: Float64Array, newYy: Float64Array, newZz: Float64Array | null) {
      nn = newNn;
      xx = newXx;
      yy = newYy;
      zz = newZz;
      retained = 0; // mapshaper resets `_zlimit` only when the new zz is null; this flat mock always does.
    },
  } as any;
  return {
    arcs,
    state: () => ({ nn, xx, yy, zz, retained }),
  };
}

describe('MapshaperAdapter.appendArcs / truncateArcs', () => {
  it('appends multiple arcs in one call and returns the first new arc id', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    const first = adapter.appendArcs(arcs, [
      { xx: new Float64Array([2, 3]), yy: new Float64Array([2, 3]) },
      { xx: new Float64Array([4]), yy: new Float64Array([4]) },
    ]);
    expect(first).toBe(2);
    expect(Array.from(state().nn)).toEqual([2, 2, 2, 1]);
    expect(Array.from(state().xx)).toEqual([0, 0, 1, 1, 2, 3, 4]);
  });

  it('preserves the retained interval across append and truncate', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    arcs.setRetainedInterval(42);
    adapter.appendArcs(arcs, [{ xx: new Float64Array([9]), yy: new Float64Array([9]) }]);
    expect(state().retained).toBe(42);
    adapter.truncateArcs(arcs, 2);
    expect(state().retained).toBe(42);
  });

  it('fills Infinity zz for appended arcs missing zz when the collection keeps thresholds', () => {
    const { arcs, state } = makeArcs({ withZz: true });
    const adapter = getDefaultMapshaperAdapter();
    adapter.appendArcs(arcs, [{ xx: new Float64Array([7, 8]), yy: new Float64Array([7, 8]) }]);
    expect(Array.from(state().zz!)).toEqual([5, 5, 5, 5, Infinity, Infinity]);
  });

  it('keeps caller-supplied zz slices on appended arcs', () => {
    const { arcs, state } = makeArcs({ withZz: true });
    const adapter = getDefaultMapshaperAdapter();
    adapter.appendArcs(arcs, [
      { xx: new Float64Array([7]), yy: new Float64Array([7]), zz: new Float64Array([3]) },
    ]);
    expect(Array.from(state().zz!)).toEqual([5, 5, 5, 5, 3]);
  });

  it('truncateArcs drops tail vertex data and restores arc count', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    adapter.appendArcs(arcs, [{ xx: new Float64Array([2, 3]), yy: new Float64Array([2, 3]) }]);
    adapter.truncateArcs(arcs, 2);
    expect(state().nn.length).toBe(2);
    expect(Array.from(state().xx)).toEqual([0, 0, 1, 1]);
  });

  it('truncateArcs throws when target exceeds current arc count', () => {
    const { arcs } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    expect(() => adapter.truncateArcs(arcs, 5)).toThrow();
  });

  it('appendArcs with an empty list is a no-op returning current size', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    expect(adapter.appendArcs(arcs, [])).toBe(2);
    expect(Array.from(state().nn)).toEqual([2, 2]);
  });

  it('delegates appendArc to appendArcs', () => {
    const { arcs } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    const appendArcs = vi.spyOn(adapter, 'appendArcs');

    expect(adapter.appendArc(arcs, [[2, 3]])).toBe(2);

    expect(appendArcs).toHaveBeenCalledOnce();
    expect(appendArcs).toHaveBeenCalledWith(
      arcs,
      [{ xx: new Float64Array([2]), yy: new Float64Array([3]) }],
    );
  });

  it('delegates deleteLastArc to truncateArcs', () => {
    const { arcs } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    const truncateArcs = vi.spyOn(adapter, 'truncateArcs');

    adapter.deleteLastArc(arcs);

    expect(truncateArcs).toHaveBeenCalledOnce();
    expect(truncateArcs).toHaveBeenCalledWith(arcs, 1);
  });

  it('updates real ArcCollection vertex data and bounds through append then truncate', () => {
    const arcs = new mapshaper.internal.ArcCollection(
      new Int32Array([2]),
      new Float64Array([0, 1]),
      new Float64Array([0, 1]),
    );
    const adapter = getDefaultMapshaperAdapter();

    adapter.appendArcs(arcs, [
      { xx: new Float64Array([2, 3]), yy: new Float64Array([2, 3]) },
      { xx: new Float64Array([4]), yy: new Float64Array([4]) },
    ]);

    const appended = arcs.getVertexData();
    expect(arcs.size()).toBe(3);
    expect(Array.from(appended.xx)).toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(appended.yy)).toEqual([0, 1, 2, 3, 4]);

    adapter.truncateArcs(arcs, 1);

    const truncated = arcs.getVertexData();
    expect(arcs.size()).toBe(1);
    expect(Array.from(truncated.xx)).toEqual([0, 1]);
    expect(Array.from(truncated.yy)).toEqual([0, 1]);
  });
});

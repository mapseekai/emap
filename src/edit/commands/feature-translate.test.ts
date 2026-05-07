import { describe, expect, it, vi } from 'vitest';
import { FeatureTranslateCommand } from './feature-translate';
import type { TopologySource } from '../../source/source';
import type { ArcCollection, MapshaperLayer } from '../../types/mapshaper-types';

function makeArcs(xx: number[], yy: number[], nn: number[]) {
  // Build the ii (start index) array from nn
  const ii: number[] = [];
  let acc = 0;
  for (const n of nn) { ii.push(acc); acc += n; }
  // Real mapshaper ArcCollection.getVertexData() returns the SAME backing
  // typed arrays on every call (so in-place mutation is observable). The
  // mock must do the same — otherwise the command's writes vanish.
  const xxArr = new Float64Array(xx);
  const yyArr = new Float64Array(yy);
  const nnArr = new Int32Array(nn);
  const iiArr = new Int32Array(ii);
  const updateArcBounds = vi.fn();
  return {
    arcs: {
      getVertexData: () => ({
        xx: xxArr,
        yy: yyArr,
        nn: nnArr,
        ii: iiArr,
        zz: null,
      }),
      updateArcBounds,
    } as unknown as ArcCollection,
    updateArcBounds,
    xx: xxArr,
    yy: yyArr,
  };
}

function makeSource(): TopologySource & { refreshDisplayArcs: ReturnType<typeof vi.fn> } {
  return { refreshDisplayArcs: vi.fn() } as unknown as TopologySource & {
    refreshDisplayArcs: ReturnType<typeof vi.fn>;
  };
}

describe('FeatureTranslateCommand', () => {
  it('do() offsets every vertex of the listed arcs', () => {
    // Two arcs: arc 0 has 2 verts at (0,0)-(1,1); arc 1 has 3 verts at (10,10)-(11,11)-(12,12)
    const { arcs, xx, yy } = makeArcs([0, 1, 10, 11, 12], [0, 1, 10, 11, 12], [2, 3]);
    const source = makeSource();
    const cmd = new FeatureTranslateCommand({
      source, arcs, dx: 100, dy: 200,
      arcIds: [1], pointFeatures: [],
    });
    cmd.do();
    // Arc 0 untouched
    expect(xx[0]).toBe(0);
    expect(xx[1]).toBe(1);
    // Arc 1 offset by (100, 200)
    expect(xx[2]).toBe(110);
    expect(xx[3]).toBe(111);
    expect(xx[4]).toBe(112);
    expect(yy[2]).toBe(210);
    expect(yy[3]).toBe(211);
    expect(yy[4]).toBe(212);
  });

  it('updates each affected arc\'s bounds exactly once per pass', () => {
    const { arcs, updateArcBounds } = makeArcs([0, 1, 2, 3], [0, 1, 2, 3], [2, 2]);
    const source = makeSource();
    const cmd = new FeatureTranslateCommand({
      source, arcs, dx: 1, dy: 1,
      arcIds: [0, 1], pointFeatures: [],
    });
    cmd.do();
    expect(updateArcBounds).toHaveBeenCalledTimes(2);
    expect(updateArcBounds).toHaveBeenCalledWith(0);
    expect(updateArcBounds).toHaveBeenCalledWith(1);
  });

  it('refreshDisplayArcs is called once per pass', () => {
    const { arcs } = makeArcs([0, 1], [0, 1], [2]);
    const source = makeSource();
    const cmd = new FeatureTranslateCommand({
      source, arcs, dx: 1, dy: 1, arcIds: [0], pointFeatures: [],
    });
    cmd.do();
    expect(source.refreshDisplayArcs).toHaveBeenCalledTimes(1);
    cmd.undo();
    expect(source.refreshDisplayArcs).toHaveBeenCalledTimes(2);
  });

  it('do() then undo() restores xx/yy bit-equal', () => {
    const xxOrig = [0, 1, 10, 11, 12];
    const yyOrig = [5, 6, 50, 51, 52];
    const { arcs, xx, yy } = makeArcs(xxOrig, yyOrig, [2, 3]);
    const source = makeSource();
    const cmd = new FeatureTranslateCommand({
      source, arcs, dx: -7, dy: 3.14,
      arcIds: [0, 1], pointFeatures: [],
    });
    cmd.do();
    cmd.undo();
    expect(Array.from(xx)).toEqual(xxOrig);
    expect(Array.from(yy)).toEqual(yyOrig);
  });

  it('offsets point shape coordinates', () => {
    const layer = {
      shapes: [[[5, 7]]] as any[],
    } as MapshaperLayer;
    const source = makeSource();
    const cmd = new FeatureTranslateCommand({
      source, dx: 1, dy: 2, arcIds: [],
      pointFeatures: [{ layer, featureId: 0 }],
    });
    cmd.do();
    expect(layer.shapes![0]).toEqual([[6, 9]]);
    cmd.undo();
    expect(layer.shapes![0]).toEqual([[5, 7]]);
  });

  it('handles multipoint shapes (multiple coord pairs in one shape)', () => {
    const layer = {
      shapes: [[[1, 2], [3, 4], [5, 6]]] as any[],
    } as MapshaperLayer;
    const source = makeSource();
    const cmd = new FeatureTranslateCommand({
      source, dx: 10, dy: 0, arcIds: [],
      pointFeatures: [{ layer, featureId: 0 }],
    });
    cmd.do();
    expect(layer.shapes![0]).toEqual([[11, 2], [13, 4], [15, 6]]);
  });

  it('handles mixed path + point in one command', () => {
    const { arcs, xx } = makeArcs([0, 1], [0, 1], [2]);
    const layer = { shapes: [[[100, 200]]] as any[] } as MapshaperLayer;
    const source = makeSource();
    const cmd = new FeatureTranslateCommand({
      source, arcs, dx: 1, dy: 1,
      arcIds: [0],
      pointFeatures: [{ layer, featureId: 0 }],
    });
    cmd.do();
    expect(xx[0]).toBe(1);
    expect(layer.shapes![0]).toEqual([[101, 201]]);
  });

  it('label reflects affected feature count', () => {
    const source = makeSource();
    const c1 = new FeatureTranslateCommand({ source, dx: 1, dy: 0, arcIds: [3], pointFeatures: [] });
    expect(c1.label).toBe('Translate 1 feature');
    const c2 = new FeatureTranslateCommand({ source, dx: 1, dy: 0, arcIds: [3, 4], pointFeatures: [] });
    expect(c2.label).toBe('Translate 2 features');
  });

  describe('mergeable + merge', () => {
    it('merges consecutive translates of the same arcIds + source by accumulating dx/dy', () => {
      const { arcs, xx, yy } = makeArcs([0, 1], [0, 1], [2]);
      const source = makeSource();
      const a = new FeatureTranslateCommand({
        source, arcs, dx: 2, dy: 3, arcIds: [0], pointFeatures: [],
      });
      const b = new FeatureTranslateCommand({
        source, arcs, dx: 5, dy: 7, arcIds: [0], pointFeatures: [],
      });
      a.do();
      b.do();
      expect(xx[0]).toBe(7);  // 0 + 2 + 5
      expect(yy[0]).toBe(10); // 0 + 3 + 7
      expect(b.mergeable(a)).toBe(true);
      a.merge(b);
      // After merge, undoing `a` reverses BOTH: xx[0] = 7 - 7 = 0
      a.undo();
      expect(xx[0]).toBe(0);
      expect(yy[0]).toBe(0);
    });

    it('refuses to merge when arcIds differ', () => {
      const source = makeSource();
      const a = new FeatureTranslateCommand({ source, dx: 1, dy: 0, arcIds: [0], pointFeatures: [] });
      const b = new FeatureTranslateCommand({ source, dx: 1, dy: 0, arcIds: [1], pointFeatures: [] });
      expect(b.mergeable(a)).toBe(false);
    });

    it('refuses to merge across sources', () => {
      const a = new FeatureTranslateCommand({
        source: makeSource(), dx: 1, dy: 0, arcIds: [0], pointFeatures: [],
      });
      const b = new FeatureTranslateCommand({
        source: makeSource(), dx: 1, dy: 0, arcIds: [0], pointFeatures: [],
      });
      expect(b.mergeable(a)).toBe(false);
    });
  });
});

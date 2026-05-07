import { describe, expect, it, vi } from 'vitest';
import {
  FeatureAffineCommand,
  rotateMatrix,
  scaleMatrix,
  invertMatrix,
  AffineMatrix,
} from './feature-affine';
import type { ArcCollection, MapshaperLayer } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';

function makeArcs(xx: number[], yy: number[], nn: number[]) {
  const ii: number[] = [];
  let acc = 0;
  for (const n of nn) { ii.push(acc); acc += n; }
  const xxArr = new Float64Array(xx);
  const yyArr = new Float64Array(yy);
  const nnArr = new Int32Array(nn);
  const iiArr = new Int32Array(ii);
  const updateArcBounds = vi.fn();
  return {
    arcs: {
      getVertexData: () => ({ xx: xxArr, yy: yyArr, nn: nnArr, ii: iiArr, zz: null }),
      updateArcBounds,
    } as unknown as ArcCollection,
    xx: xxArr,
    yy: yyArr,
    updateArcBounds,
  };
}

function makeSource(): TopologySource & {
  refreshDisplayArcs: ReturnType<typeof vi.fn>;
  markDisplayArcsDirty: ReturnType<typeof vi.fn>;
} {
  return {
    refreshDisplayArcs: vi.fn(),
    markDisplayArcsDirty: vi.fn(),
  } as unknown as TopologySource & {
    refreshDisplayArcs: ReturnType<typeof vi.fn>;
    markDisplayArcsDirty: ReturnType<typeof vi.fn>;
  };
}

function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

describe('rotateMatrix', () => {
  it('rotates by 90 degrees around origin', () => {
    const m = rotateMatrix(Math.PI / 2, 0, 0);
    // (1, 0) -> (0, 1)
    const x = 1, y = 0;
    expect(close(m.a * x + m.c * y + m.tx, 0)).toBe(true);
    expect(close(m.b * x + m.d * y + m.ty, 1)).toBe(true);
  });

  it('rotates around a non-zero pivot', () => {
    const m = rotateMatrix(Math.PI, 5, 5); // 180 deg around (5,5)
    // (7, 5) -> (3, 5)
    const x = 7, y = 5;
    expect(close(m.a * x + m.c * y + m.tx, 3)).toBe(true);
    expect(close(m.b * x + m.d * y + m.ty, 5)).toBe(true);
  });
});

describe('scaleMatrix', () => {
  it('scales by 2 around origin (5,5)', () => {
    const m = scaleMatrix(2, 2, 5, 5);
    // (7, 7) -> (9, 9); origin (5,5) -> (5,5)
    const x = 7, y = 7;
    expect(m.a * x + m.c * y + m.tx).toBe(9);
    expect(m.b * x + m.d * y + m.ty).toBe(9);

    const ox = 5, oy = 5;
    expect(m.a * ox + m.c * oy + m.tx).toBe(5);
    expect(m.b * ox + m.d * oy + m.ty).toBe(5);
  });

  it('non-uniform scale', () => {
    const m = scaleMatrix(2, 0.5, 0, 0);
    expect(m.a).toBe(2);
    expect(m.d).toBe(0.5);
    // (10, 10) -> (20, 5)
    expect(m.a * 10 + m.c * 10 + m.tx).toBe(20);
    expect(m.b * 10 + m.d * 10 + m.ty).toBe(5);
  });
});

describe('invertMatrix', () => {
  it('round-trips a translate', () => {
    const m: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: -3 };
    const inv = invertMatrix(m);
    // m then inv should be identity
    const x = 4, y = 7;
    const mx = m.a * x + m.c * y + m.tx;
    const my = m.b * x + m.d * y + m.ty;
    const ix = inv.a * mx + inv.c * my + inv.tx;
    const iy = inv.b * mx + inv.d * my + inv.ty;
    expect(close(ix, x)).toBe(true);
    expect(close(iy, y)).toBe(true);
  });

  it('round-trips a rotate around a non-zero pivot', () => {
    const m = rotateMatrix(0.7, 3.5, -2.1);
    const inv = invertMatrix(m);
    const x = 1.234, y = 5.678;
    const mx = m.a * x + m.c * y + m.tx;
    const my = m.b * x + m.d * y + m.ty;
    const ix = inv.a * mx + inv.c * my + inv.tx;
    const iy = inv.b * mx + inv.d * my + inv.ty;
    expect(close(ix, x, 1e-12)).toBe(true);
    expect(close(iy, y, 1e-12)).toBe(true);
  });

  it('throws on a singular matrix', () => {
    expect(() => invertMatrix({ a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 })).toThrow(/singular/);
  });
});

describe('FeatureAffineCommand', () => {
  it('applies an identity-translate matrix to arc xx/yy', () => {
    const { arcs, xx, yy } = makeArcs([0, 1], [0, 1], [2]);
    const source = makeSource();
    const cmd = new FeatureAffineCommand({
      source, arcs,
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 7 },
      arcIds: [0], pointFeatures: [],
    });
    cmd.do();
    expect(xx[0]).toBe(5);
    expect(yy[0]).toBe(7);
    expect(xx[1]).toBe(6);
    expect(yy[1]).toBe(8);
  });

  it('rotates arc verts by 90 degrees around origin', () => {
    const { arcs, xx, yy } = makeArcs([1, 0], [0, 1], [2]);
    const source = makeSource();
    const cmd = new FeatureAffineCommand({
      source, arcs,
      matrix: rotateMatrix(Math.PI / 2, 0, 0),
      arcIds: [0], pointFeatures: [],
    });
    cmd.do();
    // (1, 0) -> (0, 1); (0, 1) -> (-1, 0)
    expect(close(xx[0], 0)).toBe(true);
    expect(close(yy[0], 1)).toBe(true);
    expect(close(xx[1], -1)).toBe(true);
    expect(close(yy[1], 0)).toBe(true);
  });

  it('round-trips do() then undo() bit-equal for a non-trivial matrix', () => {
    const xxOrig = [1, 2, 3, 4];
    const yyOrig = [10, 20, 30, 40];
    const { arcs, xx, yy } = makeArcs(xxOrig, yyOrig, [2, 2]);
    const source = makeSource();
    const cmd = new FeatureAffineCommand({
      source, arcs,
      matrix: rotateMatrix(0.6, 7, -3),
      arcIds: [0, 1], pointFeatures: [],
    });
    cmd.do();
    cmd.undo();
    for (let i = 0; i < xxOrig.length; i++) {
      expect(close(xx[i], xxOrig[i], 1e-9)).toBe(true);
      expect(close(yy[i], yyOrig[i], 1e-9)).toBe(true);
    }
  });

  it('applies the matrix to point shapes', () => {
    const layer = { shapes: [[[10, 20]]] as any[] } as MapshaperLayer;
    const source = makeSource();
    const cmd = new FeatureAffineCommand({
      source,
      matrix: scaleMatrix(2, 2, 0, 0),
      arcIds: [], pointFeatures: [{ layer, featureId: 0 }],
    });
    cmd.do();
    expect(layer.shapes![0]).toEqual([[20, 40]]);
    cmd.undo();
    expect(layer.shapes![0]).toEqual([[10, 20]]);
  });

  it('updates each affected arc bounds once per pass and refreshes once', () => {
    const { arcs, updateArcBounds } = makeArcs([0, 1, 2, 3], [0, 1, 2, 3], [2, 2]);
    const source = makeSource();
    const cmd = new FeatureAffineCommand({
      source, arcs,
      matrix: rotateMatrix(0.1),
      arcIds: [0, 1], pointFeatures: [],
    });
    cmd.do();
    expect(updateArcBounds).toHaveBeenCalledTimes(2);
    expect(source.markDisplayArcsDirty).toHaveBeenCalledTimes(1);
  });

  it('label reflects affected feature count', () => {
    const source = makeSource();
    const c1 = new FeatureAffineCommand({ source, matrix: rotateMatrix(0.1), arcIds: [3], pointFeatures: [] });
    expect(c1.label).toBe('Transform 1 feature');
    const c2 = new FeatureAffineCommand({ source, matrix: rotateMatrix(0.1), arcIds: [3, 4], pointFeatures: [] });
    expect(c2.label).toBe('Transform 2 features');
  });
});

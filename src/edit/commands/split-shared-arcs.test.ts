import { describe, it, expect } from 'vitest';
import { planSharedArcSplit, SplitSharedArcsCommand } from './split-shared-arcs';

// Two adjacent rectangles sharing one vertical edge (arc 1):
//   A: arc 0 (top), arc 1 (right=shared), arc 2 (bottom-left)
//   B: arc 3 (top), ~arc 1 (left=shared, reversed), arc 4 (bottom-right)
//
// Selection = [A]. Plan should duplicate arc 1 → arc 5, rewrite A's
// shape to use arc 5, and leave B untouched.

function buildFixture() {
  // Mock vertex data — values are irrelevant beyond ii/nn correctness.
  const xx = new Float64Array([0, 1, 1, 2, 1, 0, 1, 2, 2, 1]);
  const yy = new Float64Array([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  const nn = new Int32Array([2, 2, 2, 2, 2]);
  const ii = new Int32Array([0, 2, 4, 6, 8]);

  let storedNn: any = nn,
    storedXx: any = xx,
    storedYy: any = yy,
    storedIi: any = ii,
    retained = 0;

  const arcs = {
    size: () => storedNn.length,
    getVertexData: () => ({
      xx: storedXx,
      yy: storedYy,
      nn: storedNn,
      ii: storedIi,
      zz: null,
      bb: null,
    }),
    updateVertexData(newNn: Int32Array, newXx: Float64Array, newYy: Float64Array) {
      storedNn = newNn;
      storedXx = newXx;
      storedYy = newYy;
      const ii2 = new Int32Array(newNn.length);
      let cur = 0;
      for (let i = 0; i < newNn.length; i++) {
        ii2[i] = cur;
        cur += newNn[i];
      }
      storedIi = ii2;
      retained = 0;
    },
    getRetainedInterval: () => retained,
    setRetainedInterval: (v: number) => {
      retained = v;
    },
  } as any;

  const layerA = { name: 'A', geometry_type: 'polygon', shapes: [[[0, 1, 2]]] } as any;
  const layerB = { name: 'B', geometry_type: 'polygon', shapes: [[[3, ~1, 4]]] } as any;
  const source = {
    getArcs: () => arcs,
    getLayers: () => [layerA, layerB],
    refreshDisplayArcs: () => {},
  } as any;

  return { arcs, layerA, layerB, source, state: () => ({ retained }) };
}

describe('planSharedArcSplit', () => {
  it('returns null when selection has no shared boundary', () => {
    const { source, layerA } = buildFixture();
    // Pretend B doesn't exist by passing only [layerA].
    const plan = planSharedArcSplit(source, [{ layer: layerA, featureId: 0 }], [layerA]);
    expect(plan).toBeNull();
  });

  it('duplicates arcs shared with unselected features', () => {
    const { source, layerA, layerB } = buildFixture();
    const plan = planSharedArcSplit(source, [{ layer: layerA, featureId: 0 }], [layerA, layerB]);
    expect(plan).not.toBeNull();
    expect(plan!.appendedArcs).toHaveLength(1);
    expect(plan!.remaps).toHaveLength(1);
    expect(plan!.remaps[0].newShape).toEqual([[0, 5, 2]]);
    expect(plan!.remaps[0].originalShape).toEqual([[0, 1, 2]]);
    expect(plan!.originalArcCount).toBe(5);
  });

  it('uses layer identity when different layers share the same name and feature id', () => {
    const { source, layerA, layerB } = buildFixture();
    layerB.name = layerA.name;

    const plan = planSharedArcSplit(source, [{ layer: layerA, featureId: 0 }], [layerA, layerB]);

    expect(plan).not.toBeNull();
    expect(plan!.remaps).toHaveLength(1);
  });

  it('preserves direction of reversed arc references in selection', () => {
    const { source, arcs, layerA, layerB } = buildFixture();
    // Make A reference the shared arc reversed (~1) instead of forward.
    layerA.shapes[0] = [[0, ~1, 2]];
    const plan = planSharedArcSplit(source, [{ layer: layerA, featureId: 0 }], [layerA, layerB]);
    expect(plan).not.toBeNull();
    // Selected feature's reference was ~1 (reversed). Replacement must
    // preserve the reversed sign: ~5.
    expect(plan!.remaps[0].newShape).toEqual([[0, ~5, 2]]);
    void arcs;
    void layerB;
  });
});

describe('SplitSharedArcsCommand', () => {
  it('do() appends the new arc and rewrites only the selected shape', () => {
    const { source, arcs, layerA, layerB } = buildFixture();
    const plan = planSharedArcSplit(source, [{ layer: layerA, featureId: 0 }], [layerA, layerB])!;
    new SplitSharedArcsCommand(plan).do();
    expect(arcs.size()).toBe(6);
    expect(layerA.shapes[0]).toEqual([[0, 5, 2]]);
    // B is untouched and still references the original arc 1.
    expect(layerB.shapes[0]).toEqual([[3, ~1, 4]]);
  });

  it('do() throws before mutating when the arc count drifted from the plan', () => {
    const { source, arcs, layerA, layerB } = buildFixture();
    const plan = planSharedArcSplit(source, [{ layer: layerA, featureId: 0 }], [layerA, layerB])!;
    // Simulate a bypassing append between planning and command construction.
    arcs.updateVertexData(new Int32Array([2, 2, 2, 2, 2, 3]), new Float64Array(13), new Float64Array(13));
    const command = new SplitSharedArcsCommand(plan);

    expect(() => command.do()).toThrow(
      'SplitSharedArcsCommand: expected 5 arcs before do(), found 6',
    );
    expect(arcs.size()).toBe(6);
    expect(arcs.getVertexData().nn).toEqual(new Int32Array([2, 2, 2, 2, 2, 3]));
    expect(layerA.shapes[0]).toEqual([[0, 1, 2]]);
    expect(layerB.shapes[0]).toEqual([[3, ~1, 4]]);
  });

  it('undo() restores original shapes and arc count', () => {
    const { source, arcs, layerA, layerB } = buildFixture();
    const plan = planSharedArcSplit(source, [{ layer: layerA, featureId: 0 }], [layerA, layerB])!;
    const cmd = new SplitSharedArcsCommand(plan);
    cmd.do();
    cmd.undo();
    expect(arcs.size()).toBe(5);
    expect(layerA.shapes[0]).toEqual([[0, 1, 2]]);
    expect(layerB.shapes[0]).toEqual([[3, ~1, 4]]);
  });

  it('preserves the retained interval across do/undo', () => {
    const { source, layerA, layerB, arcs } = buildFixture();
    arcs.setRetainedInterval(17);
    const plan = planSharedArcSplit(source, [{ layer: layerA, featureId: 0 }], [layerA, layerB])!;
    const command = new SplitSharedArcsCommand(plan);
    command.do();
    expect(arcs.getRetainedInterval()).toBe(17);
    command.undo();
    expect(arcs.getRetainedInterval()).toBe(17);
  });
});

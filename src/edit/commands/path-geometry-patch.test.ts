import { describe, expect, it, vi } from 'vitest';
import { PathGeometryPatchCommand } from './path-geometry-patch';
import { Selection } from '../../map/selection';
import {
  getDefaultMapshaperAdapter,
  type MapshaperAdapter,
} from '../../adapter/mapshaper-adapter';

function makeArcs() {
  let nn = new Int32Array([2]);
  let xx = new Float64Array([0, 1]);
  let yy = new Float64Array([0, 1]);
  const arcs = {
    size: () => nn.length,
    isFlat: () => true,
    getVertexData: () => {
      const ii = new Int32Array(nn.length);
      let cursor = 0;
      for (let i = 0; i < nn.length; i++) {
        ii[i] = cursor;
        cursor += nn[i]!;
      }
      return { xx, yy, zz: null, nn, ii, bb: null };
    },
    updateVertexData(newNn: Int32Array, newXx: Float64Array, newYy: Float64Array) {
      nn = newNn;
      xx = newXx;
      yy = newYy;
    },
  } as any;
  return {
    arcs,
    state: () => ({ nn, xx, yy }),
  };
}

function makeSource(arcs: any) {
  return {
    getArcs: () => arcs,
    getDataset: () => ({ layers: [], arcs }),
    markDisplayArcsDirty: vi.fn(),
    fire: vi.fn(),
  } as any;
}

const REF = { source: 's', layer: 'l', id: 0 };

function makeCommand(arcs: any, source: any, layer: any, selection: Selection) {
  const publishSelection = vi.fn();
  const command = new PathGeometryPatchCommand({
    source,
    shapePatches: [
      { layer, featureId: 0, before: [[0]], after: [[0], [1]] }, // add ring arc 1
    ],
    originalArcCount: 1,
    appendedArcs: [{ xx: new Float64Array([5, 6]), yy: new Float64Array([5, 6]) }],
    selection,
    beforeSelection: selection.snapshot(),
    afterSelection: [REF],
    publishSelection,
    label: 'Add ring',
  });
  return { command, publishSelection };
}

describe('PathGeometryPatchCommand', () => {
  it('do appends arcs, writes the after shape, applies the selection', () => {
    const { arcs, state } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command } = makeCommand(arcs, source, layer, selection);
    command.do();
    expect(state().nn.length).toBe(2);
    expect(layer.shapes[0]).toEqual([[0], [1]]);
    expect(selection.getAll()).toEqual([REF]);
    expect(source.markDisplayArcsDirty).toHaveBeenCalled();
  });

  it('undo truncates arcs, restores the before shape and selection', () => {
    const { arcs, state } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command } = makeCommand(arcs, source, layer, selection);
    command.do();
    command.undo();
    expect(state().nn.length).toBe(1);
    expect(Array.from(state().xx)).toEqual([0, 1]);
    expect(layer.shapes[0]).toEqual([[0]]);
    expect(selection.getAll()).toEqual([]);
  });

  it('redo reproduces identical arc ids across multiple undo/redo rounds', () => {
    const { arcs } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command } = makeCommand(arcs, source, layer, selection);
    command.do();
    const firstShapes = JSON.stringify(layer.shapes);
    for (let round = 0; round < 3; round++) {
      command.undo();
      command.do();
      expect(JSON.stringify(layer.shapes)).toBe(firstShapes);
      expect(layer.shapes[0]![1]).toEqual([1]); // appended arc id stays 1
    }
  });

  it('do throws when the arc count drifted from the planned count', () => {
    const { arcs } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command } = makeCommand(arcs, source, layer, selection);
    // Simulate a bypassing append after planning.
    arcs.updateVertexData(new Int32Array([2, 3]), new Float64Array(5), new Float64Array(5));
    expect(() => command.do()).toThrow();
  });

  it('clones shape snapshots at construction so caller mutation cannot rewrite history', () => {
    const { arcs } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const before = [[0]];
    const after = [[0], [1]];
    const command = new PathGeometryPatchCommand({
      source,
      shapePatches: [{ layer, featureId: 0, before, after }],
      originalArcCount: 1,
      appendedArcs: [{ xx: new Float64Array([5, 6]), yy: new Float64Array([5, 6]) }],
      selection,
      beforeSelection: selection.snapshot(),
      afterSelection: [],
      publishSelection: () => {},
      label: 'Add ring',
    });
    after[1]![0] = 999; // caller mutates its array after construction
    command.do();
    expect(layer.shapes[0]).toEqual([[0], [1]]);
  });

  it('owns appended arc coordinates so caller mutation cannot rewrite do or redo', () => {
    const { arcs, state } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const xx = new Float64Array([5, 6]);
    const yy = new Float64Array([7, 8]);
    const command = new PathGeometryPatchCommand({
      source,
      shapePatches: [{ layer, featureId: 0, before: [[0]], after: [[0], [1]] }],
      originalArcCount: 1,
      appendedArcs: [{ xx, yy }],
      selection,
      beforeSelection: selection.snapshot(),
      afterSelection: [],
      publishSelection: () => {},
      label: 'Add ring',
    });
    xx.fill(999);
    yy.fill(999);

    command.do();
    expect(Array.from(state().xx)).toEqual([0, 1, 5, 6]);
    expect(Array.from(state().yy)).toEqual([0, 1, 7, 8]);

    command.undo();
    command.do();
    expect(Array.from(state().xx)).toEqual([0, 1, 5, 6]);
    expect(Array.from(state().yy)).toEqual([0, 1, 7, 8]);
  });

  it('falls back to legacy single-arc adapter methods across do, undo, and redo', () => {
    const { arcs, state } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const defaultAdapter = getDefaultMapshaperAdapter();
    const legacyAdapter = {
      appendArc: defaultAdapter.appendArc.bind(defaultAdapter),
      deleteLastArc: defaultAdapter.deleteLastArc.bind(defaultAdapter),
    } satisfies Pick<MapshaperAdapter, 'appendArc' | 'deleteLastArc'>;
    const command = new PathGeometryPatchCommand({
      source,
      shapePatches: [{ layer, featureId: 0, before: [[0]], after: [[0], [1]] }],
      originalArcCount: 1,
      appendedArcs: [{ xx: new Float64Array([5, 6]), yy: new Float64Array([7, 8]) }],
      selection,
      beforeSelection: selection.snapshot(),
      afterSelection: [],
      publishSelection: () => {},
      label: 'Add ring',
      // Deliberately minimal implementation installed by a legacy consumer.
      adapter: legacyAdapter as unknown as MapshaperAdapter,
    });

    command.do();
    const firstGeometry = { xx: Array.from(state().xx), yy: Array.from(state().yy) };
    command.undo();
    command.do();

    expect(state().nn.length).toBe(2);
    expect({ xx: Array.from(state().xx), yy: Array.from(state().yy) }).toEqual(firstGeometry);
  });

  it('publish fires data(edit) and the pending selection diff exactly once', () => {
    const { arcs } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command, publishSelection } = makeCommand(arcs, source, layer, selection);
    command.do();
    command.publish();
    expect(source.fire).toHaveBeenCalledWith('data', { reason: 'edit' });
    expect(publishSelection).toHaveBeenCalledTimes(1);
    expect(publishSelection.mock.calls[0]![0]).toMatchObject({ added: [REF], removed: [] });
    command.publish(); // second publish: diff already consumed
    expect(publishSelection).toHaveBeenCalledTimes(1);
  });
});

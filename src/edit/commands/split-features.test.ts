import { describe, expect, it, vi } from 'vitest';
import { SplitFeaturesCommand } from './split-features';
import { Selection } from '../../map/selection';
import type { AppendedArc, MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { TopologySource } from '../../source/source';
import type { ArcCollection, MapshaperLayer } from '../../types/mapshaper-types';

function makeArcs() {
  let nn: Int32Array<ArrayBufferLike> = new Int32Array([2]);
  let xx: Float64Array<ArrayBufferLike> = new Float64Array([0, 1]);
  let yy: Float64Array<ArrayBufferLike> = new Float64Array([0, 1]);
  const arcs = {
    size: () => nn.length,
    getVertexData: () => ({ xx, yy, zz: null, nn, ii: new Int32Array([0]), bb: null }),
    updateVertexData(
      newNn: Int32Array<ArrayBufferLike>,
      newXx: Float64Array<ArrayBufferLike>,
      newYy: Float64Array<ArrayBufferLike>,
    ) {
      nn = newNn;
      xx = newXx;
      yy = newYy;
    },
  };
  // Focused fixture: the command only exercises these ArcCollection members.
  const arcCollection = arcs as unknown as ArcCollection;
  return { arcs, arcCollection, state: () => ({ nn, xx, yy }) };
}

const adapter = {
  appendArcs(arcs: ArcCollection, arcsToAppend: AppendedArc[]) {
    const data = arcs.getVertexData!();
    const pointCount = arcsToAppend.reduce((count, arc) => count + arc.xx.length, 0);
    const xx = new Float64Array(data.xx.length + pointCount);
    const yy = new Float64Array(data.yy.length + pointCount);
    const nn = new Int32Array(data.nn.length + arcsToAppend.length);
    xx.set(data.xx);
    yy.set(data.yy);
    nn.set(data.nn);
    let offset = data.xx.length;
    for (const [index, arc] of arcsToAppend.entries()) {
      xx.set(arc.xx, offset);
      yy.set(arc.yy, offset);
      nn[data.nn.length + index] = arc.xx.length;
      offset += arc.xx.length;
    }
    arcs.updateVertexData!(nn, xx, yy, null);
    return data.nn.length;
  },
  truncateArcs(arcs: ArcCollection, targetArcCount: number) {
    const data = arcs.getVertexData!();
    let pointCount = 0;
    for (const count of data.nn.slice(0, targetArcCount)) pointCount += count;
    arcs.updateVertexData!(
      data.nn.slice(0, targetArcCount),
      data.xx.slice(0, pointCount),
      data.yy.slice(0, pointCount),
      null,
    );
  },
} satisfies Pick<MapshaperAdapter, 'appendArcs' | 'truncateArcs'>;

const BEFORE_REF = { source: 's', layer: 'l', id: 1 };
const AFTER_REF = { source: 's', layer: 'l', id: 2 };

function makeFixture(options: { records?: Record<string, unknown>[]; noTable?: boolean } = {}) {
  const { arcs, arcCollection, state } = makeArcs();
  const records = options.records ?? [{ name: 'first' }, { name: 'second' }];
  const layer = {
    name: 'l',
    geometry_type: 'polyline',
    shapes: [[[0]], [[0]]],
    ...(options.noTable ? {} : { data: { getRecords: () => records } }),
  };
  // Focused fixture omits unrelated mapshaper layer members.
  const mapshaperLayer = layer as unknown as MapshaperLayer;
  const source = {
    getArcs: () => arcCollection,
    getDataset: () => ({ layers: [mapshaperLayer], arcs: arcCollection }),
    markDisplayArcsDirty: vi.fn(),
    fire: vi.fn(),
  };
  // Focused fixture omits unrelated source capabilities.
  const topologySource = source as unknown as TopologySource;
  const selection = new Selection();
  selection.apply([{ ...BEFORE_REF }], 'replace');
  const publishSelection = vi.fn();
  const appendedArcs = [{ xx: new Float64Array([5, 6]), yy: new Float64Array([7, 8]) }];
  const appendedShapes = [[[1]]];
  const appendedRecords = [{ name: 'first' }];
  const afterSelection = [{ ...AFTER_REF }];
  const command = new SplitFeaturesCommand({
    source: topologySource,
    shapePatches: [{ layer: mapshaperLayer, featureId: 0, before: [[0]], after: [[0], [1]] }],
    originalArcCount: 1,
    appendedArcs,
    layer: mapshaperLayer,
    appendedShapes,
    appendedRecords,
    originalFeatureCount: 2,
    selection,
    beforeSelection: selection.snapshot(),
    afterSelection,
    publishSelection,
    label: 'Split features',
    adapter: adapter as unknown as MapshaperAdapter,
  });
  return {
    arcs,
    state,
    source,
    layer,
    records,
    selection,
    command,
    publishSelection,
    appendedArcs,
    appendedShapes,
    appendedRecords,
    afterSelection,
  };
}

describe('SplitFeaturesCommand', () => {
  it('do appends arcs and features, patches shapes, and replaces selection', () => {
    const { command, state, layer, records, selection, source } = makeFixture();

    command.do();

    expect(state().nn.length).toBe(2);
    expect(layer.shapes).toEqual([[[0], [1]], [[0]], [[1]]]);
    expect(records).toEqual([{ name: 'first' }, { name: 'second' }, { name: 'first' }]);
    expect(records[2]).not.toBe(records[0]);
    expect(selection.getAll()).toEqual([AFTER_REF]);
    expect(source.markDisplayArcsDirty).toHaveBeenCalledOnce();
  });

  it('undo restores shapes, records, arcs, and selection exactly', () => {
    const { command, state, layer, records, selection } = makeFixture();
    command.do();
    command.undo();

    expect(state().nn.length).toBe(1);
    expect(Array.from(state().xx)).toEqual([0, 1]);
    expect(layer.shapes).toEqual([[[0]], [[0]]]);
    expect(records).toEqual([{ name: 'first' }, { name: 'second' }]);
    expect(selection.getAll()).toEqual([BEFORE_REF]);
  });

  it('redo reproduces identical arc ids and feature contents', () => {
    const { command, state, layer, records } = makeFixture();
    command.do();
    const firstState = {
      shapes: structuredClone(layer.shapes),
      records: structuredClone(records),
      xx: Array.from(state().xx),
      yy: Array.from(state().yy),
      nn: Array.from(state().nn),
    };

    command.undo();
    command.do();

    expect({
      shapes: layer.shapes,
      records,
      xx: Array.from(state().xx),
      yy: Array.from(state().yy),
      nn: Array.from(state().nn),
    }).toEqual(firstState);
    expect(layer.shapes[2]).toEqual([[1]]);
  });

  it('rejects arc count drift before redo without mutating shapes or records', () => {
    const { command, arcs, layer, records } = makeFixture();
    command.do();
    command.undo();
    arcs.updateVertexData(new Int32Array([2, 1]), new Float64Array([0, 1, 9]), new Float64Array([0, 1, 9]));

    expect(() => command.do()).toThrow('expected 1 arcs before do(), found 2');
    expect(layer.shapes).toEqual([[[0]], [[0]]]);
    expect(records).toEqual([{ name: 'first' }, { name: 'second' }]);
  });

  it('owns mutable command input snapshots', () => {
    const {
      command,
      state,
      layer,
      records,
      selection,
      appendedArcs,
      appendedShapes,
      appendedRecords,
      afterSelection,
    } = makeFixture();
    appendedArcs[0]!.xx.fill(999);
    appendedArcs[0]!.yy.fill(999);
    appendedShapes[0]![0]![0] = 999;
    appendedRecords[0]!.name = 'mutated';
    afterSelection[0]!.id = 999;

    command.do();

    expect(Array.from(state().xx)).toEqual([0, 1, 5, 6]);
    expect(Array.from(state().yy)).toEqual([0, 1, 7, 8]);
    expect(layer.shapes[2]).toEqual([[1]]);
    expect(records[2]).toEqual({ name: 'first' });
    expect(selection.getAll()).toEqual([AFTER_REF]);
  });

  it('restores selection and publishes each pending diff exactly once', () => {
    const { command, source, selection, publishSelection } = makeFixture();
    command.do();
    command.publish();
    command.publish();
    command.undo();
    command.publish();

    expect(selection.getAll()).toEqual([BEFORE_REF]);
    expect(source.fire).toHaveBeenCalledTimes(3);
    expect(source.fire).toHaveBeenNthCalledWith(1, 'data', { reason: 'edit' });
    expect(publishSelection).toHaveBeenCalledTimes(2);
    expect(publishSelection.mock.calls[0]![0]).toMatchObject({ added: [AFTER_REF], removed: [BEFORE_REF] });
    expect(publishSelection.mock.calls[1]![0]).toMatchObject({ added: [BEFORE_REF], removed: [AFTER_REF] });
  });

  it('does not create records for a layer without a data table', () => {
    const { command, layer } = makeFixture({ noTable: true });

    command.do();
    command.undo();

    expect(layer.data).toBeUndefined();
    expect(layer.shapes).toEqual([[[0]], [[0]]]);
  });

  it('restores the initial record count when it differs from the shape count', () => {
    const { command, layer, records } = makeFixture({ records: [{ name: 'only record' }] });

    command.do();
    expect(layer.shapes).toHaveLength(3);
    expect(records).toEqual([{ name: 'only record' }, { name: 'first' }]);
    command.undo();

    expect(layer.shapes).toHaveLength(2);
    expect(records).toEqual([{ name: 'only record' }]);
  });
});

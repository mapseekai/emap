import { describe, expect, it, vi } from 'vitest';
import type { TopologySource } from '../../source/source';
import type { ArcCollection, MapshaperLayer } from '../../types/mapshaper-types';
import { planTopologyNodeDeletion } from './vertex-delete';

function makeArcs(lengths: number[], x: number[], y: number[]) {
  let nn = Int32Array.from(lengths);
  let xx = Float64Array.from(x);
  let yy = Float64Array.from(y);
  let ii = buildOffsets(nn);
  const arcs = {
    size: () => nn.length,
    getVertexData: () => ({ nn, xx, yy, ii, zz: null }),
    updateVertexData(nextNn: Int32Array, nextXx: Float64Array, nextYy: Float64Array) {
      nn = new Int32Array(nextNn);
      xx = new Float64Array(nextXx);
      yy = new Float64Array(nextYy);
      ii = buildOffsets(nn);
    },
  } as unknown as ArcCollection;
  return { arcs, data: () => arcs.getVertexData!() };
}

function buildOffsets(nn: Int32Array): Int32Array {
  const ii = new Int32Array(nn.length);
  let offset = 0;
  for (let arcId = 0; arcId < nn.length; arcId++) {
    ii[arcId] = offset;
    offset += nn[arcId];
  }
  return ii;
}

function makeSource(arcs: ArcCollection, layers: MapshaperLayer[]) {
  const dataset = { arcs, layers, info: {}, editVersion: 0 };
  const source = {
    getArcs: () => arcs,
    getLayers: () => layers,
    getDataset: () => dataset,
    markDisplayArcsDirty: vi.fn(),
  } as unknown as TopologySource;
  return { source, dataset };
}

describe('planTopologyNodeDeletion', () => {
  it('deletes one shared-edge vertex once while preserving both features', () => {
    const { arcs, data } = makeArcs([3], [0, 1, 2], [0, 0, 0]);
    const layer = {
      geometry_type: 'polyline',
      shapes: [[[0]], [[~0]]],
    } as MapshaperLayer;
    const { source } = makeSource(arcs, [layer]);
    const deletion = planTopologyNodeDeletion(source, [1], [layer]);

    expect(deletion).not.toBeNull();
    deletion?.command.do();
    expect(Array.from(data().nn)).toEqual([2]);
    expect(Array.from(data().xx)).toEqual([0, 2]);
    expect(layer.shapes).toEqual([[[0]], [[~0]]]);
    expect(deletion?.deletedFeatureCount).toBe(0);
    expect(deletion?.shapeChanged).toBe(false);

    deletion?.command.undo();
    expect(Array.from(data().nn)).toEqual([3]);
    expect(Array.from(data().xx)).toEqual([0, 1, 2]);

    deletion?.command.do();
    expect(Array.from(data().xx)).toEqual([0, 2]);
  });

  it('bridges adjacent arcs when deleting their shared endpoint', () => {
    const { arcs, data } = makeArcs([2, 2], [0, 1, 1, 2], [0, 0, 0, 0]);
    const layer = {
      geometry_type: 'polyline',
      shapes: [[[0, 1]], [[~1, ~0]]],
    } as MapshaperLayer;
    const { source } = makeSource(arcs, [layer]);
    const deletion = planTopologyNodeDeletion(source, [1, 2], [layer]);

    deletion?.command.do();
    expect(Array.from(data().nn)).toEqual([1, 1, 2]);
    expect(Array.from(data().xx)).toEqual([0, 2, 0, 2]);
    expect(layer.shapes).toEqual([[[0, 2, 1]], [[~1, ~2, ~0]]]);
    expect(deletion?.shapeChanged).toBe(true);

    deletion?.command.undo();
    expect(Array.from(data().nn)).toEqual([2, 2]);
    expect(Array.from(data().xx)).toEqual([0, 1, 1, 2]);
    expect(layer.shapes).toEqual([[[0, 1]], [[~1, ~0]]]);
  });

  it('bridges the closing edge of a polygon after deleting a ring node', () => {
    const { arcs, data } = makeArcs(
      [2, 2, 2, 2],
      [0, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 0],
    );
    const layer = {
      geometry_type: 'polygon',
      shapes: [[[0, 1, 2, 3]]],
    } as MapshaperLayer;
    const { source } = makeSource(arcs, [layer]);
    const deletion = planTopologyNodeDeletion(source, [0, 7], [layer]);

    deletion?.command.do();
    expect(Array.from(data().nn)).toEqual([1, 2, 2, 1, 2]);
    expect(Array.from(data().xx.slice(-2))).toEqual([0, 1]);
    expect(Array.from(data().yy.slice(-2))).toEqual([1, 0]);
    expect(layer.shapes).toEqual([[[0, 1, 2, 3, 4]]]);
    expect(deletion?.deletedFeatureCount).toBe(0);

    deletion?.command.undo();
    expect(Array.from(data().nn)).toEqual([2, 2, 2, 2]);
    expect(layer.shapes).toEqual([[[0, 1, 2, 3]]]);
  });

  it('deletes every feature that falls below its geometry minimum', () => {
    const { arcs, data } = makeArcs([4, 2], [0, 1, 0, 0, 1, 2], [0, 0, 1, 0, 0, 0]);
    const polygonRecords = [{ name: 'triangle' }];
    const lineRecords = [{ name: 'segment' }];
    const polygonLayer = {
      geometry_type: 'polygon',
      shapes: [[[0]]],
      data: { getRecords: () => polygonRecords },
    } as MapshaperLayer;
    const lineLayer = {
      geometry_type: 'polyline',
      shapes: [[[1]]],
      data: { getRecords: () => lineRecords },
    } as MapshaperLayer;
    const layers = [polygonLayer, lineLayer];
    const { source } = makeSource(arcs, layers);
    const deletion = planTopologyNodeDeletion(source, [1, 4], layers);

    expect(deletion?.deletedFeatureCount).toBe(2);
    deletion?.command.do();
    expect(Array.from(data().nn)).toEqual([3, 1]);
    expect(polygonLayer.shapes).toEqual([]);
    expect(lineLayer.shapes).toEqual([]);
    expect(polygonRecords).toEqual([]);
    expect(lineRecords).toEqual([]);

    deletion?.command.undo();
    expect(Array.from(data().nn)).toEqual([4, 2]);
    expect(Array.from(data().xx)).toEqual([0, 1, 0, 0, 1, 2]);
    expect(polygonLayer.shapes).toEqual([[[0]]]);
    expect(lineLayer.shapes).toEqual([[[1]]]);
    expect(polygonRecords).toEqual([{ name: 'triangle' }]);
    expect(lineRecords).toEqual([{ name: 'segment' }]);
  });
});

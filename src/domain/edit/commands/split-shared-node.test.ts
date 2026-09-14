import { describe, expect, it, vi } from 'vitest';
import type { TopologySource } from '../../source/source';
import type { ArcCollection, MapshaperLayer } from '../../../shared/types/mapshaper-types';
import { isSharedNode, planSharedNodeSplit, SplitSharedNodeCommand } from './split-shared-node';

function buildFixture() {
  let storedNn = new Int32Array([2, 2, 2, 2]);
  let storedXx = new Float64Array([-1, 0, 0, 1, 1, 1, 0, 0]);
  let storedYy = new Float64Array([0, 0, 0, 0, 0, 1, 0, -1]);
  let storedIi = new Int32Array([0, 2, 4, 6]);

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
      storedNn = new Int32Array(newNn);
      storedXx = new Float64Array(newXx);
      storedYy = new Float64Array(newYy);
      storedIi = new Int32Array(newNn.length);
      let offset = 0;
      for (let i = 0; i < newNn.length; i++) {
        storedIi[i] = offset;
        offset += newNn[i];
      }
    },
  } as unknown as ArcCollection;

  const targetLayer = {
    name: 'target',
    geometry_type: 'polygon',
    shapes: [[[0, 1, 2]]],
  } as MapshaperLayer;
  const neighborLayer = {
    name: 'neighbor',
    geometry_type: 'polygon',
    shapes: [[[~1, 3]], [[~2]]],
  } as MapshaperLayer;
  const dataset = { arcs, layers: [targetLayer, neighborLayer], info: {} };
  const source = {
    id: 'source',
    getArcs: () => arcs,
    getLayers: () => dataset.layers,
    getDataset: () => dataset,
    markDisplayArcsDirty: vi.fn(),
  } as unknown as TopologySource;

  return { arcs, source, targetLayer, neighborLayer };
}

describe('planSharedNodeSplit', () => {
  it('duplicates only shared arcs incident to the selected node', () => {
    const { source, targetLayer, neighborLayer } = buildFixture();

    const plan = planSharedNodeSplit(source, targetLayer, 0, 1, [targetLayer, neighborLayer]);

    expect(plan).not.toBeNull();
    expect(isSharedNode(source, targetLayer, 0, 1, [targetLayer, neighborLayer])).toBe(true);
    expect(plan?.appendedArcs).toHaveLength(1);
    expect(plan?.remaps[0].newShape).toEqual([[0, 4, 2]]);
    expect(plan?.detachedVertexIds).toEqual([1, 8]);
  });

  it('returns null for a node whose incident arcs are not shared by another feature', () => {
    const { source, targetLayer } = buildFixture();

    const plan = planSharedNodeSplit(source, targetLayer, 0, 0, [targetLayer]);

    expect(plan).toBeNull();
    expect(isSharedNode(source, targetLayer, 0, 0, [targetLayer])).toBe(false);
  });

  it('separates features that meet at a coordinate without sharing an arc id', () => {
    const { source, targetLayer, neighborLayer } = buildFixture();
    neighborLayer.shapes = [[[3]]];

    const plan = planSharedNodeSplit(source, targetLayer, 0, 1, [targetLayer, neighborLayer]);

    expect(plan).not.toBeNull();
    expect(plan?.appendedArcs).toHaveLength(0);
    expect(plan?.remaps).toHaveLength(0);
    expect(plan?.detachedVertexIds).toEqual([1, 2]);
  });

  it('keeps the anchored branch separate after snapping onto another node in the same shape', () => {
    const { arcs, source, targetLayer, neighborLayer } = buildFixture();
    const data = arcs.getVertexData?.();
    if (!data) throw new Error('Expected arc vertex data');
    data.xx[1] = 1;
    data.yy[1] = 1;
    data.xx[2] = 1;
    data.yy[2] = 1;

    const plan = planSharedNodeSplit(source, targetLayer, 0, 1, [targetLayer, neighborLayer]);

    expect(plan).not.toBeNull();
    expect(plan?.appendedArcs).toHaveLength(1);
    expect(plan?.remaps[0].newShape).toEqual([[0, 4, 2]]);
    expect(plan?.detachedVertexIds).toEqual([1, 8]);
  });
});

describe('SplitSharedNodeCommand', () => {
  it('separates one feature and supports undo and redo', () => {
    const { arcs, source, targetLayer, neighborLayer } = buildFixture();
    const plan = planSharedNodeSplit(source, targetLayer, 0, 1, [targetLayer, neighborLayer]);
    expect(plan).not.toBeNull();
    if (!plan) return;
    const command = new SplitSharedNodeCommand(plan);

    command.do();
    expect(arcs.size()).toBe(5);
    expect(targetLayer.shapes?.[0]).toEqual([[0, 4, 2]]);
    expect(neighborLayer.shapes?.[0]).toEqual([[~1, 3]]);

    command.undo();
    expect(arcs.size()).toBe(4);
    expect(targetLayer.shapes?.[0]).toEqual([[0, 1, 2]]);

    command.do();
    expect(arcs.size()).toBe(5);
    expect(targetLayer.shapes?.[0]).toEqual([[0, 4, 2]]);
  });
});

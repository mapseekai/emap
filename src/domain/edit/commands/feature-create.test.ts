import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mapshaper from 'mapshaper';
import { FeatureCreateCommand } from './feature-create';
import type { TopologySource } from '../../source/source';
import type { ArcCollection } from '../../../shared/types/mapshaper-types';

function makeArcs(): ArcCollection {
  let nn: Int32Array = new Int32Array([2]);
  let xx: Float64Array = new Float64Array([0, 1]);
  let yy: Float64Array = new Float64Array([0, 1]);

  const arcs = {
    size: () => nn.length,
    getVertexData: () => ({ xx, yy, zz: null, nn, ii: new Int32Array([0]), bb: null }),
    updateVertexData(
      newNn: Int32Array,
      newXx: Float64Array,
      newYy: Float64Array,
      _newZz: Float64Array | null,
    ) {
      nn = newNn;
      xx = newXx;
      yy = newYy;
    },
  };
  // This focused command fixture implements only the ArcCollection methods it exercises.
  return arcs as unknown as ArcCollection;
}

describe('FeatureCreateCommand', () => {
  // Capture mapshaper internals so we can verify which paths got invoked
  const originalAppendEmptyArc = Reflect.get(mapshaper.internal as object, 'appendEmptyArc');
  const originalAppendVertex = Reflect.get(mapshaper.internal as object, 'appendVertex');

  let appendEmptySpy: ReturnType<typeof vi.fn>;
  let appendVertexSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    appendEmptySpy = vi.fn();
    appendVertexSpy = vi.fn();
    Reflect.set(mapshaper.internal as object, 'appendEmptyArc', appendEmptySpy);
    Reflect.set(mapshaper.internal as object, 'appendVertex', appendVertexSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'appendEmptyArc', originalAppendEmptyArc);
    Reflect.set(mapshaper.internal as object, 'appendVertex', originalAppendVertex);
  });

  function makeSource(): TopologySource {
    return { refreshDisplayArcs: vi.fn() } as unknown as TopologySource;
  }

  it('undo on a polyline pops shape, record, and last arc', () => {
    const records: Record<string, unknown>[] = [{}];
    const layer = {
      shapes: [[[5]]] as any[][],
      data: { getRecords: () => records },
    };
    const arcs = makeArcs();
    const cmd = new FeatureCreateCommand({
      geometryType: 'polyline',
      layer: layer as any,
      source: makeSource(),
      appendedShape: [[5]],
      appendedRecord: {},
      arcVertices: [
        [0, 0],
        [1, 1],
      ],
      arcs,
    });
    cmd.undo();
    expect(layer.shapes).toEqual([]);
    expect(records).toEqual([]);
    expect(arcs.size()).toBe(0);
  });

  it('undo on a point pops shape and record but does not touch arcs', () => {
    const records: Record<string, unknown>[] = [{}];
    const layer = {
      shapes: [[[10, 20]]] as any[][],
      data: { getRecords: () => records },
    };
    const cmd = new FeatureCreateCommand({
      geometryType: 'point',
      layer: layer as any,
      source: makeSource(),
      appendedShape: [[10, 20]],
      appendedRecord: {},
    });
    cmd.undo();
    expect(layer.shapes).toEqual([]);
    expect(records).toEqual([]);
  });

  it('redo re-creates the arc and re-pushes shape + record', () => {
    const records: Record<string, unknown>[] = [];
    const layer = {
      shapes: [] as any[][],
      data: { getRecords: () => records },
    };
    const cmd = new FeatureCreateCommand({
      geometryType: 'polyline',
      layer: layer as any,
      source: makeSource(),
      appendedShape: [[7]],
      appendedRecord: { foo: 1 },
      arcVertices: [
        [0, 0],
        [3, 4],
        [5, 5],
      ],
      arcs: makeArcs(),
    });
    cmd.do();
    expect(layer.shapes.length).toBe(1);
    expect(records).toEqual([{ foo: 1 }]);
    expect(appendEmptySpy).toHaveBeenCalledTimes(1);
    expect(appendVertexSpy).toHaveBeenCalledTimes(3);
  });

  it('undo / redo cycle is symmetric', () => {
    const records: Record<string, unknown>[] = [{}];
    const layer = {
      shapes: [[[1]]] as any[][],
      data: { getRecords: () => records },
    };
    const cmd = new FeatureCreateCommand({
      geometryType: 'polygon',
      layer: layer as any,
      source: makeSource(),
      appendedShape: [[1]],
      appendedRecord: {},
      arcVertices: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ],
      arcs: makeArcs(),
    });
    cmd.undo();
    cmd.do();
    expect(layer.shapes.length).toBe(1);
    expect(records.length).toBe(1);
    expect(appendEmptySpy).toHaveBeenCalledTimes(1);
  });
});

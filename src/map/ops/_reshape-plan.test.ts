import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { Selection } from '../selection';
import type { MutableTopologySource } from '../../source/source';
import type {
  ArcCollection,
  MapshaperDataset,
  PathLayer,
  PathShape,
} from '../../types/mapshaper-types';
import { planReshapeSource, reshapeLineBounds, shapeIntersectsBounds } from './_reshape-plan';
import { collectLineContacts } from './reshape-selected-line';

const adapter = getDefaultMapshaperAdapter();

type Point = [number, number];

function arcsFrom(parts: Point[][]): ArcCollection {
  return adapter.createArcCollection(
    parts.map((points) => ({
      xx: Float64Array.from(points.map(([x]) => x)),
      yy: Float64Array.from(points.map(([, y]) => y)),
      zz: null,
    })),
  );
}

function sourceFor(dataset: MapshaperDataset): MutableTopologySource {
  const source = {
    id: 'source',
    type: 'topology' as const,
    getArcs: () => dataset.arcs,
    getDataset: () => dataset,
    getLayers: () => dataset.layers,
    markDisplayArcsDirty: () => undefined,
    fire: () => undefined,
  };
  // The planner and command use only this tested source surface.
  return source as unknown as MutableTopologySource;
}

function plan(
  dataset: MapshaperDataset,
  line: Point[],
  adapterOverride: MapshaperAdapter = adapter,
) {
  return planReshapeSource({
    source: sourceFor(dataset),
    sourceId: 'source',
    dataset,
    line,
    adapter: adapterOverride,
    selection: new Selection(),
    publishSelection: () => undefined,
  });
}

function vertexData(arcs: ArcCollection) {
  const { xx, yy } = arcs.getVertexData!();
  return { xx: Array.from(xx), yy: Array.from(yy) };
}

describe('reshape planner bounds', () => {
  it('keeps a segment-crossing arc as a candidate when vertex bounds are unavailable', () => {
    const arcs = arcsFrom([
      [
        [-1, 0],
        [1, 0],
      ],
    ]);
    const getVertexData = arcs.getVertexData!;
    arcs.getVertexData = () => ({ ...getVertexData(), bb: undefined });

    expect(
      shapeIntersectsBounds(
        [[0]],
        arcs,
        reshapeLineBounds([
          [0, -0.5],
          [0, 0.5],
        ]),
      ),
    ).toBe(true);
  });

  it('keeps a near-endpoint contact accepted by legacy intersection tolerance', () => {
    const offset = Number.EPSILON * 128;
    const arcs = arcsFrom([
      [
        [1 + offset, -1],
        [1 + offset, 1],
      ],
    ]);
    const line: Point[] = [
      [0, 0],
      [1, 0],
    ];

    expect(collectLineContacts([0], arcs, line, adapter)).toHaveLength(1);
    expect(shapeIntersectsBounds([[0]], arcs, reshapeLineBounds(line))).toBe(true);
    const getVertexData = arcs.getVertexData!;
    arcs.getVertexData = () => ({ ...getVertexData(), bb: undefined });
    expect(shapeIntersectsBounds([[0]], arcs, reshapeLineBounds(line))).toBe(true);
  });
});

describe('planReshapeSource', () => {
  it('plans a polyline reshape without mutating live arcs, then command do/undo restores exact data', () => {
    const arcs = arcsFrom([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
    const layer = {
      geometry_type: 'polyline',
      shapes: [[[0]]] as PathShape[],
    } as PathLayer;
    const dataset = { arcs, layers: [layer] } as MapshaperDataset;
    const before = vertexData(arcs);
    const beforeShape = layer.shapes![0]!.map((part) => part.slice());
    const result = plan(dataset, [
      [3, 0],
      [5, 2],
      [7, 0],
    ]);

    expect(result).not.toBeNull();
    expect(result).not.toBe('invalid');
    if (!result || result === 'invalid') throw new Error('expected a reshape plan');
    expect(result.reshapedCount).toBe(1);
    expect(arcs.size()).toBe(1);
    expect(vertexData(arcs)).toEqual(before);
    expect(layer.shapes![0]).toEqual(beforeShape);

    result.command.do();
    expect(arcs.size()).toBeGreaterThan(1);
    expect(layer.shapes![0]).not.toEqual(beforeShape);
    result.command.undo();
    expect(arcs.size()).toBe(1);
    expect(vertexData(arcs)).toEqual(before);
    expect(layer.shapes![0]).toEqual(beforeShape);
  });

  it('splices a non-candidate shared polyline owner after legacy cuts divide its arc', () => {
    const arcs = arcsFrom([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
    const layer = {
      geometry_type: 'polyline',
      shapes: [[[0]], [[-1], []]] as PathShape[],
    } as PathLayer;
    const result = plan({ arcs, layers: [layer] } as MapshaperDataset, [
      [3, 0],
      [5, 2],
      [7, 0],
    ]);

    expect(result).not.toBeNull();
    expect(result).not.toBe('invalid');
    if (!result || result === 'invalid') throw new Error('expected a reshape plan');
    const command = result.command as unknown as {
      opts: { shapePatches: Array<{ layer: PathLayer; featureId: number; after: PathShape }> };
    };
    const candidatePatch = command.opts.shapePatches.find(
      (patch) => patch.layer === layer && patch.featureId === 0,
    );
    const neighborPatch = command.opts.shapePatches.find(
      (patch) => patch.layer === layer && patch.featureId === 1,
    );
    expect(candidatePatch).toBeDefined();
    expect(neighborPatch).toBeDefined();
    expect(candidatePatch!.after).toEqual([[1, 4, 3]]);
    expect(neighborPatch!.after).toEqual([[-4, -3, -2], []]);
  });

  it('returns null when nothing contacts the source', () => {
    const arcs = arcsFrom([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
    const layer = { geometry_type: 'polyline', shapes: [[[0]]] as PathShape[] } as PathLayer;
    expect(
      plan({ arcs, layers: [layer] } as MapshaperDataset, [
        [20, 0],
        [30, 0],
      ]),
    ).toBeNull();
  });

  it('rethrows an adapter failure while building the mini dataset', () => {
    const arcs = arcsFrom([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
    const layer = { geometry_type: 'polyline', shapes: [[[0]]] as PathShape[] } as PathLayer;
    const boom = new Error('adapter boom');
    const throwingAdapter = Object.create(adapter) as MapshaperAdapter;
    throwingAdapter.createArcCollection = () => {
      throw boom;
    };

    expect(() =>
      plan(
        { arcs, layers: [layer] } as MapshaperDataset,
        [
          [3, 0],
          [5, 2],
          [7, 0],
        ],
        throwingAdapter,
      ),
    ).toThrow(boom);
  });

  it('skips invalid polyline features and returns null when no valid feature is contacted', () => {
    const arcs = arcsFrom([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
    const layer = {
      geometry_type: 'polyline',
      shapes: [[[0], []]] as PathShape[],
    } as PathLayer;
    expect(
      plan({ arcs, layers: [layer] } as MapshaperDataset, [
        [3, 0],
        [5, 2],
        [7, 0],
      ]),
    ).toBeNull();
  });
});

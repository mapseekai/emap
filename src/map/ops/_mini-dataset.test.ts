import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type {
  ArcCollection,
  MapshaperDataset,
  PathLayer,
  PathShape,
} from '../../types/mapshaper-types';
import { buildMiniDataset } from './_mini-dataset';

// Fixtures build ArcCollection through the adapter — ops tests never import
// mapshaper directly (AGENTS.md hard rule).
function arcsFrom(pointsPerArc: [number, number][][]): ArcCollection {
  return getDefaultMapshaperAdapter().createArcCollection!(
    pointsPerArc.map((pts) => ({
      xx: Float64Array.from(pts.map((p) => p[0])),
      yy: Float64Array.from(pts.map((p) => p[1])),
      zz: null,
    })),
  );
}

function liveDataset(): MapshaperDataset {
  // f0 references arcs 0,1; f1 references arc 1 (twice: reversed + forward);
  // f2 references arc 0; arc 2 is unreferenced.
  const arcs = arcsFrom([
    [
      [0, 0],
      [1, 0],
    ],
    [
      [1, 0],
      [2, 0],
    ],
    [
      [9, 9],
      [9, 9],
    ],
  ]);
  const layer: PathLayer = {
    geometry_type: 'polygon',
    shapes: [[[0, 1]], [[-2, 1]], [[0]]] as PathShape[],
  } as unknown as PathLayer;
  return { arcs, layers: [layer] } as unknown as MapshaperDataset;
}

describe('buildMiniDataset', () => {
  const adapter = getDefaultMapshaperAdapter();

  it('copies only candidate-referenced arcs, with provenance and sparse translated shapes', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([2])]]), // f2 references arc 0 only
      adapter,
    });
    expect(mini.miniToLiveArc).toEqual([0]); // arc 1 (not referenced by f2) NOT copied
    expect(mini.candidates.get(0)).toEqual(new Set([2]));
    expect(mini.arcs.size()).toBe(1);
    const shapes = (mini.dataset.layers[0] as PathLayer).shapes!;
    expect(shapes.length).toBe(3); // live-aligned sparse array
    expect(shapes[0]).toBeNull();
    expect(shapes[1]).toBeNull();
    expect(shapes[2]).toEqual([[0]]);
  });

  it('indexes live referencers of copied arcs for splice translation', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]), // f0 references arcs 0,1
      adapter,
    });
    expect(mini.miniToLiveArc).toEqual([0, 1]); // arc 2 unreferenced → not copied
    expect(mini.referencers.get(0)).toEqual([
      { layerIndex: 0, featureId: 0 },
      { layerIndex: 0, featureId: 2 },
    ]);
    expect(mini.referencers.get(1)).toEqual([
      { layerIndex: 0, featureId: 0 },
      { layerIndex: 0, featureId: 1 },
    ]);
    // Neighbor features do NOT enter the mini: only candidate shapes are present.
    const shapes = (mini.dataset.layers[0] as PathLayer).shapes!;
    expect(shapes[0]).toEqual([[0, 1]]);
    expect(shapes[1]).toBeNull(); // f1 references arc 1 but is NOT a candidate
    expect(shapes[2]).toBeNull();
  });

  it('appends a sentinel layer with one [[arcId]] shape per copied arc', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    expect(mini.sentinelLayerIndex).toBe(1); // live had 1 layer
    const sentinel = mini.dataset.layers[1] as PathLayer;
    expect(sentinel.geometry_type).toBe('polyline');
    expect(sentinel.shapes).toEqual([[[0]], [[1]]]);
  });

  it('does not alias live vertex buffers (copies are independent)', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([2])]]),
      adapter,
    });
    const liveXx = live.arcs!.getVertexData().xx;
    const miniXx = mini.arcs.getVertexData().xx;
    expect(miniXx).not.toBe(liveXx);
    expect(Array.from(miniXx)).toEqual([0, 1]);
  });

  it('copies simplification thresholds and the retained interval', () => {
    const arcs = arcsFrom([
      [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
    ]);
    const data = arcs.getVertexData!();
    arcs.updateVertexData!(
      data.nn.slice(),
      data.xx.slice(),
      data.yy.slice(),
      new Float64Array([Infinity, 3, Infinity]),
    );
    arcs.setRetainedInterval!(5);
    const layer = {
      geometry_type: 'polyline',
      shapes: [[[0]]],
    } as unknown as PathLayer;
    const live = { arcs, layers: [layer] } as unknown as MapshaperDataset;

    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });

    expect(Array.from(mini.arcs.getVertexData!().zz!)).toEqual([Infinity, 3, Infinity]);
    expect(mini.arcs.getRetainedInterval!()).toBe(5);
  });


  it('keeps legacy geometry functions away from the sentinel layer', () => {
    // Sentinel layer is only reachable by explicit index; the path-layer loops
    // in reshape/split receive candidate ids and never target it. This test
    // pins the contract: sentinel index === live layers.length (trailing).
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([2])]]),
      adapter,
    });
    expect(mini.dataset.layers.length).toBe(live.layers.length + 1);
    expect(mini.dataset.layers[mini.sentinelLayerIndex]).toBe(
      mini.dataset.layers[mini.dataset.layers.length - 1],
    );
  });

  it('never aliases a no-candidate path layer; live layers survive a mini rebuild', () => {
    // layer 0 holds the candidate (references arc 0); layer 1 has NO
    // candidates and its shapes reference live arc ids that are OUT OF RANGE
    // in the mini arc table (mini copies arc 0 only).
    const arcs = arcsFrom([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [2, 0],
      ],
      [
        [5, 5],
        [6, 5],
      ],
    ]);
    const layer0 = { geometry_type: 'polyline', shapes: [[[0]]] } as unknown as PathLayer;
    const layer1 = {
      geometry_type: 'polyline',
      shapes: [[[1]], [[2]]],
    } as unknown as PathLayer;
    const live = { arcs, layers: [layer0, layer1] } as unknown as MapshaperDataset;
    const liveShapes1 = layer1.shapes;
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // No-candidate path layers are CLONED with live-length all-null shapes —
    // addIntersectionCuts/remapDividedArcs/cleanShapes rewrite every path
    // layer in place, so passing the live layer through would corrupt it.
    const miniLayer1 = mini.dataset.layers[1] as PathLayer;
    expect(miniLayer1).not.toBe(layer1);
    expect(miniLayer1.shapes).toEqual([null, null]);
    adapter.addIntersectionCuts(mini.dataset, { rebuild_topology: true });
    expect(layer1.shapes).toBe(liveShapes1);
    expect(layer1.shapes).toEqual([[[1]], [[2]]]);
    expect((live.layers[0] as PathLayer).shapes).toEqual([[[0]]]);
  });

  it('preserves reversed candidate arc references when translating to mini ids', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([1])]]),
      adapter,
    });

    expect(mini.miniToLiveArc).toEqual([1]);
    expect((mini.dataset.layers[0] as PathLayer).shapes![1]).toEqual([[-1, 0]]);
  });

  it('rejects an out-of-range candidate layer index', () => {
    expect(() =>
      buildMiniDataset({
        dataset: liveDataset(),
        candidates: new Map([[1, new Set([0])]]),
        adapter,
      }),
    ).toThrow('buildMiniDataset: candidate layer index 1 is out of range');
  });

  it('rejects an out-of-range candidate feature id', () => {
    expect(() =>
      buildMiniDataset({
        dataset: liveDataset(),
        candidates: new Map([[0, new Set([3])]]),
        adapter,
      }),
    ).toThrow('buildMiniDataset: candidate feature id 3 is out of range for layer 0');
  });

  it('rejects an out-of-range signed arc reference', () => {
    const live = liveDataset();
    (live.layers[0] as PathLayer).shapes![2] = [[3]];

    expect(() =>
      buildMiniDataset({
        dataset: live,
        candidates: new Map([[0, new Set([2])]]),
        adapter,
      }),
    ).toThrow('buildMiniDataset: arc reference 3 is out of range');
  });

  it('builds an empty mini with cloned all-null path layers and an empty sentinel', () => {
    const live = liveDataset();
    const liveShapes = (live.layers[0] as PathLayer).shapes;
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map(),
      adapter,
    });
    const miniLayer = mini.dataset.layers[0] as PathLayer;

    expect(mini.arcs.size()).toBe(0);
    expect(miniLayer).not.toBe(live.layers[0]);
    expect(miniLayer.shapes).toEqual([null, null, null]);
    expect(mini.sentinelLayerIndex).toBe(1);
    expect((mini.dataset.layers[mini.sentinelLayerIndex] as PathLayer).shapes).toEqual([]);
    expect((live.layers[0] as PathLayer).shapes).toBe(liveShapes);
  });
});

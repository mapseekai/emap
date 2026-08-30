import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type {
  ArcCollection,
  MapshaperDataset,
  PathLayer,
  PathShape,
} from '../../types/mapshaper-types';
import { buildMiniDataset, type MiniDataset } from './_mini-dataset';
import { translateMiniDataset, translateShapeFromMini } from './_mini-translate';

function arcsFrom(pointsPerArc: [number, number][][]): ArcCollection {
  return getDefaultMapshaperAdapter().createArcCollection(
    pointsPerArc.map((pts) => ({
      xx: Float64Array.from(pts.map((p) => p[0])),
      yy: Float64Array.from(pts.map((p) => p[1])),
      zz: null,
    })),
  );
}

function liveDataset(): MapshaperDataset {
  const arcs = arcsFrom([
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
    [[9, 9], [9, 9]],
  ]);
  const layer: PathLayer = {
    geometry_type: 'polyline',
    shapes: [[[0, 1]], [[-2]], [[2]]] as PathShape[],
  } as unknown as PathLayer;
  return { arcs, layers: [layer] } as unknown as MapshaperDataset;
}

describe('translateMiniDataset', () => {
  const adapter = getDefaultMapshaperAdapter();

  it('keeps live ids for untouched arcs and produces no patch when nothing changed', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toEqual([]);
    expect(translation!.shapePatches).toEqual([]);
    expect(translation!.miniToLiveFinal).toEqual([0, 1]);
  });

  it('appends a mini-only arc (no sentinel) only when referenced by an output shape', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    adapter.appendArc(mini.arcs, [[5, 5], [6, 6]]);
    adapter.appendArc(mini.arcs, [[7, 7], [8, 8]]);
    const miniLayer = mini.dataset.layers[0] as PathLayer;
    miniLayer.shapes![0] = [[2, 1]];
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toHaveLength(1);
    expect(Array.from(translation!.appendedArcs[0]!.xx)).toEqual([5, 6]);
    expect(translation!.miniToLiveFinal).toEqual([0, 1, 3, undefined]);
    expect(translation!.shapePatches).toEqual([
      {
        layer: live.layers[0],
        featureId: 0,
        before: [[0, 1]],
        after: [[3, 1]],
      },
    ]);
  });

  it('maps arcs referenced ONLY by extraShapes (split planned piece shapes)', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    adapter.appendArc(mini.arcs, [[5, 5], [6, 6]]);
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
      extraShapes: [[[2]]],
    });
    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toHaveLength(1);
    expect(translation!.miniToLiveFinal).toEqual([0, 1, 3]);
    const translation2 = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(() => translateShapeFromMini(translation2!, [[2]])).toThrow();
  });

  it('resolves divided-arc lineage and splices the non-candidate neighbor', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    adapter.insertCutPoints(mini.dataset, [{ x: 1.5, y: 0, i: 2 }]);
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.miniToLiveFinal).toEqual([0, 3, 4]);
    expect(translation!.appendedArcs).toHaveLength(2);
    expect(Array.from(translation!.appendedArcs[0]!.xx)).toEqual([1, 1.5]);
    expect(Array.from(translation!.appendedArcs[1]!.xx)).toEqual([1.5, 2]);
    const byFeature = new Map(translation!.shapePatches.map((p) => [p.featureId, p]));
    expect(byFeature.get(0)?.after).toEqual([[0, 3, 4]]);
    expect(byFeature.get(1)?.after).toEqual([[-5, -4]]);
    expect(byFeature.has(2)).toBe(false);
  });

  it('leaves unreferenced split lineage pieces unmapped when no neighbor needs splicing', () => {
    const arcs = arcsFrom([[[0, 0], [2, 0]]]);
    const layer: PathLayer = {
      geometry_type: 'polyline',
      shapes: [[[0]]] as PathShape[],
    } as unknown as PathLayer;
    const live = { arcs, layers: [layer] } as unknown as MapshaperDataset;
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    adapter.insertCutPoints(mini.dataset, [{ x: 1, y: 0, i: 0 }]);
    (mini.dataset.layers[0] as PathLayer).shapes![0] = [[0]];

    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });

    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toHaveLength(1);
    expect(translation!.miniToLiveFinal).toEqual([1, undefined]);
    expect(translation!.shapePatches[0]?.after).toEqual([[1]]);
  });

  it('merges deduped arcs into ONE appended arc per post id (signs preserved)', () => {
    const arcs = arcsFrom([
      [[0, 0], [1, 0]],
      [[0, 0], [1, 0]],
      [[1, 0], [0, 0]],
    ]);
    const layer: PathLayer = {
      geometry_type: 'polyline',
      shapes: [[[0]], [[1]], [[2]]] as PathShape[],
    } as unknown as PathLayer;
    const live = { arcs, layers: [layer] } as unknown as MapshaperDataset;
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0, 1, 2])]]),
      adapter,
    });
    adapter.appendArc(mini.arcs, [[0.5, -1], [0.5, 1]]);
    adapter.addIntersectionCuts(mini.dataset, { rebuild_topology: true });
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.miniToLiveFinal.slice(0, 2)).toEqual([3, 4]);
    expect(translation!.appendedArcs).toHaveLength(2);
    expect(Array.from(translation!.appendedArcs[0]!.xx)).toEqual([0, 0.5]);
    expect(Array.from(translation!.appendedArcs[1]!.xx)).toEqual([0.5, 1]);
    const afterByFeature = new Map(
      translation!.shapePatches.map((p) => [p.featureId, p.after]),
    );
    expect(afterByFeature.get(0)).toEqual([[3, 4]]);
    expect(afterByFeature.get(1)).toEqual([[3, 4]]);
    expect(afterByFeature.get(2)).toEqual([[-5, -4]]);
  });

  it('reuses the live id when dedup keeps the copied arc (positive singleton)', () => {
    const arcs = arcsFrom([[[0, 0], [1, 0]]]);
    const layer: PathLayer = {
      geometry_type: 'polyline',
      shapes: [[[0]]] as PathShape[],
    } as unknown as PathLayer;
    const live = { arcs, layers: [layer] } as unknown as MapshaperDataset;
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    adapter.appendArc(mini.arcs, [[1, 0], [0, 0]]);
    adapter.addIntersectionCuts(mini.dataset, { rebuild_topology: true });
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toEqual([]);
    expect(translation!.shapePatches).toEqual([]);
    expect(translation!.miniToLiveFinal).toEqual([0]);
  });

  it('never reuses a live id for a NEGATIVE singleton lineage (would invert geometry)', () => {
    const arcs = arcsFrom([[[0, 0], [1, 0]]]);
    const layer: PathLayer = {
      geometry_type: 'polyline',
      shapes: [[[0]]] as PathShape[],
    } as unknown as PathLayer;
    const live = { arcs, layers: [layer] } as unknown as MapshaperDataset;
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    adapter.truncateArcs!(mini.arcs, 0);
    adapter.appendArc(mini.arcs, [[1, 0], [0, 0]]);
    (mini.dataset.layers[mini.sentinelLayerIndex] as PathLayer).shapes![0] = [[-1]];
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.miniToLiveFinal).toEqual([1]);
    expect(translation!.appendedArcs).toHaveLength(1);
    expect(Array.from(translation!.appendedArcs[0]!.xx)).toEqual([1, 0]);
    const f0 = translation!.shapePatches.find((p) => p.featureId === 0);
    expect(f0?.after).toEqual([[1]]);
  });

  it('fails cleanly for invalid mini references', () => {
    const cases: Array<{
      name: string;
      mutate: (mini: MiniDataset) => readonly PathShape[] | undefined;
    }> = [
      {
        name: 'nulled sentinel',
        mutate: (mini) => {
          (mini.dataset.layers[mini.sentinelLayerIndex] as PathLayer).shapes![1] = null;
          return undefined;
        },
      },
      {
        name: 'out-of-range sentinel',
        mutate: (mini) => {
          (mini.dataset.layers[mini.sentinelLayerIndex] as PathLayer).shapes![0] = [[99]];
          return undefined;
        },
      },
      {
        name: 'out-of-range candidate output',
        mutate: (mini) => {
          (mini.dataset.layers[0] as PathLayer).shapes![0] = [[99]];
          return undefined;
        },
      },
      {
        name: 'out-of-range extra output',
        mutate: () => [[[99]]],
      },
    ];

    for (const { name, mutate } of cases) {
      const live = liveDataset();
      const mini = buildMiniDataset({
        dataset: live,
        candidates: new Map([[0, new Set([0])]]),
        adapter,
      });
      expect(
        translateMiniDataset({
          mini,
          liveDataset: live,
          liveArcCount: live.arcs!.size(),
          liveLayers: live.layers,
          extraShapes: mutate(mini),
        }),
        name,
      ).toBeNull();
    }
  });
});

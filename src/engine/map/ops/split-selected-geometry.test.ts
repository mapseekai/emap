import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type { ArcCollection, PathLayer, PathShape } from '../../../shared/types/mapshaper-types';
import { planSplitPieces } from './split-selected-geometry';
import type { SplitPieces } from './split-selected-line';

const adapter = getDefaultMapshaperAdapter();

function arcsFrom(pointsPerArc: [number, number][][]): ArcCollection {
  return adapter.createArcCollection!(
    pointsPerArc.map((points) => ({
      xx: Float64Array.from(points.map(([x]) => x)),
      yy: Float64Array.from(points.map(([, y]) => y)),
      zz: null,
    })),
  );
}

function layer(shapes: PathShape[]): PathLayer {
  return { geometry_type: 'polyline', shapes } as PathLayer;
}

function plan(shapes: PathShape[], selectedIds: number[], piecesByFeature: SplitPieces[]) {
  const arcs = arcsFrom([
    [
      [0, 0],
      [10, 0],
    ],
    [
      [0, 1],
      [4, 1],
    ],
    [
      [4, 1],
      [10, 1],
    ],
    [
      [0, 2],
      [3, 2],
    ],
    [
      [3, 2],
      [10, 2],
    ],
  ]);
  return planSplitPieces({
    layer: layer(shapes),
    selectedIds: new Set(selectedIds),
    piecesByFeature,
    arcs,
    adapter,
    sourceId: 'source',
    layerId: 'lines',
  });
}

describe('planSplitPieces', () => {
  it('keeps the largest piece at the original id and appends the rest without mutating mini shapes or records', () => {
    const miniLayer = layer([[[0]]]);
    const records = [{ name: 'road' }];
    miniLayer.data = { getRecords: () => records } as PathLayer['data'];
    const arcs = arcsFrom([
      [
        [0, 0],
        [10, 0],
      ],
      [
        [0, 1],
        [4, 1],
      ],
      [
        [4, 1],
        [10, 1],
      ],
    ]);
    const beforeShapes = miniLayer.shapes!.map(
      (shape) => shape?.map((part) => part.slice()) ?? null,
    );
    const beforeRecords = records.map((record) => ({ ...record }));

    const result = planSplitPieces({
      layer: miniLayer,
      selectedIds: new Set([0]),
      piecesByFeature: [{ featureId: 0, pieces: [[[1]], [[2]]] }],
      arcs,
      adapter,
      sourceId: 'source',
      layerId: 'lines',
    });

    expect(result.targetAfterShapes).toEqual([{ featureId: 0, shape: [[2]] }]);
    expect(result.appendedShapes).toEqual([[[1]]]);
    expect(result.appendedRecordSource).toEqual([0]);
    expect(result.resultFeatures).toEqual([
      { source: 'source', layer: 'lines', id: 0 },
      { source: 'source', layer: 'lines', id: 1 },
    ]);
    expect(result.splitTargetCount).toBe(1);
    expect(miniLayer.shapes).toEqual(beforeShapes);
    expect(records).toEqual(beforeRecords);
  });

  it('preserves unsplit selected ids in resultFeatures', () => {
    const result = plan([[[0]], [[0]]], [0, 1], [{ featureId: 0, pieces: [[[1]], [[2]]] }]);

    expect(result.resultFeatures).toEqual([
      { source: 'source', layer: 'lines', id: 0 },
      { source: 'source', layer: 'lines', id: 1 },
      { source: 'source', layer: 'lines', id: 2 },
    ]);
  });

  it('uses feature traversal then splitter output order for deterministic multi-target appends', () => {
    const result = plan(
      [[[0]], [[0]], [[0]]],
      [0, 2],
      [
        { featureId: 2, pieces: [[[3]], [[4]]] },
        { featureId: 0, pieces: [[[1]], [[2]]] },
      ],
    );

    expect(result.targetAfterShapes).toEqual([
      { featureId: 0, shape: [[2]] },
      { featureId: 2, shape: [[4]] },
    ]);
    expect(result.appendedShapes).toEqual([[[1]], [[3]]]);
    expect(result.appendedRecordSource).toEqual([0, 2]);
    expect(result.resultFeatures).toEqual([
      { source: 'source', layer: 'lines', id: 0 },
      { source: 'source', layer: 'lines', id: 2 },
      { source: 'source', layer: 'lines', id: 3 },
      { source: 'source', layer: 'lines', id: 4 },
    ]);
  });
});

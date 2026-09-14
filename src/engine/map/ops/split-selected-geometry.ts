import type { MapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type { ArcCollection, PathLayer, PathShape } from '../../../shared/types/mapshaper-types';
import type { FeatureRef } from '../types';
import type { SplitPieces } from './split-selected-line';

interface OrderedPiece {
  shape: PathShape;
  order: number;
  size: number;
}

export interface SplitPiecesPlan {
  /** Per split target: the largest piece as the target's after shape (mini ids). */
  targetAfterShapes: Array<{ featureId: number; shape: PathShape }>;
  /** Remaining pieces in legacy append order (mini ids). */
  appendedShapes: PathShape[];
  /** appendedShapes[i] clones the record of this feature id. */
  appendedRecordSource: number[];
  resultFeatures: FeatureRef[];
  splitTargetCount: number;
}

/**
 * Plans split target replacement and feature appends without modifying the
 * mini dataset. The largest output remains at each original feature id.
 */
export function planSplitPieces(opts: {
  layer: PathLayer;
  selectedIds: ReadonlySet<number>;
  piecesByFeature: ReadonlyArray<SplitPieces>;
  arcs: ArcCollection;
  adapter: MapshaperAdapter;
  sourceId: string;
  layerId: string;
}): SplitPiecesPlan {
  const { layer, selectedIds, piecesByFeature, arcs, adapter, sourceId, layerId } = opts;
  const shapes = layer.shapes;
  if (!shapes) throw new Error('Selected layer changed during split');

  const splitById = new Map(piecesByFeature.map((result) => [result.featureId, result.pieces]));
  const targetAfterShapes: Array<{ featureId: number; shape: PathShape }> = [];
  const appendedShapes: PathShape[] = [];
  const appendedRecordSource: number[] = [];
  const resultFeatures: FeatureRef[] = [];

  for (let featureId = 0; featureId < shapes.length; featureId += 1) {
    const pieces = splitById.get(featureId);
    if (!pieces) {
      if (selectedIds.has(featureId)) {
        resultFeatures.push({ source: sourceId, layer: layerId, id: featureId });
      }
      continue;
    }
    const ordered = pieces
      .map<OrderedPiece>((shape, order) => ({
        shape,
        order,
        size:
          layer.geometry_type === 'polygon'
            ? adapter.getShapeArea(shape, arcs)
            : adapter.getShapePerimeter(shape, arcs),
      }))
      .sort((a, b) => b.size - a.size || a.order - b.order);
    const largest = ordered[0];
    if (!largest) throw new Error('Split target has no output pieces');
    targetAfterShapes.push({ featureId, shape: largest.shape });
    resultFeatures.push({ source: sourceId, layer: layerId, id: featureId });
    for (const piece of ordered.slice(1)) {
      appendedShapes.push(piece.shape);
      appendedRecordSource.push(featureId);
    }
  }

  const appendStart = shapes.length;
  for (let id = appendStart; id < appendStart + appendedShapes.length; id += 1) {
    resultFeatures.push({ source: sourceId, layer: layerId, id });
  }
  return {
    targetAfterShapes,
    appendedShapes,
    appendedRecordSource,
    resultFeatures,
    splitTargetCount: splitById.size,
  };
}

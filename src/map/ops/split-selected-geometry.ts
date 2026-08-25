import type { MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import type { FeatureRef, SplitSelectedResult } from '../types';
import type { PreparedDatasetMutationResult } from './_context';
import type { SplitPieces } from './split-selected-line';

interface OrderedPiece {
  shape: PathShape;
  order: number;
  size: number;
}

/**
 * Replaces split targets without moving any existing feature. The largest
 * result remains at its original id; all smaller results are appended after
 * the original layer contents in target and splitter output order.
 */
export function applySplitPieces(
  dataset: MapshaperDataset,
  layerIndex: number,
  sourceId: string,
  layerId: string,
  selectedIds: ReadonlySet<number>,
  piecesByFeature: ReadonlyArray<SplitPieces>,
  temporaryLayerCount: number,
  adapter: MapshaperAdapter,
): PreparedDatasetMutationResult<SplitSelectedResult> {
  const layer = dataset.layers[layerIndex];
  if (
    !layer ||
    (layer.geometry_type !== 'polygon' && layer.geometry_type !== 'polyline') ||
    !layer.shapes
  ) {
    throw new Error('Selected layer changed during split');
  }
  const pathLayer = layer as PathLayer;
  const shapes = pathLayer.shapes;
  if (!shapes) throw new Error('Selected layer changed during split');
  const arcs = dataset.arcs;
  if (!arcs) throw new Error('Selected layer has no path geometry');

  const splitById = new Map(piecesByFeature.map((result) => [result.featureId, result.pieces]));
  const originalLength = shapes.length;
  const records = pathLayer.data?.getRecords?.();
  const appendedShapes: PathShape[] = [];
  const appendedRecords: Record<string, unknown>[] = [];
  const resultFeatures: FeatureRef[] = [];

  for (let featureId = 0; featureId < originalLength; featureId += 1) {
    const pieces = splitById.get(featureId);
    if (!pieces) {
      if (selectedIds.has(featureId))
        resultFeatures.push({ source: sourceId, layer: layerId, id: featureId });
      continue;
    }
    const ordered = pieces
      .map<OrderedPiece>((shape, order) => ({
        shape,
        order,
        size:
          pathLayer.geometry_type === 'polygon'
            ? adapter.getShapeArea(shape, arcs)
            : adapter.getShapePerimeter(shape, arcs),
      }))
      .sort((a, b) => b.size - a.size || a.order - b.order);
    const largest = ordered[0];
    if (!largest) throw new Error('Split target has no output pieces');
    shapes[featureId] = largest.shape;
    if (records) records[featureId] = { ...(records[featureId] ?? {}) };
    resultFeatures.push({ source: sourceId, layer: layerId, id: featureId });
    for (const piece of ordered.slice(1)) {
      appendedShapes.push(piece.shape);
      if (records) appendedRecords.push({ ...(records[featureId] ?? {}) });
    }
  }

  const appendStart = shapes.length;
  shapes.push(...appendedShapes);
  if (records) records.push(...appendedRecords);
  for (let id = appendStart; id < shapes.length; id += 1) {
    resultFeatures.push({ source: sourceId, layer: layerId, id });
  }

  if (temporaryLayerCount > 0)
    dataset.layers.splice(dataset.layers.length - temporaryLayerCount, temporaryLayerCount);
  adapter.cleanArcReferences(dataset);
  return {
    value: { splitTargetCount: splitById.size, resultFeatures },
    selection: resultFeatures,
  };
}

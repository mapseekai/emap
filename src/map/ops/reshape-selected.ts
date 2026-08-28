import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { Err, okValue, type OpResult } from '../op-result';
import type { ReshapeSelectedOptions, ReshapeSelectedResult } from '../types';
import { normalizeConsecutiveCoordinates, unsignedArcId, type Coordinate } from './geometry-2d';
import { reshapeSelectedPolylines } from './reshape-selected-line';
import { reshapeSelectedPolygon } from './reshape-selected-polygon';
import { SplitGeometryValidationError } from './split-selected-error';
import type { OpContext } from './_context';
import { getLayerId } from '../../source/layer-utils';
import type { FeatureRef } from '../types';

function isFiniteCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

function isReshapeLine(value: unknown): value is Array<[number, number]> {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(isFiniteCoordinate) &&
    normalizeConsecutiveCoordinates(value).length >= 2
  );
}

function validatePolylineFeature(
  layer: PathLayer,
  featureId: number,
  arcs: NonNullable<MapshaperDataset['arcs']>,
): void {
  const shape = layer.shapes?.[featureId];
  if (!shape || shape.length === 0 || shape.some((part) => part.length === 0)) {
    throw new SplitGeometryValidationError('geometry', 'polyline geometry is invalid');
  }
  for (const part of shape as PathShape) {
    for (const signedArcId of part) {
      const arcId = unsignedArcId(signedArcId);
      if (!Number.isSafeInteger(signedArcId) || arcId < 0 || arcId >= arcs.size()) {
        throw new SplitGeometryValidationError('geometry', 'polyline geometry is invalid');
      }
      const iterator = arcs.getArcIter(arcId);
      let vertices = 0;
      while (iterator.hasNext()) {
        if (!Number.isFinite(iterator.x) || !Number.isFinite(iterator.y)) {
          throw new SplitGeometryValidationError('geometry', 'polyline geometry is invalid');
        }
        vertices += 1;
      }
      if (vertices < 2)
        throw new SplitGeometryValidationError('geometry', 'polyline geometry is invalid');
    }
  }
}

/**
 * Reshape every path feature contacted by a user-drawn line, QGIS-style: no
 * selection is required. All polygon features whose boundary the line enters
 * and leaves, and all polyline features with at least two contacts, are
 * reshaped. Sources are scanned in registry order; each contacted source is
 * committed as its own undo step.
 */
export async function reshapeSelected(
  ctx: OpContext,
  options: ReshapeSelectedOptions,
): Promise<OpResult<ReshapeSelectedResult>> {
  const line: unknown = options.line;
  if (!isReshapeLine(line)) return Err.validation('line', 'line coordinates are invalid');
  const normalizedLine = normalizeConsecutiveCoordinates(line as Coordinate[]);
  const adapter = getDefaultMapshaperAdapter();
  let reshapedCount = 0;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    const result = await ctx.runPreparedDatasetMutation(
      sourceId,
      (value: ReshapeSelectedResult) =>
        `Reshape ${value.reshapedCount} feature${value.reshapedCount === 1 ? '' : 's'}`,
      (working, original) => {
        if (original !== dataset) return Err.staleOperation(sourceId, 'Reshape features');
        if (!working.arcs) {
          return Err.validation('geometry', 'path geometry is invalid');
        }
        const workingArcs = working.arcs;
        const changed: FeatureRef[] = [];
        try {
          for (let layerIndex = 0; layerIndex < working.layers.length; layerIndex++) {
            const layer = working.layers[layerIndex];
            if (
              !isPathLayer(layer) ||
              (layer.geometry_type !== 'polygon' && layer.geometry_type !== 'polyline') ||
              !layer.shapes
            )
              continue;
            const layerId = getLayerId(layer, layerIndex);
            if (layer.geometry_type === 'polygon') {
              for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
                let shape: PathShape | null = null;
                try {
                  shape = reshapeSelectedPolygon(
                    working,
                    layerIndex,
                    featureId,
                    normalizedLine,
                    adapter,
                  );
                } catch (error) {
                  if (!(error instanceof SplitGeometryValidationError)) throw error;
                }
                if (!shape) continue;
                layer.shapes.splice(featureId, 1, shape);
                changed.push({ source: sourceId, layer: layerId, id: featureId });
              }
            } else {
              const ids = new Set<number>();
              for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
                try {
                  validatePolylineFeature(layer, featureId, workingArcs);
                  ids.add(featureId);
                } catch (error) {
                  if (!(error instanceof SplitGeometryValidationError)) throw error;
                }
              }
              const reshaped = reshapeSelectedPolylines(
                working,
                layerIndex,
                ids,
                normalizedLine,
                adapter,
              );
              for (const { featureId, shape } of reshaped) {
                layer.shapes.splice(featureId, 1, shape);
                changed.push({ source: sourceId, layer: layerId, id: featureId });
              }
            }
          }
        } catch (error) {
          if (error instanceof SplitGeometryValidationError)
            return Err.validation(error.field, error.reason);
          throw error;
        }
        if (changed.length === 0) return Err.validation('line', 'did not reshape any feature');
        return {
          value: { reshapedCount: changed.length },
          selection: ctx.host._selection.getAll(),
        };
      },
    );
    if (result.ok) {
      reshapedCount += result.value.reshapedCount;
      continue;
    }
    if (result.error.kind !== 'validation') return result;
  }
  if (reshapedCount === 0) return Err.validation('line', 'did not reshape any feature');
  return okValue({ reshapedCount });
}

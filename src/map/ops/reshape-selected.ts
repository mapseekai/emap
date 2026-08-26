import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { Err, type OpResult } from '../op-result';
import type { ReshapeSelectedOptions, ReshapeSelectedResult } from '../types';
import { normalizeConsecutiveCoordinates, unsignedArcId, type Coordinate } from './geometry-2d';
import { reshapeSelectedPolylines } from './reshape-selected-line';
import { reshapeSelectedPolygon } from './reshape-selected-polygon';
import { SplitGeometryValidationError } from './split-selected-error';
import type { OpContext } from './_context';

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

function validateSelectedPolylines(
  layer: PathLayer,
  selectedIds: ReadonlySet<number>,
  arcs: NonNullable<MapshaperDataset['arcs']>,
): void {
  for (const featureId of selectedIds) {
    const shape = layer.shapes?.[featureId];
    if (!shape || shape.length === 0 || shape.some((part) => part.length === 0)) {
      throw new SplitGeometryValidationError('geometry', 'selected polyline geometry is invalid');
    }
    for (const part of shape as PathShape) {
      for (const signedArcId of part) {
        const arcId = unsignedArcId(signedArcId);
        if (!Number.isSafeInteger(signedArcId) || arcId < 0 || arcId >= arcs.size()) {
          throw new SplitGeometryValidationError('geometry', 'selected polyline geometry is invalid');
        }
        const iterator = arcs.getArcIter(arcId);
        let vertices = 0;
        while (iterator.hasNext()) {
          if (!Number.isFinite(iterator.x) || !Number.isFinite(iterator.y)) {
            throw new SplitGeometryValidationError('geometry', 'selected polyline geometry is invalid');
          }
          vertices += 1;
        }
        if (vertices < 2)
          throw new SplitGeometryValidationError('geometry', 'selected polyline geometry is invalid');
      }
    }
  }
}

/** Reshape selected polyline features along a user-drawn line. */
export async function reshapeSelected(
  ctx: OpContext,
  options: ReshapeSelectedOptions,
): Promise<OpResult<ReshapeSelectedResult>> {
  const refs = ctx.host._selection.getAll();
  if (refs.length === 0) return Err.validation('selection', 'select at least one feature');

  const sourceId = refs[0]!.source;
  const layerId = refs[0]!.layer;
  if (refs.some((ref) => ref.source !== sourceId || ref.layer !== layerId)) {
    return Err.validation('selection', 'selection spans multiple sources or layers');
  }
  const line: unknown = options.line;
  if (!isReshapeLine(line)) return Err.validation('line', 'line coordinates are invalid');

  const source = ctx.host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  const layer = ctx.host.layers.resolve(sourceId, layerId);
  if (!layer) return Err.notFound('layer', layerId);
  if (!isPathLayer(layer)) return Err.validation('layer', 'selected layer has no reshapeable path geometry');
  if (!layer.shapes) return Err.validation('layer', 'selected layer has no shapes');

  const selectedIds = new Set<number>();
  for (const ref of refs) {
    if (
      !Number.isInteger(ref.id) ||
      ref.id < 0 ||
      ref.id >= layer.shapes.length ||
      layer.shapes[ref.id] === null
    ) {
      return Err.validation('selection', `selected feature ${ref.id} has no geometry`);
    }
    selectedIds.add(ref.id);
  }

  const callTimeDataset = source.getDataset();
  if (!callTimeDataset) return Err.notFound('source', sourceId);
  const adapter = getDefaultMapshaperAdapter();
  const normalizedLine = normalizeConsecutiveCoordinates(line as Coordinate[]);

  return ctx.runPreparedDatasetMutation(
    sourceId,
    (value) => `Reshape ${value.reshapedCount} feature${value.reshapedCount === 1 ? '' : 's'}`,
    (working, original) => {
      if (original !== callTimeDataset) return Err.staleOperation(sourceId, 'Reshape selected features');
      try {
        const workingLayer = ctx.host.layers.resolveInLayers(working.layers, layerId);
        if (!workingLayer || !isPathLayer(workingLayer) || !workingLayer.shapes) {
          return Err.staleOperation(sourceId, 'Reshape selected features');
        }
        const workingLayerIndex = working.layers.indexOf(workingLayer);
        if (workingLayerIndex === -1) return Err.staleOperation(sourceId, 'Reshape selected features');
        if (!working.arcs) {
          throw new SplitGeometryValidationError(
            'geometry',
            `selected ${workingLayer.geometry_type} geometry is invalid`,
          );
        }
        if (workingLayer.geometry_type === 'polygon') {
          const reshaped = [...selectedIds].flatMap((featureId) => {
            const shape = reshapeSelectedPolygon(
              working,
              workingLayerIndex,
              featureId,
              normalizedLine,
              adapter,
            );
            return shape ? [{ featureId, shape }] : [];
          });
          if (reshaped.length === 0)
            return Err.validation('line', 'did not reshape any selected feature');
          for (const { featureId, shape } of reshaped) workingLayer.shapes.splice(featureId, 1, shape);
          return { value: { reshapedCount: reshaped.length }, selection: refs };
        }
        validateSelectedPolylines(workingLayer, selectedIds, working.arcs);
        const reshaped = reshapeSelectedPolylines(
          working,
          workingLayerIndex,
          selectedIds,
          normalizedLine,
          adapter,
        );
        if (reshaped.length === 0)
          return Err.validation('line', 'did not reshape any selected feature');
        for (const { featureId, shape } of reshaped) workingLayer.shapes.splice(featureId, 1, shape);
        return { value: { reshapedCount: reshaped.length }, selection: refs };
      } catch (error) {
        if (error instanceof SplitGeometryValidationError) return Err.validation(error.field, error.reason);
        throw error;
      }
    },
  );
}

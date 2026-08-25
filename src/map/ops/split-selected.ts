import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { isPathLayer } from '../../types/mapshaper-types';
import { Err, type OpResult } from '../op-result';
import type { SplitCutter, SplitSelectedOptions, SplitSelectedResult } from '../types';
import { applySplitPieces } from './split-selected-geometry';
import { SplitGeometryValidationError } from './split-selected-error';
import { splitSelectedPolylines } from './split-selected-line';
import { splitSelectedPolygons } from './split-selected-polygon';
import type { OpContext } from './_context';

function isFiniteCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number'
    && Number.isFinite(value[0])
    && typeof value[1] === 'number'
    && Number.isFinite(value[1]);
}

function isSplitCutter(value: unknown): value is SplitCutter {
  if (!value || typeof value !== 'object' || !('type' in value) || !('coordinates' in value)) return false;
  const { type, coordinates } = value;
  if (type === 'point') return isFiniteCoordinate(coordinates);
  if (type !== 'polyline' || !Array.isArray(coordinates) || coordinates.length < 2) return false;
  return coordinates.every(isFiniteCoordinate)
    && coordinates.some((coordinate, index) => index > 0 && (
      coordinate[0] !== coordinates[index - 1]![0]
      || coordinate[1] !== coordinates[index - 1]![1]
    ));
}

/** Split selected lines or polygons with a point or polyline cutter. */
export async function splitSelected(
  ctx: OpContext,
  options: SplitSelectedOptions,
): Promise<OpResult<SplitSelectedResult>> {
  const refs = ctx.host._selection.getAll();
  if (refs.length === 0) return Err.validation('selection', 'select at least one feature');

  const sourceId = refs[0]!.source;
  const layerId = refs[0]!.layer;
  if (refs.some((ref) => ref.source !== sourceId || ref.layer !== layerId)) {
    return Err.validation('selection', 'selection spans multiple sources or layers');
  }
  const cutter: unknown = options.cutter;
  if (!isSplitCutter(cutter)) {
    return Err.validation('cutter', 'cutter coordinates are invalid');
  }

  const source = ctx.host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  const layer = ctx.host.layers.resolve(sourceId, layerId);
  if (!layer) return Err.notFound('layer', layerId);
  if (!isPathLayer(layer)) return Err.validation('layer', 'selected layer has no splittable path geometry');
  if (layer.geometry_type === 'polygon' && cutter.type === 'point') {
    return Err.validation('cutter', 'point cutters can only split polyline features');
  }
  if (!layer.shapes) return Err.validation('layer', 'selected layer has no shapes');

  const selectedIds = new Set<number>();
  for (const ref of refs) {
    if (!Number.isInteger(ref.id) || ref.id < 0 || ref.id >= layer.shapes.length || layer.shapes[ref.id] === null) {
      return Err.validation('selection', `selected feature ${ref.id} has no geometry`);
    }
    selectedIds.add(ref.id);
  }

  const layerIndex = source.getLayers().indexOf(layer);
  if (layerIndex === -1) return Err.notFound('layer', layerId);
  const adapter = getDefaultMapshaperAdapter();
  const originalLayerCount = source.getDataset()?.layers.length ?? 0;

  return ctx.runPreparedDatasetMutation(
    sourceId,
    (value) => `Split ${value.splitTargetCount} feature${value.splitTargetCount === 1 ? '' : 's'}`,
    (working) => {
      try {
        let pieces;
        if (layer.geometry_type === 'polygon') {
          if (cutter.type !== 'polyline') return Err.validation('cutter', 'point cutters can only split polyline features');
          pieces = splitSelectedPolygons(working, layerIndex, selectedIds, cutter, adapter);
        } else {
          const outcome = splitSelectedPolylines(working, layerIndex, selectedIds, cutter, adapter);
          if (cutter.type === 'point' && !outcome.pointOnSelectedPath) {
            throw new SplitGeometryValidationError('cutter', 'point is not on any selected line');
          }
          pieces = outcome.pieces;
        }
        if (pieces.length === 0) return Err.validation('cutter', 'did not split any selected feature');
        return applySplitPieces(
          working,
          layerIndex,
          sourceId,
          layerId,
          selectedIds,
          pieces,
          Math.max(0, working.layers.length - originalLayerCount),
          adapter,
        );
      } catch (error) {
        if (error instanceof SplitGeometryValidationError) return Err.validation(error.field, error.reason);
        throw error;
      }
    },
  );
}

import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { SplitFeaturesCommand } from '../../edit/commands/split-features';
import type { PathShapePatch } from '../../edit/commands/path-geometry-patch';
import type { MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { Err, type OpResult } from '../op-result';
import { resolveLayerInList } from '../layer-registry';
import type { SplitCutter, SplitSelectedOptions, SplitSelectedResult } from '../types';
import { buildMiniDataset, materializeRetainedMiniArcs } from './_mini-dataset';
import { translateMiniDataset, translateShapeFromMini } from './_mini-translate';
import { planSplitPieces } from './split-selected-geometry';
import { SplitGeometryValidationError } from './split-selected-error';
import { splitSelectedPolylines } from './split-selected-line';
import { splitSelectedPolygons } from './split-selected-polygon';
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

function isSplitCutter(value: unknown): value is SplitCutter {
  if (!value || typeof value !== 'object' || !('type' in value) || !('coordinates' in value))
    return false;
  const { type, coordinates } = value;
  if (type === 'point') return isFiniteCoordinate(coordinates);
  if (type !== 'polyline' || !Array.isArray(coordinates) || coordinates.length < 2) return false;
  return (
    coordinates.every(isFiniteCoordinate) &&
    coordinates.some(
      (coordinate, index) =>
        index > 0 &&
        (coordinate[0] !== coordinates[index - 1]![0] ||
          coordinate[1] !== coordinates[index - 1]![1]),
    )
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
        if (!Number.isSafeInteger(signedArcId)) {
          throw new SplitGeometryValidationError(
            'geometry',
            'selected polyline geometry is invalid',
          );
        }
        const arcId = signedArcId < 0 ? -signedArcId - 1 : signedArcId;
        if (!Number.isSafeInteger(arcId) || arcId < 0 || arcId >= arcs.size()) {
          throw new SplitGeometryValidationError(
            'geometry',
            'selected polyline geometry is invalid',
          );
        }
        const iterator = arcs.getArcIter(arcId);
        let vertices = 0;
        while (iterator.hasNext()) {
          if (!Number.isFinite(iterator.x) || !Number.isFinite(iterator.y)) {
            throw new SplitGeometryValidationError(
              'geometry',
              'selected polyline geometry is invalid',
            );
          }
          vertices += 1;
        }
        if (vertices < 2)
          throw new SplitGeometryValidationError(
            'geometry',
            'selected polyline geometry is invalid',
          );
      }
    }
  }
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
  if (!isPathLayer(layer))
    return Err.validation('layer', 'selected layer has no splittable path geometry');
  if (layer.geometry_type === 'polygon' && cutter.type === 'point') {
    return Err.validation('cutter', 'point cutters can only split polyline features');
  }
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
  const callTimeEditVersion = callTimeDataset.editVersion ?? 0;
  const adapter = getDefaultMapshaperAdapter();

  return ctx.runPreparedEditCommand(
    sourceId,
    'Split selected features',
    (planned, mutableSource) => {
      if (planned !== callTimeDataset || (planned.editVersion ?? 0) !== callTimeEditVersion) {
        return Err.staleOperation(sourceId, 'Split selected features');
      }
      const liveLayer = resolveLayerInList(planned.layers, layerId);
      if (!liveLayer || !isPathLayer(liveLayer) || !liveLayer.shapes) {
        return Err.staleOperation(sourceId, 'Split selected features');
      }
      const liveLayerIndex = planned.layers.indexOf(liveLayer);
      if (liveLayerIndex === -1) return Err.staleOperation(sourceId, 'Split selected features');
      const arcs = planned.arcs;
      if (!arcs) return Err.validation('geometry', 'selected polyline geometry is invalid');

      try {
        if (liveLayer.geometry_type === 'polyline') {
          validateSelectedPolylines(liveLayer, selectedIds, arcs);
        }
        const mini = buildMiniDataset({
          dataset: planned,
          candidates: new Map([[liveLayerIndex, selectedIds]]),
          adapter,
        });
        materializeRetainedMiniArcs(mini);
        let pieces;
        if (liveLayer.geometry_type === 'polygon') {
          if (cutter.type !== 'polyline') {
            return Err.validation('cutter', 'point cutters can only split polyline features');
          }
          pieces = splitSelectedPolygons(
            mini.dataset,
            liveLayerIndex,
            selectedIds,
            cutter,
            adapter,
          );
        } else {
          const outcome = splitSelectedPolylines(
            mini.dataset,
            liveLayerIndex,
            selectedIds,
            cutter,
            adapter,
          );
          if (cutter.type === 'point' && !outcome.pointOnSelectedPath) {
            throw new SplitGeometryValidationError('cutter', 'point is not on any selected line');
          }
          pieces = outcome.pieces;
        }
        if (pieces.length === 0)
          return Err.validation('cutter', 'did not split any selected feature');
        const plan = planSplitPieces({
          layer: mini.dataset.layers[liveLayerIndex] as PathLayer,
          selectedIds,
          piecesByFeature: pieces,
          arcs: mini.arcs,
          adapter,
          sourceId,
          layerId,
        });
        const translation = translateMiniDataset({
          mini,
          liveDataset: planned,
          liveArcCount: arcs.size(),
          liveLayers: planned.layers,
          extraShapes: [
            ...plan.targetAfterShapes.map((target) => target.shape),
            ...plan.appendedShapes,
          ],
        });
        if (!translation) return Err.validation('geometry', 'split result translation failed');

        const patchByLocation = new Map<string, PathShapePatch>();
        for (const patch of translation.shapePatches) {
          const patchLayerIndex = planned.layers.indexOf(patch.layer);
          if (patchLayerIndex === -1)
            return Err.validation('geometry', 'split result translation failed');
          patchByLocation.set(`${patchLayerIndex}:${patch.featureId}`, patch);
        }
        for (const { featureId, shape } of plan.targetAfterShapes) {
          let after: PathShape;
          try {
            after = translateShapeFromMini(translation, shape);
          } catch {
            return Err.validation('geometry', 'split result translation failed');
          }
          const before = liveLayer.shapes[featureId] as PathShape | null;
          if (!before) return Err.validation('geometry', 'split result translation failed');
          patchByLocation.set(`${liveLayerIndex}:${featureId}`, {
            layer: liveLayer,
            featureId,
            before: before.map((part) => part.slice()),
            after,
          });
        }

        let appendedShapes: PathShape[];
        try {
          appendedShapes = plan.appendedShapes.map((shape) =>
            translateShapeFromMini(translation, shape),
          );
        } catch {
          return Err.validation('geometry', 'split result translation failed');
        }
        const liveRecords = liveLayer.data?.getRecords?.();
        const appendedRecords = plan.appendedRecordSource.map((featureId) =>
          liveRecords ? { ...(liveRecords[featureId] ?? {}) } : null,
        );
        const command = new SplitFeaturesCommand({
          source: mutableSource,
          shapePatches: [...patchByLocation.values()],
          originalArcCount: arcs.size(),
          appendedArcs: translation.appendedArcs,
          layer: liveLayer,
          appendedShapes,
          appendedRecords,
          originalFeatureCount: liveLayer.shapes.length,
          selection: ctx.host._selection,
          beforeSelection: ctx.host._selection.snapshot(),
          afterSelection: plan.resultFeatures,
          publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
          label: `Split ${plan.splitTargetCount} feature${plan.splitTargetCount === 1 ? '' : 's'}`,
        });
        return {
          value: { splitTargetCount: plan.splitTargetCount, resultFeatures: plan.resultFeatures },
          affectedSourceIds: [sourceId],
          command,
        };
      } catch (error) {
        if (error instanceof SplitGeometryValidationError) {
          return Err.validation(error.field, error.reason);
        }
        throw error;
      }
    },
  );
}

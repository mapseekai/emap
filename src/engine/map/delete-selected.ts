import { Bounds } from '../../domain/geo/bounds';
import { normalizePointShape } from '../../domain/source/layer-utils';
import type { MutableTopologySource } from '../../domain/source/source';
import type { EditCommand } from '../../domain/edit/edit-command';
import { CompositeCommand } from '../../domain/edit/commands/composite';
import {
  BulkFeatureDeleteCommand,
  type BulkFeatureDeleteCommandOptions,
} from '../../domain/edit/commands/feature-delete';
import type { MapshaperLayer, PathShape } from '../../shared/types/mapshaper-types';
import { resolveLayerInList } from './layer-registry';
import type { FeatureRef } from './types';

export interface SelectedFeatureDeletion {
  command: EditCommand;
  sourceIds: string[];
  dirtyBounds: [number, number, number, number] | null;
}

export function deleteSelectedFeatures(
  refs: readonly FeatureRef[],
  sources: ReadonlyMap<string, MutableTopologySource>,
): SelectedFeatureDeletion | null {
  if (refs.length === 0) return null;

  const grouped = groupSelectedFeatureIds(refs);
  const children: EditCommand[] = [];
  let totalDeleted = 0;
  const dirty = new Bounds();
  let bounded = true;

  for (const [sourceId, byLayer] of grouped) {
    const source = sources.get(sourceId);
    if (!source) continue;
    const layers = source.getLayers();
    for (const [layerId, ids] of byLayer) {
      const target = resolveLayerInList(layers, layerId);
      if (!target?.shapes) continue;

      const snapshots = collectDeleteSnapshots(target, ids);
      if (snapshots.length === 0) continue;

      const arcs = source.getArcs?.();
      for (const { shape } of snapshots) {
        if (!shape) continue;
        const bounds = new Bounds();
        if (target.geometry_type === 'point') {
          for (const point of normalizePointShape(shape)) {
            if (!point.every(Number.isFinite)) bounded = false;
            else bounds.mergePoint(point[0], point[1]);
          }
        } else if (arcs?.getSimpleShapeBbox) {
          for (const part of shape as PathShape) {
            const box: number[] = [];
            arcs.getSimpleShapeBbox(part, box);
            if (box.length !== 4 || !box.every(Number.isFinite)) bounded = false;
            else {
              bounds.mergePoint(box[0], box[1]);
              bounds.mergePoint(box[2], box[3]);
            }
          }
        } else bounded = false;
        if (!bounds.hasBounds()) bounded = false;
        dirty.merge(bounds);
      }

      const bulk = new BulkFeatureDeleteCommand({ layer: target, snapshots, source });
      bulk.do();
      children.push(bulk);
      totalDeleted += snapshots.length;
    }
  }

  if (children.length === 0) return null;

  return {
    command: new CompositeCommand(
      children,
      `Delete ${totalDeleted} feature${totalDeleted > 1 ? 's' : ''}`,
    ),
    sourceIds: [...grouped.keys()],
    dirtyBounds:
      bounded && dirty.hasBounds() ? [dirty.xmin, dirty.ymin, dirty.xmax, dirty.ymax] : null,
  };
}

function groupSelectedFeatureIds(
  refs: readonly FeatureRef[],
): globalThis.Map<string, globalThis.Map<string, number[]>> {
  const grouped: globalThis.Map<string, globalThis.Map<string, number[]>> = new globalThis.Map<
    string,
    Map<string, number[]>
  >();
  for (const ref of refs) {
    let bySource = grouped.get(ref.source);
    if (!bySource) {
      bySource = new globalThis.Map();
      grouped.set(ref.source, bySource);
    }
    const ids = bySource.get(ref.layer) ?? [];
    ids.push(ref.id);
    bySource.set(ref.layer, ids);
  }
  return grouped;
}

function collectDeleteSnapshots(
  layer: MapshaperLayer,
  ids: readonly number[],
): BulkFeatureDeleteCommandOptions['snapshots'] {
  const records = layer.data?.getRecords?.();
  const snapshots: BulkFeatureDeleteCommandOptions['snapshots'] = [];
  const seen = new Set<number>();
  for (const featureId of ids) {
    if (seen.has(featureId)) continue;
    seen.add(featureId);
    const shape = layer.shapes?.[featureId];
    if (shape === undefined) continue;
    const record = records ? records[featureId] : null;
    snapshots.push({ id: featureId, shape, record: record ?? null });
  }
  return snapshots;
}

import type { MutableTopologySource } from '../source/source';
import type { EditCommand } from '../edit/edit-command';
import { CompositeCommand } from '../edit/commands/composite';
import {
  BulkFeatureDeleteCommand,
  type BulkFeatureDeleteCommandOptions,
} from '../edit/commands/feature-delete';
import type { MapshaperLayer } from '../types/mapshaper-types';
import { resolveLayerInList } from './layer-registry';
import type { FeatureRef } from './types';

export interface SelectedFeatureDeletion {
  command: EditCommand;
  sourceIds: string[];
}

export function deleteSelectedFeatures(
  refs: readonly FeatureRef[],
  sources: ReadonlyMap<string, MutableTopologySource>,
): SelectedFeatureDeletion | null {
  if (refs.length === 0) return null;

  const grouped = groupSelectedFeatureIds(refs);
  const children: EditCommand[] = [];
  let totalDeleted = 0;

  for (const [sourceId, byLayer] of grouped) {
    const source = sources.get(sourceId);
    if (!source) continue;
    const layers = source.getLayers();
    for (const [layerId, ids] of byLayer) {
      const target = resolveLayerInList(layers, layerId);
      if (!target?.shapes) continue;

      const snapshots = collectDeleteSnapshots(target, ids);
      if (snapshots.length === 0) continue;

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
  };
}

function groupSelectedFeatureIds(
  refs: readonly FeatureRef[],
): globalThis.Map<string, globalThis.Map<string, number[]>> {
  const grouped: globalThis.Map<string, globalThis.Map<string, number[]>> = new globalThis.Map();
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

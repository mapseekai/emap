import {
  getDefaultMapshaperAdapter,
  type ParsedCommand,
} from '../../../integrations/mapshaper/adapter';
import type { MapshaperLayer } from '../../../shared/types/mapshaper-types';
import { Err, type OpResult } from '../op-result';
import type { MergeSelectedOptions } from '../types';
import type { OpContext } from './_context';

const TEMPORARY_LAYER_BASENAME = '__emap_merge_selected';

/**
 * Merge at least two selected features from one source layer into one feature.
 * Polygon selections are geometrically unioned; point and polyline selections
 * retain mapshaper's ordinary dissolve behavior.
 */
export async function mergeSelected(
  ctx: OpContext,
  options: MergeSelectedOptions = {},
): Promise<OpResult> {
  const refs = ctx.host._selection.getAll();
  if (refs.length < 2) {
    return Err.validation('selection', 'select at least two features');
  }

  const sourceId = refs[0].source;
  const layerId = refs[0].layer;
  for (const ref of refs) {
    if (ref.source !== sourceId || ref.layer !== layerId) {
      return Err.validation('selection', 'selection spans multiple sources or layers');
    }
  }

  const attributeSource = options.attributeSource ?? refs[0];
  if (
    !refs.some(
      (ref) =>
        ref.source === attributeSource.source &&
        ref.layer === attributeSource.layer &&
        ref.id === attributeSource.id,
    )
  ) {
    return Err.validation('attributeSource', 'attribute source must belong to the selection');
  }

  const source = ctx.host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  const layer = ctx.host.layers.resolve(sourceId, layerId);
  if (!layer) return Err.notFound('layer', layerId);
  if (
    layer.geometry_type !== 'polygon' &&
    layer.geometry_type !== 'polyline' &&
    layer.geometry_type !== 'point'
  ) {
    return Err.validation('layer', 'selected layer has no mergeable geometry');
  }
  if (!layer.shapes) return Err.validation('layer', 'selected layer has no shapes');

  const records = layer.data?.getRecords?.();
  if (!records) return Err.validation('layer', 'selected layer has no data table');
  const selectedIds = new Set<number>();
  for (const ref of refs) {
    if (
      !Number.isInteger(ref.id) ||
      ref.id < 0 ||
      ref.id >= layer.shapes.length ||
      layer.shapes[ref.id] == null
    ) {
      return Err.validation('selection', `selected feature ${ref.id} has no geometry`);
    }
    selectedIds.add(ref.id);
  }
  if (selectedIds.size < 2) {
    return Err.validation('selection', 'select at least two distinct features');
  }
  if (!records[attributeSource.id]) {
    return Err.validation('attributeSource', 'attribute source has no data record');
  }

  const sourceLayers = source.getLayers();
  const layerIndex = sourceLayers.indexOf(layer);
  if (layerIndex === -1) return Err.notFound('layer', layerId);
  const fields = layer.data?.getFields?.() ?? Object.keys(records[attributeSource.id]);
  const existingNames = new Set(
    sourceLayers.flatMap((candidate) => [candidate.name, candidate.id]).filter(Boolean),
  );
  let temporaryName = TEMPORARY_LAYER_BASENAME;
  let suffix = 2;
  while (existingNames.has(temporaryName)) {
    temporaryName = `${TEMPORARY_LAYER_BASENAME}_${suffix++}`;
  }
  const targetName = layer.name ?? layer.id ?? layerId;
  const dissolveOptions: Record<string, unknown> = {};
  if (fields.length > 0) dissolveOptions.copy_fields = fields;
  const dissolveCommand = layer.geometry_type === 'polygon' ? 'dissolve2' : 'dissolve';
  const commands: ParsedCommand[] = [
    { name: 'target', options: { target: temporaryName } },
    { name: dissolveCommand, options: dissolveOptions },
    { name: 'target', options: { target: `${targetName},${temporaryName}` } },
    { name: 'merge-layers', options: { force: true, name: targetName } },
  ];
  const adapter = getDefaultMapshaperAdapter();

  return ctx.runPreparedDatasetCommandParsed(
    sourceId,
    commands,
    `Merge ${refs.length} features`,
    (working) => {
      const workingLayer = working.layers[layerIndex];
      if (!workingLayer?.shapes) throw new Error(`Layer "${layerId}" changed before merge`);
      const workingRecords = workingLayer.data?.getRecords?.();
      const chosenRecord = workingRecords?.[attributeSource.id];
      if (!workingRecords || !chosenRecord) {
        throw new Error(`Attribute source ${attributeSource.id} changed before merge`);
      }

      const selectedShapes: NonNullable<MapshaperLayer['shapes']> = [];
      const unselectedShapes: NonNullable<MapshaperLayer['shapes']> = [];
      const unselectedRecords: Record<string, unknown>[] = [];
      for (let i = 0; i < workingLayer.shapes.length; i++) {
        const shape = workingLayer.shapes[i] ?? null;
        const record = workingRecords[i] ?? {};
        if (selectedIds.has(i)) {
          selectedShapes.push(shape);
        } else {
          unselectedShapes.push(shape);
          unselectedRecords.push(record);
        }
      }

      workingLayer.shapes = unselectedShapes;
      workingLayer.data = adapter.createDataTable(unselectedRecords);
      working.layers.push({
        name: temporaryName,
        geometry_type: workingLayer.geometry_type,
        shapes: selectedShapes,
        data: adapter.createDataTable(selectedShapes.map(() => ({ ...chosenRecord }))),
      });
    },
  );
}

// dissolveLayer + mergeSelected (related: mergeSelected stamps a
// discriminator field then runs `-dissolve` on it). Both produce a
// merged-feature output via mapshaper's `-dissolve` pipeline.

import { Err, type OpResult } from '../op-result';
import type { DissolveOptions } from '../types';
import type { MapshaperLayer } from '../../types/mapshaper-types';
import type { OpContext } from './_context';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import { defineLayerOp } from './_define';
import { validateFieldList, validateFieldName } from './_fields';

/** Internal field name used by `mergeSelected`'s discriminator pass. */
const MERGE_SELECTED_FIELD = '__emap_merge';

export const dissolveLayer = defineLayerOp<DissolveOptions>({
  name: 'dissolveLayer',
  command: 'dissolve',
  label: (o) => `Dissolve ${o.target}`,
  preGate: (o) => {
    // `field` (single) and `fields` (multi) are mutually exclusive — both
    // set is a configuration error.
    const hasFields = Array.isArray(o.fields) && o.fields.length > 0;
    if (o.field !== undefined && hasFields) {
      return Err.validation('field', '`field` and `fields` are mutually exclusive');
    }

    // mapshaper's -dissolve DEFAULT option is `fields` (comma-list, type
    // strings). A field name containing `,` would silently group by N
    // imaginary fields; reject up-front instead.
    if (o.field !== undefined) {
      const field = validateFieldName('field', o.field);
      if (!field.ok) return field;
    }
  },
  expressions: (o) => [o.calc, o.where],
  validate: (o) => {
    const hasFields = Array.isArray(o.fields) && o.fields.length > 0;
    if (hasFields) {
      const fields = validateFieldList('fields', o.fields);
      if (!fields.ok) return fields;
    }

    const sumFields = validateFieldList('sumFields', o.sumFields);
    if (!sumFields.ok) return sumFields;

    const copyFields = validateFieldList('copyFields', o.copyFields);
    if (!copyFields.ok) return copyFields;
  },
  options: (o) => {
    // Group-by fields. When neither is set, dissolve collapses every
    // feature into one (mapshaper's default for -dissolve with no key).
    const dissolveOpts: Record<string, unknown> = {};
    const hasFields = Array.isArray(o.fields) && o.fields.length > 0;
    if (o.field) {
      dissolveOpts.fields = [o.field];
    } else if (hasFields) {
      const fields = validateFieldList('fields', o.fields);
      if (fields.ok) dissolveOpts.fields = fields.value;
    }

    const sumFields = validateFieldList('sumFields', o.sumFields);
    if (sumFields.ok && sumFields.value.length > 0) dissolveOpts.sum_fields = sumFields.value;

    const copyFields = validateFieldList('copyFields', o.copyFields);
    if (copyFields.ok && copyFields.value.length > 0) dissolveOpts.copy_fields = copyFields.value;

    if (o.calc && o.calc.trim()) dissolveOpts.calc = o.calc;
    if (o.where && o.where.trim()) dissolveOpts.where = o.where;
    if (o.multipart) dissolveOpts.multipart = true;
    if (o.name && o.name.trim()) dissolveOpts.name = o.name;
    if (o.noReplace) dissolveOpts.no_replace = true;
    return dissolveOpts;
  },
});

/**
 * Merge the currently-selected features (when they all share the same
 * source/layer) into one feature via the same `-dissolve` pipeline.
 *
 * Recipe:
 *   1. Stamp a discriminator field directly onto records — selected rows
 *      get `'M'`, unselected rows get a unique `'k_<id>'` so they pass
 *      through dissolve unchanged.
 *   2. Run `-dissolve __emap_merge copy-fields=<all original>`.
 *   3. Drop the discriminator with `-filter-fields __emap_merge invert`.
 *
 * Direct record mutation (instead of an `-each EXPR` pre-pass that
 * embedded `JSON.stringify(selectedIds)` to test membership) keeps the
 * command string size O(1) regardless of selection cardinality.
 */
export async function mergeSelected(ctx: OpContext): Promise<OpResult> {
  const refs = ctx.host._selection.getAll();
  if (refs.length === 0) return Err.validation('selection', 'selection is empty');

  // Reject cross-source / cross-layer selections — mapshaper's dissolve
  // operates on a single layer at a time.
  const sourceId = refs[0].source;
  const layerId = refs[0].layer;
  for (const r of refs) {
    if (r.source !== sourceId || r.layer !== layerId) {
      return Err.validation('selection', 'selection spans multiple sources or layers');
    }
  }

  const layer = ctx.host.layers.resolve(sourceId, layerId);
  if (!layer) return Err.notFound('layer', layerId);

  const ids = refs
    .map((r: { id: number }) => r.id)
    .slice()
    .sort((a: number, b: number) => a - b);

  if (!stampMergeDiscriminator(layer, ids)) {
    return Err.validation('layer', 'layer has no data table; cannot stamp discriminator');
  }

  const commands = buildMergeDissolveCommands(layerId, layer);
  const label = `Merge ${refs.length} feature${refs.length > 1 ? 's' : ''}`;
  const result = await ctx.runDatasetCommandParsed(sourceId, commands, label);
  if (!result.ok) {
    // Pre-stamp mutated the live records. Roll back so the caller's view
    // isn't polluted with our internal field.
    unstampMergeDiscriminator(layer);
  }
  return result;
}

function stampMergeDiscriminator(layer: MapshaperLayer, selectedIds: number[]): boolean {
  const records = layer.data?.getRecords?.();
  if (!records || records.length === 0) return false;
  const selected = new Set<number>(selectedIds);
  for (let i = 0; i < records.length; i++) {
    const r = records[i] ?? {};
    r[MERGE_SELECTED_FIELD] = selected.has(i) ? 'M' : `k_${i}`;
    records[i] = r;
  }
  return true;
}

function unstampMergeDiscriminator(layer: MapshaperLayer): void {
  const records = layer.data?.getRecords?.();
  if (!records) return;
  for (const r of records) {
    if (r && MERGE_SELECTED_FIELD in r) delete r[MERGE_SELECTED_FIELD];
  }
}

function buildMergeDissolveCommands(layerName: string, layer: MapshaperLayer): ParsedCommand[] {
  const dissolveOpts: Record<string, unknown> = { fields: [MERGE_SELECTED_FIELD] };
  const fields = layer.data?.getFields?.();
  if (fields && fields.length > 0) {
    const safeFields = fields.filter((f) => f !== MERGE_SELECTED_FIELD && !f.includes(','));
    if (safeFields.length > 0) dissolveOpts.copy_fields = safeFields;
  }

  return [
    { name: 'target', options: { target: layerName } },
    { name: 'dissolve', options: dissolveOpts },
    { name: 'filter-fields', options: { fields: [MERGE_SELECTED_FIELD], invert: true } },
  ];
}

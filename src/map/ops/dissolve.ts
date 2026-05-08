// dissolveLayer + mergeSelected (related: mergeSelected stamps a
// discriminator field then runs `-dissolve` on it). Both produce a
// merged-feature output via mapshaper's `-dissolve` pipeline.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { DissolveOptions } from '../types';
import type { MapshaperLayer } from '../../types/mapshaper-types';
import type { OpContext } from './_context';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';

/** Internal field name used by `mergeSelected`'s discriminator pass. */
const MERGE_SELECTED_FIELD = '__emap_merge';

export async function dissolveLayer(ctx: OpContext, opts: DissolveOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  // `field` (single) and `fields` (multi) are mutually exclusive — both
  // set is a configuration error.
  const hasFields = Array.isArray(opts.fields) && opts.fields.length > 0;
  if (opts.field !== undefined && hasFields) {
    return Err.validation('field', '`field` and `fields` are mutually exclusive');
  }

  // mapshaper's -dissolve DEFAULT option is `fields` (comma-list, type
  // strings). A field name containing `,` would silently group by N
  // imaginary fields; reject up-front instead.
  if (opts.field !== undefined && (typeof opts.field !== 'string' || opts.field.includes(','))) {
    return Err.validation('field', 'field name must be a string without `,`');
  }
  if (!ctx.host._allowExpressionEvaluation([opts.calc, opts.where], 'dissolveLayer')) {
    return Err.expressionDisabled('dissolveLayer');
  }

  // Group-by fields. When neither is set, dissolve collapses every
  // feature into one (mapshaper's default for -dissolve with no key).
  const dissolveOpts: Record<string, unknown> = {};
  if (opts.field) {
    dissolveOpts.fields = [opts.field];
  } else if (hasFields) {
    const safeFields = opts.fields!.filter((f) => typeof f === 'string' && !f.includes(','));
    if (safeFields.length > 0) dissolveOpts.fields = safeFields;
  }

  const safeFieldList = (list?: string[]) =>
    Array.isArray(list)
      ? list.filter((f) => typeof f === 'string' && !f.includes(','))
      : [];

  const sumFields = safeFieldList(opts.sumFields);
  if (sumFields.length > 0) dissolveOpts.sum_fields = sumFields;

  const copyFields = safeFieldList(opts.copyFields);
  if (copyFields.length > 0) dissolveOpts.copy_fields = copyFields;

  if (opts.calc && opts.calc.trim()) dissolveOpts.calc = opts.calc;
  if (opts.where && opts.where.trim()) dissolveOpts.where = opts.where;
  if (opts.multipart) dissolveOpts.multipart = true;
  if (opts.name && opts.name.trim()) dissolveOpts.name = opts.name;
  if (opts.noReplace) dissolveOpts.no_replace = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'dissolve', options: dissolveOpts },
    ],
    `Dissolve ${opts.target}`,
  );
}

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

  const ids = refs.map((r: { id: number }) => r.id).slice().sort((a: number, b: number) => a - b);

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
    const safeFields = fields.filter(
      (f) => f !== MERGE_SELECTED_FIELD && !f.includes(','),
    );
    if (safeFields.length > 0) dissolveOpts.copy_fields = safeFields;
  }

  return [
    { name: 'target', options: { target: layerName } },
    { name: 'dissolve', options: dissolveOpts },
    { name: 'filter-fields', options: { fields: [MERGE_SELECTED_FIELD], invert: true } },
  ];
}

// dissolveLayer + mergeSelected (related: mergeSelected stamps a
// discriminator field then runs `-dissolve` on it). Both produce a
// merged-feature output via mapshaper's `-dissolve` pipeline.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { DissolveOptions } from '../types';
import type { MapshaperLayer } from '../../types/mapshaper-types';
import type { OpContext } from './_context';

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

  // Build the positional group-by token (single-field convenience or
  // multi-field array). When neither is set, dissolve collapses every
  // feature into one (mapshaper's default for -dissolve with no key).
  let groupToken = '';
  if (opts.field) {
    groupToken = ` ${quoteCliArg(opts.field)}`;
  } else if (hasFields) {
    const safeFields = opts.fields!.filter((f) => typeof f === 'string' && !f.includes(','));
    if (safeFields.length > 0) {
      groupToken = ` ${quoteCliArg(safeFields.join(','))}`;
    }
  }

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-dissolve${groupToken}`,
  ];

  const safeFieldList = (list?: string[]) =>
    Array.isArray(list)
      ? list.filter((f) => typeof f === 'string' && !f.includes(','))
      : [];

  const sumFields = safeFieldList(opts.sumFields);
  if (sumFields.length > 0) parts.push(`sum-fields=${sumFields.join(',')}`);

  const copyFields = safeFieldList(opts.copyFields);
  if (copyFields.length > 0) parts.push(`copy-fields=${copyFields.join(',')}`);

  if (opts.calc && opts.calc.trim()) {
    parts.push(`calc=${quoteCliArg(opts.calc)}`);
  }
  if (opts.where && opts.where.trim()) {
    parts.push(`where=${quoteCliArg(opts.where)}`);
  }
  if (opts.multipart) parts.push('multipart');
  if (opts.name && opts.name.trim()) {
    parts.push(`name=${quoteCliArg(opts.name)}`);
  }
  if (opts.noReplace) parts.push('no-replace');

  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Dissolve ${opts.target}`);
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

  const cmd = buildMergeDissolveCommand(layerId, layer);
  const label = `Merge ${refs.length} feature${refs.length > 1 ? 's' : ''}`;
  const result = await ctx.runDatasetCommand(sourceId, cmd, label);
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

function buildMergeDissolveCommand(layerName: string, layer: MapshaperLayer): string {
  // Build copy-fields= from the layer's data table when one exists.
  // Field names with commas are intentionally rejected (mapshaper's
  // copy-fields= is comma-delimited and does not quote individual entries).
  let copyFieldsArg = '';
  const fields = layer.data?.getFields?.();
  if (fields && fields.length > 0) {
    const safeFields = fields.filter(
      (f) => f !== MERGE_SELECTED_FIELD && !f.includes(','),
    );
    if (safeFields.length > 0) {
      copyFieldsArg = ` copy-fields=${safeFields.join(',')}`;
    }
  }

  return [
    `-target ${quoteCliArg(layerName)}`,
    `-dissolve ${quoteCliArg(MERGE_SELECTED_FIELD)}${copyFieldsArg}`,
    `-filter-fields ${MERGE_SELECTED_FIELD} invert`,
  ].join(' ');
}

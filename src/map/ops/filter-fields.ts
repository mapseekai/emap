// filterFields — retain only the listed attribute fields via mapshaper's
// `-filter-fields`. Pass `invert: true` to drop the listed fields and
// keep the rest.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { FilterFieldsOptions } from '../types';
import type { OpContext } from './_context';

export async function filterFields(
  ctx: OpContext,
  opts: FilterFieldsOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  if (!Array.isArray(opts.fields) || opts.fields.length === 0) {
    return Err.validation('fields', 'must be a non-empty array');
  }
  for (const f of opts.fields) {
    if (typeof f !== 'string' || f.trim().length === 0) {
      return Err.validation('fields', `field name must be a non-empty string: ${String(f)}`);
    }
    if (f.includes(',')) {
      return Err.validation('fields', `field name must not contain ',': ${f}`);
    }
  }

  const list = opts.fields.join(',');
  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-filter-fields ${quoteCliArg(list)}`,
  ];
  if (opts.invert) parts.push('invert');
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Filter fields ${opts.target}`);
}

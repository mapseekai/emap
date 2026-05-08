// sortFeatures — sort features within a layer by a JS expression via
// mapshaper's `-sort`. Bare field names work directly. Default order is
// ascending; pass `descending: true` for the reverse.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { SortFeaturesOptions } from '../types';
import type { OpContext } from './_context';

export async function sortFeatures(
  ctx: OpContext,
  opts: SortFeaturesOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  const expr = (opts.expression ?? '').trim();
  if (expr.length === 0) return Err.validation('expression', 'must be a non-empty expression');
  if (!ctx.host._allowExpressionEvaluation([expr], 'sortFeatures')) {
    return Err.expressionDisabled('sortFeatures');
  }

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-sort ${quoteCliArg(expr)}`,
  ];
  if (opts.descending) parts.push('descending');
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Sort ${opts.target}`);
}

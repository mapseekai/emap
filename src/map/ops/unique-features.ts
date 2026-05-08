// uniqueFeatures — drop duplicate features by an id expression via
// mapshaper's `-uniq`. Pass `'JSON.stringify(this.properties)'` for
// full-record dedupe.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { UniqueFeaturesOptions } from '../types';
import type { OpContext } from './_context';

export async function uniqueFeatures(
  ctx: OpContext,
  opts: UniqueFeaturesOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  const expr = (opts.expression ?? '').trim();
  if (expr.length === 0) return Err.validation('expression', 'must be a non-empty expression');
  if (!ctx.host._allowExpressionEvaluation([expr], 'uniqueFeatures')) {
    return Err.expressionDisabled('uniqueFeatures');
  }
  if (opts.maxCount !== undefined && !(typeof opts.maxCount === 'number' && opts.maxCount > 0)) {
    return Err.validation('maxCount', 'must be a positive number');
  }

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-uniq ${quoteCliArg(expr)}`,
  ];
  if (opts.maxCount !== undefined) parts.push(`max-count=${opts.maxCount}`);
  if (opts.invert) parts.push('invert');
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Uniq ${opts.target}`);
}

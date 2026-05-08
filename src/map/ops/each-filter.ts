// applyExpression / filterFeatures — both run a JS expression per feature
// via mapshaper's `-each` (mutate) or `-filter` (drop). Grouped because
// they share expression-policy gating + similar option shape.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { ApplyExpressionOptions, FilterOptions } from '../types';
import type { OpContext } from './_context';

export async function applyExpression(
  ctx: OpContext,
  opts: ApplyExpressionOptions,
): Promise<OpResult> {
  if (!opts.expression || !opts.expression.trim()) {
    return Err.validation('expression', 'must be a non-empty expression');
  }
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  if (!ctx.host._allowExpressionEvaluation([opts.expression, opts.where], 'applyExpression')) {
    return Err.expressionDisabled('applyExpression');
  }

  const whereArg = opts.where && opts.where.trim()
    ? ` where=${quoteCliArg(opts.where)}`
    : '';
  const cmd = `-target ${quoteCliArg(opts.target)} -each ${quoteCliArg(opts.expression)}${whereArg}`;
  return ctx.runDatasetCommand(opts.source, cmd, `Update ${opts.target}`);
}

export async function filterFeatures(ctx: OpContext, opts: FilterOptions): Promise<OpResult> {
  const hasExpr = !!(opts.expression && opts.expression.trim());
  if (!hasExpr && !opts.removeEmpty) {
    return Err.validation('expression', 'must supply `expression` or `removeEmpty: true`');
  }

  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  if (!ctx.host._allowExpressionEvaluation([opts.expression], 'filterFeatures')) {
    return Err.expressionDisabled('filterFeatures');
  }

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-filter`,
  ];
  if (hasExpr) {
    parts.push(quoteCliArg(opts.expression!));
  }
  if (opts.invert) parts.push('invert');
  if (opts.removeEmpty) parts.push('remove-empty');
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Filter ${opts.target}`);
}

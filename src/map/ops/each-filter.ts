// applyExpression / filterFeatures — both run a JS expression per feature
// via mapshaper's `-each` (mutate) or `-filter` (drop). Grouped because
// they share expression-policy gating + similar option shape.

import { resolveLayerInList } from '../layer-registry';
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

  const eachOpts: Record<string, unknown> = { expression: opts.expression };
  if (opts.where && opts.where.trim()) eachOpts.where = opts.where;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'each', options: eachOpts },
    ],
    `Update ${opts.target}`,
  );
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

  const filterOpts: Record<string, unknown> = {};
  if (hasExpr) filterOpts.expression = opts.expression!;
  if (opts.invert) filterOpts.invert = true;
  if (opts.removeEmpty) filterOpts.remove_empty = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'filter', options: filterOpts },
    ],
    `Filter ${opts.target}`,
  );
}

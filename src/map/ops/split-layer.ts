// splitLayer — partition a single layer into one output layer per
// distinct grouping value via mapshaper's `-split`. The `expression`
// argument may be a bare field name or a JS expression — mapshaper
// auto-detects.
//
// v1 omits the `apart` flag (which produces independent datasets); the
// one-source-one-dataset model in emap doesn't expose those. Use
// `loadSnapshot` with `defaultIds` if that workflow is needed.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { SplitLayerOptions } from '../types';
import type { OpContext } from './_context';

export async function splitLayer(
  ctx: OpContext,
  opts: SplitLayerOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  const expr = (opts.expression ?? '').trim();
  if (expr.length === 0) return Err.validation('expression', 'must be a non-empty expression');
  if (!ctx.host._allowExpressionEvaluation([expr], 'splitLayer')) {
    return Err.expressionDisabled('splitLayer');
  }

  const splitOpts: Record<string, unknown> = { expression: expr };
  if (opts.noReplace) splitOpts.no_replace = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'split', options: splitOpts },
    ],
    `Split ${opts.target}`,
  );
}

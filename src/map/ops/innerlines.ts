// innerlinesLayer — convert a polygon layer to a polyline layer along
// shared polygon edges via mapshaper's `-innerlines`. Useful for
// cartographic styling: render internal administrative borders as a
// separately-stylable line layer alongside the original polygons.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { InnerlinesOptions } from '../types';
import type { OpContext } from './_context';

export async function innerlinesLayer(
  ctx: OpContext,
  opts: InnerlinesOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  if (!ctx.host._allowExpressionEvaluation([opts.where], 'innerlinesLayer')) {
    return Err.expressionDisabled('innerlinesLayer');
  }

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-innerlines`,
  ];
  if (opts.where && opts.where.trim()) {
    parts.push(`where=${quoteCliArg(opts.where)}`);
  }
  if (opts.name && opts.name.trim()) {
    parts.push(`name=${quoteCliArg(opts.name)}`);
  }
  if (opts.noReplace) {
    parts.push('no-replace');
  }
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Innerlines ${opts.target}`);
}

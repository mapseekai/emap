// innerlinesLayer — convert a polygon layer to a polyline layer along
// shared polygon edges via mapshaper's `-innerlines`. Useful for
// cartographic styling: render internal administrative borders as a
// separately-stylable line layer alongside the original polygons.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { InnerlinesOptions } from '../types';
import type { OpContext } from './_context';

export async function innerlinesLayer(ctx: OpContext, opts: InnerlinesOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  if (!ctx.host._allowExpressionEvaluation([opts.where], 'innerlinesLayer')) {
    return Err.expressionDisabled('innerlinesLayer');
  }

  const innerOpts: Record<string, unknown> = {};
  if (opts.where && opts.where.trim()) innerOpts.where = opts.where;
  if (opts.name && opts.name.trim()) innerOpts.name = opts.name;
  if (opts.noReplace) innerOpts.no_replace = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'innerlines', options: innerOpts },
    ],
    `Innerlines ${opts.target}`,
  );
}

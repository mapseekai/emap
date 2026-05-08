// divideLayer — cut a polyline `target` layer at the boundaries of a
// polygon `divider` layer in the same source via mapshaper's `-divide`.
// Each resulting line segment inherits the underlying polygon's
// attributes (subset by `fields` when supplied).

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { DivideOptions } from '../types';
import type { OpContext } from './_context';

export async function divideLayer(ctx: OpContext, opts: DivideOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  const targetLayer = resolveLayerInList(dataset.layers, opts.target);
  if (!targetLayer) return Err.notFound('layer', opts.target);
  if (targetLayer.geometry_type !== 'polyline') {
    return Err.validation('target', `expected polyline layer, got ${targetLayer.geometry_type ?? 'unknown'}`);
  }
  const dividerLayer = resolveLayerInList(dataset.layers, opts.divider);
  if (!dividerLayer) return Err.notFound('divider', opts.divider);
  if (dividerLayer.geometry_type !== 'polygon') {
    return Err.validation('divider', `expected polygon layer, got ${dividerLayer.geometry_type ?? 'unknown'}`);
  }

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-divide source=${quoteCliArg(opts.divider)}`,
  ];
  if (opts.fields && opts.fields.length > 0) {
    const safe = opts.fields.filter((f) => !f.includes(','));
    if (safe.length > 0) parts.push(`fields=${safe.join(',')}`);
  }
  if (opts.force) parts.push('force');
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Divide ${opts.target}`);
}

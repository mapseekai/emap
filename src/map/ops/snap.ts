// snapLayer — snap nearby vertices together via mapshaper's `-snap`.
// Targeted fix for almost-but-not-quite-coincident vertices left over
// from reprojection, manual digitisation, or merged sources.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { SnapOptions } from '../types';
import type { OpContext } from './_context';

export async function snapLayer(ctx: OpContext, opts: SnapOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-snap`,
  ];
  if (typeof opts.interval === 'number') {
    parts.push(String(opts.interval));
  }
  if (opts.endpoints) {
    parts.push('endpoints');
  }
  if (typeof opts.precision === 'number') {
    parts.push(`precision=${opts.precision}`);
  }
  if (opts.fixGeometry) {
    parts.push('fix-geometry');
  }
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Snap ${opts.target}`);
}

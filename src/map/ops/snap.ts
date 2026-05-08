// snapLayer — snap nearby vertices together via mapshaper's `-snap`.
// Targeted fix for almost-but-not-quite-coincident vertices left over
// from reprojection, manual digitisation, or merged sources.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { SnapOptions } from '../types';
import type { OpContext } from './_context';

export async function snapLayer(ctx: OpContext, opts: SnapOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  const snapOpts: Record<string, unknown> = {};
  if (typeof opts.interval === 'number') snapOpts.interval = String(opts.interval);
  if (opts.endpoints) snapOpts.endpoints = true;
  if (typeof opts.precision === 'number') snapOpts.precision = opts.precision;
  if (opts.fixGeometry) snapOpts.fix_geometry = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'snap', options: snapOpts },
    ],
    `Snap ${opts.target}`,
  );
}

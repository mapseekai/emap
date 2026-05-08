// explodeLayer — divide multi-part features into single-part features via
// mapshaper's `-explode`. Each part inherits the original record's
// attributes; useful for unpacking multipolygon islands, multipart
// polylines, or multipoint clusters into individually-pickable features.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { ExplodeOptions } from '../types';
import type { OpContext } from './_context';

export async function explodeLayer(ctx: OpContext, opts: ExplodeOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  const cmd = `-target ${quoteCliArg(opts.target)} -explode`;
  return ctx.runDatasetCommand(opts.source, cmd, `Explode ${opts.target}`);
}

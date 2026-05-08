// dropLayer — delete a single layer from the source dataset via
// mapshaper's `-drop`. mapshaper's `-drop` is multi-modal (layer /
// geometry / holes / fields); this op wraps only the "drop the entire
// layer" mode. Use `filterFields` for the field-drop case.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { DropLayerOptions } from '../types';
import type { OpContext } from './_context';

export async function dropLayer(ctx: OpContext, opts: DropLayerOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  const cmd = `-target ${quoteCliArg(opts.target)} -drop`;
  return ctx.runDatasetCommand(opts.source, cmd, `Drop ${opts.target}`);
}

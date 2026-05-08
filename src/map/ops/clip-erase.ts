// clipLayer / eraseLayer — clip a target polygon layer to (or against) a
// mask polygon layer in the same source. Uses mapshaper's `-clip` /
// `-erase` pipelines.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { ClipEraseOptions } from '../types';
import type { OpContext } from './_context';

export async function clipLayer(ctx: OpContext, opts: ClipEraseOptions): Promise<OpResult> {
  return _runClipErase(ctx, opts, 'clip');
}

export async function eraseLayer(ctx: OpContext, opts: ClipEraseOptions): Promise<OpResult> {
  return _runClipErase(ctx, opts, 'erase');
}

async function _runClipErase(
  ctx: OpContext,
  opts: ClipEraseOptions,
  op: 'clip' | 'erase',
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  // Validate that both target and mask resolve to layers in this source's
  // dataset. mapshaper would throw an opaque error otherwise.
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  if (!resolveLayerInList(dataset.layers, opts.mask)) return Err.notFound('mask', opts.mask);

  const verb = op === 'clip' ? 'Clip' : 'Erase';
  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: op, options: { source: opts.mask } },
    ],
    `${verb} ${opts.target}`,
  );
}

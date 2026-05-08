// mosaicLayer — flatten overlapping polygons in a single layer into a
// tile mosaic via mapshaper's `-mosaic`. Every overlap region becomes
// its own polygon; gaps are preserved.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { MosaicOptions } from '../types';
import type { OpContext } from './_context';

export async function mosaicLayer(ctx: OpContext, opts: MosaicOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  if (!ctx.host._allowExpressionEvaluation([opts.calc], 'mosaicLayer')) {
    return Err.expressionDisabled('mosaicLayer');
  }

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-mosaic`,
  ];
  if (typeof opts.snapInterval === 'number') {
    parts.push(`snap-interval=${opts.snapInterval}`);
  }
  if (opts.noSnap) {
    parts.push('no-snap');
  }
  if (opts.noReplace) {
    parts.push('no-replace');
  }
  if (opts.name && opts.name.trim()) {
    parts.push(`name=${quoteCliArg(opts.name)}`);
  }
  if (opts.calc && opts.calc.trim()) {
    parts.push(`calc=${quoteCliArg(opts.calc)}`);
  }
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Mosaic ${opts.target}`);
}

// mosaicLayer — flatten overlapping polygons in a single layer into a
// tile mosaic via mapshaper's `-mosaic`. Every overlap region becomes
// its own polygon; gaps are preserved.

import { resolveLayerInList } from '../layer-registry';
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

  const options: Record<string, unknown> = {};
  if (typeof opts.snapInterval === 'number') options.snap_interval = String(opts.snapInterval);
  if (opts.noSnap) options.no_snap = true;
  if (opts.noReplace) options.no_replace = true;
  if (opts.name && opts.name.trim()) options.name = opts.name;
  if (opts.calc && opts.calc.trim()) options.calc = opts.calc;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'mosaic', options },
    ],
    `Mosaic ${opts.target}`,
  );
}

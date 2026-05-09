// filterSlivers — drop sliver polygons (the tiny artifacts left over
// after clip / erase / dissolve) via mapshaper's `-filter-slivers`.
//
// Distinct from `filterIslands`: islands are entire disconnected
// polygon parts; slivers are whole features whose total area is
// below threshold.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { FilterSliversOptions } from '../types';
import type { OpContext } from './_context';

export async function filterSlivers(
  ctx: OpContext,
  opts: FilterSliversOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  if (typeof opts.minArea !== 'number'
    || !Number.isFinite(opts.minArea)
    || opts.minArea <= 0) {
    return Err.validation('minArea', 'must be a positive finite number');
  }

  const o: Record<string, unknown> = { min_area: String(opts.minArea) };
  if (opts.weighted) o.weighted = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'filter-slivers', options: o },
    ],
    `Filter slivers ${opts.target}`,
  );
}

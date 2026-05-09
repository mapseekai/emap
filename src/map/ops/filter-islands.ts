// filterIslands — drop tiny disconnected polygon parts (digitisation
// noise, single-pixel dots, etc.) via mapshaper's `-filter-islands`.
// Operates on polygon layers; on polylines mapshaper accepts the
// command but it's typically a no-op.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { FilterIslandsOptions } from '../types';
import type { OpContext } from './_context';

export async function filterIslands(
  ctx: OpContext,
  opts: FilterIslandsOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  const hasMinArea = typeof opts.minArea === 'number' && Number.isFinite(opts.minArea);
  const hasMinVertices = typeof opts.minVertices === 'number'
    && Number.isInteger(opts.minVertices)
    && opts.minVertices > 0;
  if (!hasMinArea && !hasMinVertices) {
    return Err.validation('minArea', 'must supply at least one of `minArea` or `minVertices`');
  }
  if (hasMinArea && opts.minArea! < 0) {
    return Err.validation('minArea', 'must be non-negative');
  }

  const o: Record<string, unknown> = {};
  if (hasMinArea) o.min_area = String(opts.minArea);
  if (hasMinVertices) o.min_vertices = opts.minVertices;
  if (opts.removeEmpty) o.remove_empty = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'filter-islands', options: o },
    ],
    `Filter islands ${opts.target}`,
  );
}

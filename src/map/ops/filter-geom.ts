// filterGeom — keep only features whose geometry intersects a bbox
// (mapshaper's `-filter-geom`).
//
// For attribute-predicate filtering, use `filterFeatures` (`-filter`)
// instead. mapshaper's filter-geom currently only ships the bbox
// predicate; that's what this op exposes.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { FilterGeomOptions } from '../types';
import type { OpContext } from './_context';

export async function filterGeom(
  ctx: OpContext,
  opts: FilterGeomOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  const b = opts.bbox;
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => Number.isFinite(n))) {
    return Err.validation('bbox', 'must be [xmin, ymin, xmax, ymax] of finite numbers');
  }
  if (b[0] >= b[2] || b[1] >= b[3]) {
    return Err.validation('bbox', 'must satisfy xmin<xmax and ymin<ymax');
  }

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'filter-geom', options: { bbox: [b[0], b[1], b[2], b[3]] } },
    ],
    `Filter geom ${opts.target}`,
  );
}

// projectLayer — reproject coordinates via mapshaper's `-proj` (Proj.4).
// The destination `crs` accepts EPSG codes (`'EPSG:3857'`), aliases
// (`'webmercator'`, `'robinson'`, `'wgs84'`), or full Proj.4 strings.
// `target` is optional; when omitted, the whole source dataset is
// reprojected.
//
// Note: the source's stored CRS metadata is updated by mapshaper inside
// the dataset, but emap does NOT auto-fit the viewport to the new
// projected extent. Call `setExtent(source.getExtent())` after
// `await projectLayer(...)` to recentre.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { ProjectOptions } from '../types';
import type { OpContext } from './_context';

export async function projectLayer(ctx: OpContext, opts: ProjectOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (opts.target !== undefined) {
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  }
  const crs = (opts.crs ?? '').trim();
  if (crs.length === 0) return Err.validation('crs', 'must be a non-empty CRS string');

  const parts: string[] = [];
  if (opts.target) parts.push(`-target ${quoteCliArg(opts.target)}`);
  parts.push(`-proj ${quoteCliArg(crs)}`);
  if (opts.init && opts.init.trim()) {
    parts.push(`init=${quoteCliArg(opts.init)}`);
  }
  if (opts.densify) parts.push('densify');

  const label = `Project ${opts.target ?? opts.source}`;
  return ctx.runDatasetCommand(opts.source, parts.join(' '), label);
}

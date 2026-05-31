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
import { Err, type OpResult } from '../op-result';
import type { ProjectOptions } from '../types';
import type { OpContext } from './_context';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import { EpsgProjectionError, resolveProjectCrs } from '../../geo/crs-resolver';

export async function projectLayer(ctx: OpContext, opts: ProjectOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (opts.target !== undefined) {
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  }
  const rawCrs = opts.crs ?? '';
  if (rawCrs.trim().length === 0) return Err.validation('crs', 'must be a non-empty CRS string');

  let crs: string;
  let init: string | undefined;
  try {
    crs = await resolveProjectCrs(rawCrs);
    if (opts.init && opts.init.trim()) init = await resolveProjectCrs(opts.init);
  } catch (err) {
    if (err instanceof EpsgProjectionError) return Err.validation('crs', err.message);
    throw err;
  }

  const projOpts: Record<string, unknown> = { crs };
  if (init) projOpts.init = init;
  if (opts.densify) projOpts.densify = true;

  const commands: ParsedCommand[] = [];
  if (opts.target) commands.push({ name: 'target', options: { target: opts.target } });
  // mapshaper exposes the command as `-proj` but parseCommands canonicalises
  // its name to `proj`; emit that form directly.
  commands.push({ name: 'proj', options: projOpts });

  const label = `Project ${opts.target ?? opts.source}`;
  return ctx.runDatasetCommandParsed(opts.source, commands, label);
}

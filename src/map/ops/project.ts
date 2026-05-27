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

export async function projectLayer(ctx: OpContext, opts: ProjectOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (opts.target !== undefined) {
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  }
  const crs = normalizeProjectCrs(opts.crs ?? '');
  if (crs.length === 0) return Err.validation('crs', 'must be a non-empty CRS string');

  const projOpts: Record<string, unknown> = { crs };
  if (opts.init && opts.init.trim()) projOpts.init = normalizeProjectCrs(opts.init);
  if (opts.densify) projOpts.densify = true;

  const commands: ParsedCommand[] = [];
  if (opts.target) commands.push({ name: 'target', options: { target: opts.target } });
  // mapshaper exposes the command as `-proj` but parseCommands canonicalises
  // its name to `proj`; emit that form directly.
  commands.push({ name: 'proj', options: projOpts });

  const label = `Project ${opts.target ?? opts.source}`;
  return ctx.runDatasetCommandParsed(opts.source, commands, label);
}

// Outbound boundary translation: canonical EPSG → mapshaper's preferred alias.
// Mirror of `normalizeCrsString` in `geo/crs-resolver.ts`, which goes the
// other way (raw metadata → canonical EPSG) when reading datasets in.
function normalizeProjectCrs(crs: string): string {
  const trimmed = crs.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'epsg:3857' || lower === 'epsg:900913' || lower === 'epsg:102100') {
    return 'webmercator';
  }
  if (lower === 'epsg:4326') {
    return 'wgs84';
  }
  return trimmed;
}

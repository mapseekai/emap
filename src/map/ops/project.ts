// projectLayer — export one layer projected via mapshaper's `-proj` (Proj.4).
// The destination `crs` accepts EPSG codes (`'EPSG:3857'`), aliases
// (`'webmercator'`, `'robinson'`, `'wgs84'`), or full Proj.4 strings.
// The operation runs on an isolated single-layer dataset copy and returns a
// Blob for local saving. It never replaces a registered source dataset or
// changes map CRS / viewport state; use `map.reproject()` for that.

import { resolveLayerInList } from '../layer-registry';
import { Err, okValue, type OpResult } from '../op-result';
import type { ProjectLayerExport, ProjectOptions } from '../types';
import type { OpContext } from './_context';
import { getDefaultMapshaperAdapter, type ParsedCommand } from '../../adapter/mapshaper-adapter';
import {
  EpsgProjectionError,
  normalizeProjectCrsMetadata,
  resolveProjectCrs,
  setDatasetCrsMetadata,
} from '../../geo/crs-resolver';
import { TopologySource } from '../../source/topology-source';
import type { ExportFormat } from '../../source/source';

const PROJECT_EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  geojson: 'geojson',
  topojson: 'topojson',
  shapefile: 'zip',
  msx: 'msx',
  geoparquet: 'parquet',
  geoarrow: 'arrow',
  flatgeobuf: 'fgb',
};

export async function projectLayer(
  ctx: OpContext,
  opts: ProjectOptions,
): Promise<OpResult<ProjectLayerExport>> {
  if (ctx.host._removed) return Err.hostRemoved();
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  const target = opts.target;
  if (!target?.trim()) {
    return Err.validation(
      'target',
      'is required; projectLayer only exports a detached layer, use map.reproject() for the map',
    );
  }
  const targetLayer = resolveLayerInList(dataset.layers, target);
  if (!targetLayer) return Err.notFound('layer', target);
  const rawCrs = opts.crs ?? '';
  if (rawCrs.trim().length === 0) return Err.validation('crs', 'must be a non-empty CRS string');
  const format = opts.output?.format ?? 'geojson';
  const requestedFilename = opts.output?.filename;
  if (requestedFilename !== undefined && !requestedFilename.trim()) {
    return Err.validation('output.filename', 'must be a non-empty filename');
  }
  const filename = requestedFilename ?? `${target}.${PROJECT_EXPORT_EXTENSIONS[format]}`;

  let crs: string;
  let init: string | undefined;
  try {
    crs = await resolveProjectCrs(rawCrs);
  } catch (err) {
    if (err instanceof EpsgProjectionError) return Err.validation('crs', err.message);
    throw err;
  }
  if (opts.init && opts.init.trim()) {
    try {
      init = await resolveProjectCrs(opts.init);
    } catch (err) {
      if (err instanceof EpsgProjectionError) return Err.validation('init', err.message);
      throw err;
    }
  }

  const projOpts: Record<string, unknown> = { crs };
  if (init) projOpts.init = init;
  if (opts.densify) projOpts.densify = true;

  // mapshaper exposes the command as `-proj` but parseCommands canonicalises
  // its name to `proj`; emit that form directly.
  const commands: ParsedCommand[] = [{ name: 'proj', options: projOpts }];

  try {
    const adapter = getDefaultMapshaperAdapter();
    const working = adapter.copyDataset(dataset);
    const targetIndex = dataset.layers.indexOf(targetLayer);
    const copiedTarget = working.layers[targetIndex];
    if (!copiedTarget) return Err.notFound('layer', target);
    working.layers = [copiedTarget];

    const projected = await adapter.runOnDatasetParsed(commands, working);
    setDatasetCrsMetadata(projected, normalizeProjectCrsMetadata(rawCrs));

    const detached = new TopologySource(`project:${opts.source}:${target}`, { adapter });
    detached.setDataset(projected, false);
    const blob = await detached.export({ format });
    return okValue({ blob, filename, format });
  } catch (err) {
    if (ctx.host._removed) return Err.hostRemoved();
    ctx.host.fire('error', { error: err });
    return Err.mapshaper(err, { operation: `Project ${target}` });
  }
}

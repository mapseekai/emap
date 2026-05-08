// polygonsLayer — convert a polyline target into a polygon layer via
// mapshaper's `-polygons`. Inverse of {@link linesLayer}. Default path
// snaps gaps and reconstructs faces; `fromRings` skips that step when
// the input is known to be a layer of closed paths.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { PolygonsOptions } from '../types';
import type { OpContext } from './_context';

export async function polygonsLayer(ctx: OpContext, opts: PolygonsOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  const layer = resolveLayerInList(dataset.layers, opts.target);
  if (!layer) return Err.notFound('layer', opts.target);
  if (layer.geometry_type !== 'polyline') {
    return Err.validation('target', `expected polyline layer, got ${layer.geometry_type ?? 'unknown'}`);
  }

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    '-polygons',
  ];
  if (typeof opts.gapTolerance === 'number' && opts.gapTolerance > 0) {
    parts.push(`gap-tolerance=${opts.gapTolerance}`);
  }
  if (opts.fromRings) parts.push('from-rings');
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Polygons ${opts.target}`);
}

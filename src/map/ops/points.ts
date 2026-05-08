// pointsLayer — extract a point layer from a polygon or polyline target
// via mapshaper's `-points`. The `type` enum collapses mapshaper's
// mutually-exclusive `-points` flags into a single option:
//
//   - `centroid` / `inner`     — one point per polygon (target must be polygon)
//   - `midpoints` / `interpolated` — sample along polylines (target must be
//                                    polyline; `interpolated` also requires
//                                    a positive `interval`)
//   - `vertices` / `endpoints` — extract path vertices (polygon or polyline)

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { PointsOptions } from '../types';
import type { OpContext } from './_context';

export async function pointsLayer(ctx: OpContext, opts: PointsOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  const layer = resolveLayerInList(dataset.layers, opts.target);
  if (!layer) return Err.notFound('layer', opts.target);

  const geom = layer.geometry_type;
  switch (opts.type) {
    case 'centroid':
    case 'inner':
      if (geom !== 'polygon') {
        return Err.validation('type', `${opts.type} requires polygon target, got ${geom ?? 'unknown'}`);
      }
      break;
    case 'midpoints':
    case 'interpolated':
      if (geom !== 'polyline') {
        return Err.validation('type', `${opts.type} requires polyline target, got ${geom ?? 'unknown'}`);
      }
      break;
    case 'vertices':
    case 'endpoints':
      if (geom !== 'polygon' && geom !== 'polyline') {
        return Err.validation('type', `${opts.type} requires polygon/polyline target, got ${geom ?? 'unknown'}`);
      }
      break;
    default:
      return Err.validation('type', `unknown type: ${String((opts as PointsOptions).type)}`);
  }
  if (opts.type === 'interpolated' && !(typeof opts.interval === 'number' && opts.interval > 0)) {
    return Err.validation('interval', 'interpolated points require a positive interval');
  }

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-points ${opts.type}`,
  ];
  if (opts.type === 'interpolated') {
    parts.push(`interval=${opts.interval}`);
  }
  if (opts.name && opts.name.trim()) {
    parts.push(`name=${quoteCliArg(opts.name)}`);
  }
  if (opts.noReplace) parts.push('no-replace');
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Points ${opts.target}`);
}

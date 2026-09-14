// pointsLayer — extract a point layer from a polygon or polyline target
// via mapshaper's `-points`. The `type` enum collapses mapshaper's
// mutually-exclusive `-points` flags into a single option:
//
//   - `centroid` / `inner`     — one point per polygon (target must be polygon)
//   - `midpoints` / `interpolated` — sample along polylines (target must be
//                                    polyline; `interpolated` also requires
//                                    a positive `interval`)
//   - `vertices` / `endpoints` — extract path vertices (polygon or polyline)

import { Err } from '../op-result';
import type { PointsOptions } from '../types';
import { defineLayerOp } from './_define';

export const pointsLayer = defineLayerOp<PointsOptions>({
  name: 'pointsLayer',
  command: 'points',
  label: (o) => `Points ${o.target}`,
  validate: (o, layer) => {
    const geom = layer!.geometry_type;
    switch (o.type) {
      case 'centroid':
      case 'inner':
        if (geom !== 'polygon') {
          return Err.validation(
            'type',
            `${o.type} requires polygon target, got ${geom ?? 'unknown'}`,
          );
        }
        break;
      case 'midpoints':
      case 'interpolated':
        if (geom !== 'polyline') {
          return Err.validation(
            'type',
            `${o.type} requires polyline target, got ${geom ?? 'unknown'}`,
          );
        }
        break;
      case 'vertices':
      case 'endpoints':
        if (geom !== 'polygon' && geom !== 'polyline') {
          return Err.validation(
            'type',
            `${o.type} requires polygon/polyline target, got ${geom ?? 'unknown'}`,
          );
        }
        break;
      default:
        return Err.validation('type', `unknown type: ${String((o as PointsOptions).type)}`);
    }
    if (o.type === 'interpolated' && !(typeof o.interval === 'number' && o.interval > 0)) {
      return Err.validation('interval', 'interpolated points require a positive interval');
    }
  },
  options: (o) => {
    // `-points TYPE` becomes options[TYPE]=true (centroid / inner / midpoints
    // / interpolated / vertices / endpoints are mutually-exclusive boolean
    // flags in mapshaper's parsed form).
    const pointsOpts: Record<string, unknown> = { [o.type]: true };
    if (o.type === 'interpolated') pointsOpts.interval = String(o.interval);
    if (o.name && o.name.trim()) pointsOpts.name = o.name;
    if (o.noReplace) pointsOpts.no_replace = true;
    return pointsOpts;
  },
});

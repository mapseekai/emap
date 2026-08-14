// polygonsLayer — convert a polyline target into a polygon layer via
// mapshaper's `-polygons`. Inverse of {@link linesLayer}. Default path
// snaps gaps and reconstructs faces; `fromRings` skips that step when
// the input is known to be a layer of closed paths.

import type { PolygonsOptions } from '../types';
import { defineLayerOp } from './_define';

export const polygonsLayer = defineLayerOp<PolygonsOptions>({
  name: 'polygonsLayer',
  command: 'polygons',
  geometry: 'polyline',
  label: (o) => `Polygons ${o.target}`,
  options: (o) => {
    const polyOpts: Record<string, unknown> = {};
    if (typeof o.gapTolerance === 'number' && o.gapTolerance > 0) {
      polyOpts.gap_tolerance = String(o.gapTolerance);
    }
    if (o.fromRings) polyOpts.from_rings = true;
    return polyOpts;
  },
});

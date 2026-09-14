// intersectionPointsLayer — materialise the self-intersection points of
// a polygon or polyline target as a new point layer in the same source's
// dataset. Counterpart to `checkGeometry` — that one returns a read-only
// report; this op produces a renderable, selectable, editable layer.
//
// mapshaper's CLI `-points intersections` flag is registered but its
// implementation is a debug-only timing benchmark; this op bypasses the
// CLI and uses `findSegmentIntersections` + `getIntersectionLayer`
// directly via the adapter. The resulting layer is one multi-point
// feature (mapshaper's `getIntersectionLayer` returns `shapes:
// [points]`). Pipe through `explodeLayer` for one feature per
// intersection.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type { IntersectionPointsLayerOptions } from '../types';
import type { OpContext } from './_context';
import { _runDatasetTransform } from './_runner';

export function intersectionPointsLayer(
  ctx: OpContext,
  opts: IntersectionPointsLayerOptions,
): Promise<OpResult> {
  return _runDatasetTransform(
    ctx.host,
    opts.source,
    `Intersection points ${opts.target}`,
    'shape-count',
    (working) => {
      const targetLayer = resolveLayerInList(working.layers, opts.target);
      if (!targetLayer) return Err.notFound('layer', opts.target);
      if (targetLayer.geometry_type !== 'polygon' && targetLayer.geometry_type !== 'polyline') {
        return Err.validation(
          'target',
          `expected polygon/polyline target, got ${targetLayer.geometry_type ?? 'unknown'}`,
        );
      }
      if (!working.arcs) return Err.validation('source', 'source has no arcs');

      const newName = (opts.name && opts.name.trim()) || `${opts.target}-intersections`;
      if (working.layers.some((layer) => layer.name === newName)) {
        return Err.validation('name', `another layer already named '${newName}'`);
      }
      if (
        opts.tolerance !== undefined &&
        (typeof opts.tolerance !== 'number' ||
          !Number.isFinite(opts.tolerance) ||
          opts.tolerance <= 0)
      ) {
        return Err.validation('tolerance', 'must be a positive finite number');
      }

      const adapter = getDefaultMapshaperAdapter();
      const intersections = adapter.findSegmentIntersections(
        working.arcs,
        opts.tolerance === undefined ? {} : { tolerance: opts.tolerance },
      );
      const pointLayer = adapter.getIntersectionLayer(intersections, targetLayer, working.arcs);
      pointLayer.name = newName;
      working.layers.push(pointLayer);
    },
  );
}

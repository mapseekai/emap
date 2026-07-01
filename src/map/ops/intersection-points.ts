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
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { IntersectionPointsLayerOptions } from '../types';
import type { OpContext } from './_context';

export async function intersectionPointsLayer(
  ctx: OpContext,
  opts: IntersectionPointsLayerOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const original = source.getDataset();
  if (!original) return Err.notFound('source', opts.source);
  const targetLayer = resolveLayerInList(original.layers, opts.target);
  if (!targetLayer) return Err.notFound('layer', opts.target);
  if (targetLayer.geometry_type !== 'polygon' && targetLayer.geometry_type !== 'polyline') {
    return Err.validation(
      'target',
      `expected polygon/polyline target, got ${targetLayer.geometry_type ?? 'unknown'}`,
    );
  }
  if (!original.arcs) return Err.validation('source', 'source has no arcs');

  const newName = (opts.name && opts.name.trim()) || `${opts.target}-intersections`;
  if (original.layers.some((l: any) => l?.name === newName)) {
    return Err.validation('name', `another layer already named '${newName}'`);
  }
  if (opts.tolerance !== undefined) {
    if (
      typeof opts.tolerance !== 'number' ||
      !Number.isFinite(opts.tolerance) ||
      opts.tolerance <= 0
    ) {
      return Err.validation('tolerance', 'must be a positive finite number');
    }
  }

  const internalOpts: { tolerance?: number } = {};
  if (opts.tolerance !== undefined) internalOpts.tolerance = opts.tolerance;

  // Custom dataset-replace path. Snapshot for undo, do work on a deep
  // copy, swap. Mirrors `_runDatasetCommand` but skips parseCommands
  // because mapshaper's CLI `-points intersections` is broken upstream
  // — we go directly to the internal primitives.
  const adapter = getDefaultMapshaperAdapter();
  const before: MapshaperDataset = adapter.copyDataset(original);
  const after: MapshaperDataset = adapter.copyDataset(original);

  let pointLyr: any;
  try {
    const intersections = adapter.findSegmentIntersections(after.arcs!, internalOpts);
    // Find the cloned target inside the working copy by name.
    const workingTarget = resolveLayerInList(after.layers, opts.target);
    if (!workingTarget) {
      // Should never happen — target was in original, copyDataset preserves names.
      throw new Error('intersectionPointsLayer: target lost in copyDataset');
    }
    pointLyr = adapter.getIntersectionLayer(intersections, workingTarget, after.arcs!);
    pointLyr.name = newName;
    after.layers.push(pointLyr);
  } catch (err) {
    ctx.host.fire('error', { error: err });
    return Err.mapshaper(err, { operation: 'intersectionPointsLayer' });
  }

  return ctx.applyDatasetReplace(opts.source, before, after, `Intersection points ${opts.target}`);
}

// checkGeometry — read-only topology validation pass over a source's
// arcs via `MapshaperAdapter.findSegmentIntersections`. Reports
// self-intersection count and a sample of intersection points; does NOT
// mutate the dataset or push to history.
//
// Returns `OpResult<GeometryCheckReport>` — the outer `ok` reflects
// whether the *check itself* could run; the inner `value.ok` is the
// "no intersections found" flag. Lighter than `cleanLayer` (heavy +
// destructive) and complementary to `rebuildTopology` (which fixes
// what this command finds).

import { Err, okValue, type OpResult } from '../op-result';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type { CheckGeometryOptions, GeometryCheckReport } from '../types';
import type { OpContext } from './_context';

export async function checkGeometry(
  ctx: OpContext,
  opts: CheckGeometryOptions,
): Promise<OpResult<GeometryCheckReport>> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!dataset.arcs) {
    return okValue({ ok: true, intersections: [], intersectionCount: 0 });
  }

  const internalOpts: { tolerance?: number } = {};
  if (opts.tolerance !== undefined) internalOpts.tolerance = opts.tolerance;

  const raw = getDefaultMapshaperAdapter().findSegmentIntersections(dataset.arcs, internalOpts);
  const intersections = raw.map((r) => ({ x: r.x, y: r.y }));
  return okValue({
    ok: intersections.length === 0,
    intersections,
    intersectionCount: intersections.length,
  });
}

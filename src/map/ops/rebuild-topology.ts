// rebuildTopology — re-derive shared arcs and insert intersection cuts
// via `MapshaperAdapter.addIntersectionCuts` — the lightweight repair
// pass every overlay command runs as a pre-pass before clip / erase /
// dissolve / union.
//
// Use case: after `translateSelected` / `rotateSelected` / vertex moves
// change arc geometry, this op re-detects overlaps that the in-place
// edits didn't update. Without it, exports bake topology bugs into
// output and shared-arc rendering can misrepresent neighbour boundaries.
//
// Lighter than `cleanLayer` (which also removes spikes / slivers and
// dissolves polygon overlaps).
//
// Bypasses `_runDatasetCommand`: takes the direct
// `_applyDatasetReplace` path because the work is a single
// `addIntersectionCuts` call rather than a CLI pipeline.

import { Err, OK, type OpResult } from '../op-result';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { RebuildTopologyOptions } from '../types';
import type { OpContext } from './_context';

export async function rebuildTopology(
  ctx: OpContext,
  opts: RebuildTopologyOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const original = source.getDataset();
  if (!original) return Err.notFound('source', opts.source);
  if (!original.arcs) return OK; // point-only — nothing to rebuild

  const adapter = getDefaultMapshaperAdapter();
  const before: MapshaperDataset = adapter.copyDataset(original);
  const after: MapshaperDataset = adapter.copyDataset(original);

  try {
    adapter.addIntersectionCuts(after, {
      snap_interval: opts.snapInterval,
      no_snap: opts.noSnap,
      rebuild_topology: opts.rebuildTopology,
    });
  } catch (err) {
    ctx.host.fire('error', { error: err });
    return Err.mapshaper(err, { operation: 'rebuildTopology' });
  }

  return ctx.applyDatasetReplace(opts.source, before, after, 'Rebuild topology');
}

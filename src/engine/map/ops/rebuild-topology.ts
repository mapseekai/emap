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

import { OK, type OpResult } from '../op-result';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type { RebuildTopologyOptions } from '../types';
import type { OpContext } from './_context';
import { _runDatasetTransform } from './_runner';

export function rebuildTopology(ctx: OpContext, opts: RebuildTopologyOptions): Promise<OpResult> {
  return _runDatasetTransform(
    ctx.host,
    opts.source,
    'Rebuild topology',
    'topology-only',
    (working) => {
      if (!working.arcs) return OK;
      getDefaultMapshaperAdapter().addIntersectionCuts(working, {
        snap_interval: opts.snapInterval,
        no_snap: opts.noSnap,
        rebuild_topology: opts.rebuildTopology,
      });
    },
  );
}

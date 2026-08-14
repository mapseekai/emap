// cleanLayer — repair topology issues (intersection cuts, polygon
// overlaps, sliver removal) via mapshaper's `-clean`. Heavy: O(N²) on
// polygon counts in the worst case, so it is opt-in instead of running
// on every import.

import { Err } from '../op-result';
import type { CleanOptions } from '../types';
import { defineLayerOp } from './_define';

export const cleanLayer = defineLayerOp<CleanOptions>({
  name: 'cleanLayer',
  command: 'clean',
  label: (o) => `Clean ${o.target}`,
  validate: (o) => {
    // Numeric tuning options reject NaN / negative — mapshaper would either
    // error opaquely or silently produce surprising results.
    const validNumOrUnset = (n?: number) =>
      n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
    if (!validNumOrUnset(o.gapFillArea))
      return Err.validation('gapFillArea', 'must be a finite non-negative number');
    if (!validNumOrUnset(o.sliverControl))
      return Err.validation('sliverControl', 'must be a finite non-negative number');
    if (!validNumOrUnset(o.snapInterval))
      return Err.validation('snapInterval', 'must be a finite non-negative number');

    if (o.overlapRule !== undefined) {
      const allowed = ['min-id', 'max-id', 'min-area', 'max-area'];
      if (!allowed.includes(o.overlapRule)) {
        return Err.validation('overlapRule', `must be one of ${allowed.join(', ')}`);
      }
    }
  },
  options: (o) => {
    const cleanOpts: Record<string, unknown> = {};
    // Numeric tuning options are passed as strings to match what
    // mapshaper's CLI parser produces (its area/interval handlers expect
    // strings and call parseFloat internally).
    if (o.gapFillArea !== undefined) cleanOpts.gap_fill_area = String(o.gapFillArea);
    if (o.sliverControl !== undefined) cleanOpts.sliver_control = o.sliverControl;
    if (o.snapInterval !== undefined) cleanOpts.snap_interval = String(o.snapInterval);
    if (o.noSnap) cleanOpts.no_snap = true;
    if (o.allowOverlaps) cleanOpts.allow_overlaps = true;
    if (o.overlapRule !== undefined) cleanOpts.overlap_rule = o.overlapRule;
    if (o.allowEmpty) cleanOpts.allow_empty = true;
    if (o.rewind) cleanOpts.rewind = true;
    if (o.onlyArcs) cleanOpts.only_arcs = true;
    if (o.noArcDissolve) cleanOpts.no_arc_dissolve = true;
    return cleanOpts;
  },
});

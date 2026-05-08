// cleanLayer — repair topology issues (intersection cuts, polygon
// overlaps, sliver removal) via mapshaper's `-clean`. Heavy: O(N²) on
// polygon counts in the worst case, so it is opt-in instead of running
// on every import.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { CleanOptions } from '../types';
import type { OpContext } from './_context';

export async function cleanLayer(ctx: OpContext, opts: CleanOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  // Numeric tuning options reject NaN / negative — mapshaper would either
  // error opaquely or silently produce surprising results.
  const validNumOrUnset = (n?: number) =>
    n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
  if (!validNumOrUnset(opts.gapFillArea)) return Err.validation('gapFillArea', 'must be a finite non-negative number');
  if (!validNumOrUnset(opts.sliverControl)) return Err.validation('sliverControl', 'must be a finite non-negative number');
  if (!validNumOrUnset(opts.snapInterval)) return Err.validation('snapInterval', 'must be a finite non-negative number');

  if (opts.overlapRule !== undefined) {
    const allowed = ['min-id', 'max-id', 'min-area', 'max-area'];
    if (!allowed.includes(opts.overlapRule)) {
      return Err.validation('overlapRule', `must be one of ${allowed.join(', ')}`);
    }
  }

  const cleanOpts: Record<string, unknown> = {};
  // Numeric tuning options are passed as strings to match what
  // mapshaper's CLI parser produces (its area/interval handlers expect
  // strings and call parseFloat internally).
  if (opts.gapFillArea !== undefined) cleanOpts.gap_fill_area = String(opts.gapFillArea);
  if (opts.sliverControl !== undefined) cleanOpts.sliver_control = opts.sliverControl;
  if (opts.snapInterval !== undefined) cleanOpts.snap_interval = String(opts.snapInterval);
  if (opts.noSnap) cleanOpts.no_snap = true;
  if (opts.allowOverlaps) cleanOpts.allow_overlaps = true;
  if (opts.overlapRule !== undefined) cleanOpts.overlap_rule = opts.overlapRule;
  if (opts.allowEmpty) cleanOpts.allow_empty = true;
  if (opts.rewind) cleanOpts.rewind = true;
  if (opts.onlyArcs) cleanOpts.only_arcs = true;
  if (opts.noArcDissolve) cleanOpts.no_arc_dissolve = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'clean', options: cleanOpts },
    ],
    `Clean ${opts.target}`,
  );
}

// cleanLayer — repair topology issues (intersection cuts, polygon
// overlaps, sliver removal) via mapshaper's `-clean`. Heavy: O(N²) on
// polygon counts in the worst case, so it is opt-in instead of running
// on every import.

import { Err, type OpResult } from '../op-result';
import type { CleanOptions } from '../types';
import { defineLayerOp } from './_define';
import type { OpContext } from './_context';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import { isPathLayer } from '../../../shared/types/mapshaper-types';
import { validatePolygon, validatePolygonArcReferences } from './geometry-2d';
import { SplitGeometryValidationError } from './split-selected-error';
import { resolveLayerInList } from '../layer-registry';

const runCleanLayer = defineLayerOp<CleanOptions>({
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

export function cleanLayer(ctx: OpContext, opts: CleanOptions): Promise<OpResult> {
  if (
    !opts.rewind ||
    !opts.onlyArcs ||
    !opts.noArcDissolve ||
    !opts.allowEmpty ||
    !opts.noSnap ||
    opts.gapFillArea !== undefined ||
    opts.sliverControl !== undefined ||
    opts.snapInterval !== undefined ||
    opts.overlapRule !== undefined ||
    opts.allowOverlaps === true
  )
    return runCleanLayer(ctx, opts);

  // Winding-only repair keeps feature ids, but retains the dataset-replacement history barrier.
  return ctx.runPreparedDatasetMutation(opts.source, `Clean ${opts.target}`, async (working) => {
    const layer = resolveLayerInList(working.layers, opts.target);
    if (!layer) return Err.notFound('layer', opts.target);
    const adapter = getDefaultMapshaperAdapter();
    await adapter.runOnDatasetParsed(
      [
        { name: 'target', options: { target: opts.target } },
        {
          name: 'clean',
          options: {
            rewind: true,
            only_arcs: true,
            no_arc_dissolve: true,
            allow_empty: true,
            no_snap: true,
          },
        },
      ],
      working,
    );
    if (isPathLayer(layer) && layer.geometry_type === 'polygon' && working.arcs) {
      try {
        for (const shape of layer.shapes ?? []) {
          if (!shape?.length) continue;
          validatePolygonArcReferences(shape, working.arcs);
          validatePolygon(shape, working.arcs, adapter);
        }
      } catch (error) {
        if (error instanceof SplitGeometryValidationError)
          return Err.validation('geometry', error.reason);
        throw error;
      }
    }
    return { value: undefined, selection: ctx.host._selection.getAll() };
  });
}

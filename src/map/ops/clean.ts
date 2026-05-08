// cleanLayer — repair topology issues (intersection cuts, polygon
// overlaps, sliver removal) via mapshaper's `-clean`. Heavy: O(N²) on
// polygon counts in the worst case, so it is opt-in instead of running
// on every import.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
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

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    `-clean`,
  ];
  if (opts.gapFillArea !== undefined) parts.push(`gap-fill-area=${opts.gapFillArea}`);
  if (opts.sliverControl !== undefined) parts.push(`sliver-control=${opts.sliverControl}`);
  if (opts.snapInterval !== undefined) parts.push(`snap-interval=${opts.snapInterval}`);
  if (opts.noSnap) parts.push('no-snap');
  if (opts.allowOverlaps) parts.push('allow-overlaps');
  if (opts.overlapRule !== undefined) parts.push(`overlap-rule=${opts.overlapRule}`);
  if (opts.allowEmpty) parts.push('allow-empty');
  if (opts.rewind) parts.push('rewind');
  if (opts.onlyArcs) parts.push('only-arcs');
  if (opts.noArcDissolve) parts.push('no-arc-dissolve');

  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Clean ${opts.target}`);
}

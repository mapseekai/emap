// simplifyLayer — simplify polygon and polyline geometry via mapshaper's
// `-simplify`. Operates on the source's shared arcs (sets per-vertex
// `zz` thresholds + a `zlimit`); subsequent commands and exports honour
// the threshold automatically. Re-running with a different threshold
// replaces the previous one — the original vertex data is preserved on
// the arc collection.
//
// Exactly one of `percentage`, `interval`, or `resolution` MUST be
// supplied. `target` is optional; when omitted, the whole source dataset
// is simplified (mapshaper CLI default).

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { SimplifyOptions } from '../types';
import type { OpContext } from './_context';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';

export async function simplifyLayer(ctx: OpContext, opts: SimplifyOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (opts.target !== undefined) {
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  }

  // Exactly one threshold mode.
  const thresholdsSet = [
    opts.percentage !== undefined,
    opts.interval !== undefined,
    opts.resolution !== undefined,
  ].filter(Boolean).length;
  if (thresholdsSet !== 1) {
    return Err.validation('threshold', 'must supply exactly one of percentage, interval, resolution');
  }

  const simplifyOpts: Record<string, unknown> = {};
  if (opts.percentage !== undefined) {
    const p = opts.percentage;
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      return Err.validation('percentage', 'must be a finite number in [0, 100]');
    }
    simplifyOpts.percentage = `${p}%`;
  } else if (opts.interval !== undefined) {
    const v = opts.interval;
    if (!Number.isFinite(v) || v <= 0) {
      return Err.validation('interval', 'must be a positive finite number');
    }
    simplifyOpts.interval = String(v);
  } else {
    const r = opts.resolution!;
    if (!/^\d+x\d+$/.test(r)) {
      return Err.validation('resolution', 'must match `WIDTHxHEIGHT` (digits)');
    }
    simplifyOpts.resolution = r;
  }

  // `weighting` only makes sense for weighted-Visvalingam. mapshaper
  // silently ignores `weighting` when method is `dp` or `visvalingam`,
  // which leaves the caller wondering why their tuning had no effect.
  // Reject up-front. (Method `undefined` is fine — defaults to weighted.)
  if (opts.weighting !== undefined && opts.method !== undefined && opts.method !== 'weighted') {
    return Err.validation('weighting', `weighting only applies to method='weighted', not ${opts.method}`);
  }

  if (opts.method) simplifyOpts.method = opts.method;
  if (typeof opts.weighting === 'number' && Number.isFinite(opts.weighting)) {
    simplifyOpts.weighting = opts.weighting;
  }
  if (opts.planar) simplifyOpts.planar = true;
  if (opts.keepShapes) simplifyOpts.keep_shapes = true;
  if (opts.lockBox) simplifyOpts.lock_box = true;
  if (opts.noRepair) simplifyOpts.no_repair = true;

  const commands: ParsedCommand[] = [];
  if (opts.target) commands.push({ name: 'target', options: { target: opts.target } });
  commands.push({ name: 'simplify', options: simplifyOpts });

  const label = `Simplify ${opts.target ?? opts.source}`;
  return ctx.runDatasetCommandParsed(opts.source, commands, label);
}

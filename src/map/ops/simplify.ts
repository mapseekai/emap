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
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { SimplifyOptions } from '../types';
import type { OpContext } from './_context';

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

  let thresholdToken: string;
  if (opts.percentage !== undefined) {
    const p = opts.percentage;
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      return Err.validation('percentage', 'must be a finite number in [0, 100]');
    }
    thresholdToken = `${p}%`;
  } else if (opts.interval !== undefined) {
    const v = opts.interval;
    if (!Number.isFinite(v) || v <= 0) {
      return Err.validation('interval', 'must be a positive finite number');
    }
    thresholdToken = `interval=${v}`;
  } else {
    const r = opts.resolution!;
    if (!/^\d+x\d+$/.test(r)) {
      return Err.validation('resolution', 'must match `WIDTHxHEIGHT` (digits)');
    }
    thresholdToken = `resolution=${r}`;
  }

  // `weighting` only makes sense for weighted-Visvalingam. mapshaper
  // silently ignores `weighting` when method is `dp` or `visvalingam`,
  // which leaves the caller wondering why their tuning had no effect.
  // Reject up-front. (Method `undefined` is fine — defaults to weighted.)
  if (opts.weighting !== undefined && opts.method !== undefined && opts.method !== 'weighted') {
    return Err.validation('weighting', `weighting only applies to method='weighted', not ${opts.method}`);
  }

  const parts: string[] = [];
  if (opts.target) parts.push(`-target ${quoteCliArg(opts.target)}`);
  parts.push(`-simplify ${thresholdToken}`);
  if (opts.method) parts.push(opts.method);
  if (typeof opts.weighting === 'number' && Number.isFinite(opts.weighting)) {
    parts.push(`weighting=${opts.weighting}`);
  }
  if (opts.planar) parts.push('planar');
  if (opts.keepShapes) parts.push('keep-shapes');
  if (opts.lockBox) parts.push('lock-box');
  if (opts.noRepair) parts.push('no-repair');

  const label = `Simplify ${opts.target ?? opts.source}`;
  return ctx.runDatasetCommand(opts.source, parts.join(' '), label);
}

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

import { Err } from '../op-result';
import type { SimplifyOptions } from '../types';
import { defineLayerOp } from './_define';

export const simplifyLayer = defineLayerOp<SimplifyOptions>({
  name: 'simplifyLayer',
  command: 'simplify',
  target: 'optional',
  label: (o) => `Simplify ${o.target ?? o.source}`,
  preGate: (o) => {
    // Exactly one threshold mode.
    const thresholdsSet = [
      o.percentage !== undefined,
      o.interval !== undefined,
      o.resolution !== undefined,
    ].filter(Boolean).length;
    if (thresholdsSet !== 1) {
      return Err.validation(
        'threshold',
        'must supply exactly one of percentage, interval, resolution',
      );
    }

    if (o.percentage !== undefined) {
      const p = o.percentage;
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        return Err.validation('percentage', 'must be a finite number in [0, 100]');
      }
    } else if (o.interval !== undefined) {
      const v = o.interval;
      if (!Number.isFinite(v) || v <= 0) {
        return Err.validation('interval', 'must be a positive finite number');
      }
    } else {
      const r = o.resolution!;
      if (!/^\d+x\d+$/.test(r)) {
        return Err.validation('resolution', 'must match `WIDTHxHEIGHT` (digits)');
      }
    }

    // `weighting` only makes sense for weighted-Visvalingam. mapshaper
    // silently ignores `weighting` when method is `dp` or `visvalingam`,
    // which leaves the caller wondering why their tuning had no effect.
    // Reject up-front. (Method `undefined` is fine — defaults to weighted.)
    if (o.weighting !== undefined && o.method !== undefined && o.method !== 'weighted') {
      return Err.validation(
        'weighting',
        `weighting only applies to method='weighted', not ${o.method}`,
      );
    }
  },
  options: (o) => {
    const simplifyOpts: Record<string, unknown> = {};
    if (o.percentage !== undefined) {
      simplifyOpts.percentage = `${o.percentage}%`;
    } else if (o.interval !== undefined) {
      simplifyOpts.interval = String(o.interval);
    } else {
      simplifyOpts.resolution = o.resolution!;
    }
    if (o.method) simplifyOpts.method = o.method;
    if (typeof o.weighting === 'number' && Number.isFinite(o.weighting)) {
      simplifyOpts.weighting = o.weighting;
    }
    if (o.planar) simplifyOpts.planar = true;
    if (o.keepShapes) simplifyOpts.keep_shapes = true;
    if (o.lockBox) simplifyOpts.lock_box = true;
    if (o.noRepair) simplifyOpts.no_repair = true;
    return simplifyOpts;
  },
});

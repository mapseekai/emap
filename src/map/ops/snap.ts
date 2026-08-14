// snapLayer — snap nearby vertices together via mapshaper's `-snap`.
// Targeted fix for almost-but-not-quite-coincident vertices left over
// from reprojection, manual digitisation, or merged sources.

import type { SnapOptions } from '../types';
import { defineLayerOp } from './_define';

export const snapLayer = defineLayerOp<SnapOptions>({
  name: 'snapLayer',
  command: 'snap',
  label: (o) => `Snap ${o.target}`,
  options: (o) => {
    const snapOpts: Record<string, unknown> = {};
    if (typeof o.interval === 'number') snapOpts.interval = String(o.interval);
    if (o.endpoints) snapOpts.endpoints = true;
    if (typeof o.precision === 'number') snapOpts.precision = o.precision;
    if (o.fixGeometry) snapOpts.fix_geometry = true;
    return snapOpts;
  },
});

// mosaicLayer — flatten overlapping polygons in a single layer into a
// tile mosaic via mapshaper's `-mosaic`. Every overlap region becomes
// its own polygon; gaps are preserved.

import type { MosaicOptions } from '../types';
import { defineLayerOp } from './_define';

export const mosaicLayer = defineLayerOp<MosaicOptions>({
  name: 'mosaicLayer',
  command: 'mosaic',
  label: (o) => `Mosaic ${o.target}`,
  expressions: (o) => [o.calc],
  options: (o) => {
    const options: Record<string, unknown> = {};
    if (typeof o.snapInterval === 'number') options.snap_interval = String(o.snapInterval);
    if (o.noSnap) options.no_snap = true;
    if (o.noReplace) options.no_replace = true;
    if (o.name && o.name.trim()) options.name = o.name;
    if (o.calc && o.calc.trim()) options.calc = o.calc;
    return options;
  },
});

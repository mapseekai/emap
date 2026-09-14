// filterSlivers — drop sliver polygons (the tiny artifacts left over
// after clip / erase / dissolve) via mapshaper's `-filter-slivers`.
//
// Distinct from `filterIslands`: islands are entire disconnected
// polygon parts; slivers are whole features whose total area is
// below threshold.

import { Err } from '../op-result';
import type { FilterSliversOptions } from '../types';
import { defineLayerOp } from './_define';

export const filterSlivers = defineLayerOp<FilterSliversOptions>({
  name: 'filterSlivers',
  command: 'filter-slivers',
  label: (o) => `Filter slivers ${o.target}`,
  validate: (o) => {
    if (typeof o.minArea !== 'number' || !Number.isFinite(o.minArea) || o.minArea <= 0) {
      return Err.validation('minArea', 'must be a positive finite number');
    }
  },
  options: (o) => {
    const options: Record<string, unknown> = { min_area: String(o.minArea) };
    if (o.weighted) options.weighted = true;
    return options;
  },
});

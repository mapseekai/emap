// filterIslands — drop tiny disconnected polygon parts (digitisation
// noise, single-pixel dots, etc.) via mapshaper's `-filter-islands`.
// Operates on polygon layers; on polylines mapshaper accepts the
// command but it's typically a no-op.

import { Err } from '../op-result';
import type { FilterIslandsOptions } from '../types';
import { defineLayerOp } from './_define';

export const filterIslands = defineLayerOp<FilterIslandsOptions>({
  name: 'filterIslands',
  command: 'filter-islands',
  label: (o) => `Filter islands ${o.target}`,
  validate: (o) => {
    const hasMinArea = typeof o.minArea === 'number' && Number.isFinite(o.minArea);
    const hasMinVertices =
      typeof o.minVertices === 'number' && Number.isInteger(o.minVertices) && o.minVertices > 0;
    if (!hasMinArea && !hasMinVertices) {
      return Err.validation('minArea', 'must supply at least one of `minArea` or `minVertices`');
    }
    if (hasMinArea && o.minArea! < 0) {
      return Err.validation('minArea', 'must be non-negative');
    }
  },
  options: (o) => {
    const hasMinArea = typeof o.minArea === 'number' && Number.isFinite(o.minArea);
    const hasMinVertices =
      typeof o.minVertices === 'number' && Number.isInteger(o.minVertices) && o.minVertices > 0;
    const options: Record<string, unknown> = {};
    if (hasMinArea) options.min_area = String(o.minArea);
    if (hasMinVertices) options.min_vertices = o.minVertices;
    if (o.removeEmpty) options.remove_empty = true;
    return options;
  },
});

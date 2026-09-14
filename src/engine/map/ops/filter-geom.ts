// filterGeom — keep only features whose geometry intersects a bbox
// (mapshaper's `-filter-geom`).
//
// For attribute-predicate filtering, use `filterFeatures` (`-filter`)
// instead. mapshaper's filter-geom currently only ships the bbox
// predicate; that's what this op exposes.

import type { FilterGeomOptions } from '../types';
import { defineLayerOp } from './_define';
import { validateBbox } from './_targets';

export const filterGeom = defineLayerOp<FilterGeomOptions>({
  name: 'filterGeom',
  command: 'filter-geom',
  label: (o) => `Filter geom ${o.target}`,
  validate: (o) => {
    const validation = validateBbox(o.bbox);
    if (!validation.ok) return validation;
  },
  options: (o) => {
    const b = o.bbox;
    return { bbox: [b[0], b[1], b[2], b[3]] };
  },
});

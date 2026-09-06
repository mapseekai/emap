import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import type { DuckDbRelationHelperOptions, DuckDbRelationOperationId } from './_operations';
import { spatialRelation } from './spatial-relation';

export type SpatialFilterPredicate = Exclude<DuckDbRelationOperationId, 'distance'>;
export interface SpatialFilterOptions extends DuckDbRelationHelperOptions {
  predicate: SpatialFilterPredicate;
}
export function spatialFilter(
  input: MapshaperDataset,
  reference: MapshaperDataset,
  options: SpatialFilterOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return spatialRelation(input, reference, { ...options, mode: 'filter' }, runtime);
}
export const spatialFilterTool = defineDuckDbTool({
  id: 'spatialFilter',
  category: 'selection',
  title: 'Spatial Filter',
  description: 'Keep input features that satisfy a spatial relationship with a reference layer.',
  inputs: [
    { name: 'input', description: 'Features to filter.', required: true, geometry: ['any'] },
    {
      name: 'reference',
      description: 'Features used as spatial filter.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [
    {
      name: 'predicate',
      description: 'Spatial predicate.',
      type: 'enum',
      required: true,
      enumValues: [
        'intersects',
        'contains',
        'within',
        'touches',
        'disjoint',
        'overlaps',
        'equals',
        'crosses',
        'covers',
        'coveredBy',
        'containsProperly',
        'distanceWithin',
      ],
    },
    {
      name: 'distance',
      description: 'Threshold for distanceWithin.',
      type: 'number',
      exclusiveMinimum: 0,
    },
  ],
  crs: 'known',
  units: 'dataset',
  output: {
    geometry: 'preserve',
    cardinality: 'filter',
    attributes: 'preserve',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Select or extract features by location.',
    whenToUse: ['Keep features intersecting, contained by, touching or near another layer.'],
    keywords: [
      'spatial filter',
      'select by location',
      'extract by location',
      'intersects',
      'within',
    ],
  },
  execute: (c) =>
    spatialFilter(
      requireToolInput(c, 'input'),
      requireToolInput(c, 'reference'),
      toolParams<SpatialFilterOptions>(c),
      c.runtime,
    ),
});

import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { type DuckDbRuntime } from '../runtime';
import { runNamedRelationOperation, type RelationOptions } from '../core/relation/operations';
import type { RelationOperationId } from '../core/relation/types';

/**
 * @example
 * const options: SpatialRelationOptions = { predicate: 'distanceWithin', distance: 100, mode: 'filter' };
 */
export interface SpatialRelationOptions extends RelationOptions {
  predicate: RelationOperationId;
  mode?: 'filter' | 'attribute';
}

/**
 * @example
 * const result = await spatialRelation(points, roads, { predicate: 'distanceWithin', distance: 100 });
 */
export function spatialRelation(
  input: MapshaperDataset,
  reference: MapshaperDataset,
  options: SpatialRelationOptions,
  runtime: DuckDbRuntime | null = null,
) {
  return runNamedRelationOperation(
    options.mode ?? 'filter',
    options.predicate,
    input,
    reference,
    options,
    runtime,
  );
}

export const spatialRelationTool = defineDuckDbTool({
  id: 'spatialRelation',
  category: 'selection',
  title: 'Spatial Relation',
  description: 'Evaluate a named spatial predicate or distance relation between two layers.',
  inputs: [
    { name: 'input', description: 'Primary features.', required: true, geometry: ['any'] },
    { name: 'reference', description: 'Reference features.', required: true, geometry: ['any'] },
  ],
  parameters: [
    {
      name: 'predicate',
      description: 'Relation operation.',
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
        'distance',
        'distanceWithin',
      ],
    },
    {
      name: 'mode',
      description: 'Filter features or append relation values.',
      type: 'enum',
      default: 'filter',
      enumValues: ['filter', 'attribute'],
    },
    {
      name: 'distance',
      description: 'Distance threshold for distanceWithin.',
      type: 'number',
      exclusiveMinimum: 0,
    },
  ],
  crs: 'known',
  units: 'dataset',
  output: {
    geometry: 'preserve',
    cardinality: 'variable',
    attributes: 'append',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Advanced generic spatial relationship operation.',
    whenToUse: [
      'A workflow explicitly needs a topological predicate or distance relation not covered by a higher-level tool.',
    ],
    avoidWhen: [
      'A more specific tool such as spatialFilter, near or spatialJoin directly matches the task.',
    ],
    keywords: [
      'spatial relation',
      'predicate',
      'intersects',
      'contains',
      'within',
      'distance within',
    ],
  },
  execute: (context) =>
    spatialRelation(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'reference'),
      toolParams<SpatialRelationOptions>(context),
      context.runtime,
    ),
});

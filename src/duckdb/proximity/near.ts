import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { distanceRelation, type DuckDbRelationHelperOptions } from '../selection/_operations';

export interface NearOptions extends DuckDbRelationHelperOptions {
  outputDistanceColumn?: string;
}
export function near(
  input: MapshaperDataset,
  reference: MapshaperDataset,
  options: NearOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return distanceRelation(
    input,
    reference,
    {
      ...options,
      outputColumn: options.outputDistanceColumn ?? options.outputColumn ?? 'near_distance',
    },
    runtime,
  );
}
export const nearTool = defineDuckDbTool({
  id: 'near',
  category: 'proximity',
  title: 'Near',
  description: 'Append the minimum distance from each input feature to a reference layer.',
  inputs: [
    {
      name: 'input',
      description: 'Features receiving distance values.',
      required: true,
      geometry: ['any'],
    },
    {
      name: 'reference',
      description: 'Features measured against.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [
    {
      name: 'outputDistanceColumn',
      description: 'Name of the appended distance field.',
      type: 'string',
      default: 'near_distance',
    },
  ],
  crs: 'projected',
  units: 'dataset',
  output: {
    geometry: 'preserve',
    cardinality: 'preserve',
    attributes: 'append',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Calculate nearest distance to another layer without returning the nearest feature.',
    whenToUse: ['Add distance-to-nearest-layer values to features.'],
    keywords: ['near', 'distance', 'proximity', 'minimum distance'],
  },
  execute: (context) =>
    near(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'reference'),
      toolParams<NearOptions>(context),
      context.runtime,
    ),
});
export type DuckDbNearOptions = NearOptions;

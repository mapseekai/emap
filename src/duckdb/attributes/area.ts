import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { runAttribute } from './_shared';
import type { AttributeOptions } from './types';
export function area(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runAttribute('area', input, options, runtime);
}
export const areaTool = defineDuckDbTool({
  id: 'area',
  category: 'attributes',
  title: 'Area',
  description: 'Append geometry area as an attribute.',
  inputs: [
    {
      name: 'input',
      description: 'Polygon features to measure.',
      required: true,
      geometry: ['polygon'],
    },
  ],
  parameters: [
    {
      name: 'outputColumn',
      description: 'Output area field.',
      type: 'string',
      default: 'duckdb_area',
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
  cost: 'low',
  agent: {
    summary: 'Calculate polygon area into a new field.',
    whenToUse: ['Measure feature area for analysis or filtering.'],
    keywords: ['area', 'measure area', 'polygon area'],
  },
  execute: (c) => area(requireToolInput(c, 'input'), toolParams<AttributeOptions>(c), c.runtime),
});

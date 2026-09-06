import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { runAttribute, type AttributeOptions } from './_shared';
export function perimeter(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runAttribute('perimeter', input, options, runtime);
}
export const perimeterTool = defineDuckDbTool({
  id: 'perimeter',
  category: 'attributes',
  title: 'Perimeter',
  description: 'Append polygon perimeter as an attribute.',
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
      description: 'Output perimeter field.',
      type: 'string',
      default: 'duckdb_perimeter',
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
    summary: 'Calculate polygon perimeter into a new field.',
    whenToUse: ['Measure polygon boundary length.'],
    keywords: ['perimeter', 'boundary length', 'measure'],
  },
  execute: (c) =>
    perimeter(requireToolInput(c, 'input'), toolParams<AttributeOptions>(c), c.runtime),
});

import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { runAttribute, type AttributeOptions } from './_shared';
export function length(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runAttribute('length', input, options, runtime);
}
export const lengthTool = defineDuckDbTool({
  id: 'length',
  category: 'attributes',
  title: 'Length',
  description: 'Append geometry length as an attribute.',
  inputs: [
    {
      name: 'input',
      description: 'Line or polygon features to measure.',
      required: true,
      geometry: ['polyline', 'polygon'],
    },
  ],
  parameters: [
    {
      name: 'outputColumn',
      description: 'Output length field.',
      type: 'string',
      default: 'duckdb_length',
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
    summary: 'Calculate geometry length into a new field.',
    whenToUse: ['Measure line length or geometry length for analysis.'],
    keywords: ['length', 'measure length', 'distance'],
  },
  execute: (c) => length(requireToolInput(c, 'input'), toolParams<AttributeOptions>(c), c.runtime),
});

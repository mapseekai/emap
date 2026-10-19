import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { type DuckDbRuntime } from '../runtime';
import { runAttribute } from './_shared';
import type { AttributeOptions } from './types';
/**
 * @example
 * const result = await geometryType(dataset, { outputColumn: 'geometry_type' });
 */
export function geometryType(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  return runAttribute('geometryType', input, options, runtime);
}
export const geometryTypeTool = defineDuckDbTool({
  id: 'geometryType',
  category: 'attributes',
  title: 'Geometry Type',
  description: 'Append the DuckDB geometry type as an attribute.',
  inputs: [
    {
      name: 'input',
      description: 'Features to inspect.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [
    {
      name: 'outputColumn',
      description: 'Output type field.',
      type: 'string',
      default: 'duckdb_geometry_type',
    },
  ],
  crs: 'any',
  units: 'none',
  output: {
    geometry: 'preserve',
    cardinality: 'preserve',
    attributes: 'append',
    mutatesInput: false,
  },
  cost: 'low',
  agent: {
    summary: 'Add geometry type information to feature attributes.',
    whenToUse: ['Inspect mixed or uncertain geometry datasets.'],
    keywords: ['geometry type', 'type', 'inspect geometry'],
  },
  execute: (c) =>
    geometryType(requireToolInput(c, 'input'), toolParams<AttributeOptions>(c), c.runtime),
});

import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { type DuckDbRuntime } from '../runtime';
import { runUnary } from './_shared';
import type { GeometryOptions } from './types';
/**
 * @example
 * const result = await boundary(polygons, { outputLayer: 'boundaries' });
 */
export function boundary(
  input: MapshaperDataset,
  options: GeometryOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  return runUnary('boundary', input, options, runtime);
}
export const boundaryTool = defineDuckDbTool({
  id: 'boundary',
  category: 'geometry',
  title: 'Boundary',
  description: 'Extract geometry boundaries.',
  inputs: [
    {
      name: 'input',
      description: 'Input features.',
      required: true,
      geometry: ['polyline', 'polygon'],
    },
  ],
  parameters: [],
  crs: 'any',
  units: 'none',
  output: {
    geometry: 'derived',
    cardinality: 'preserve',
    attributes: 'preserve',
    mutatesInput: false,
  },
  cost: 'low',
  agent: {
    summary: 'Extract the boundary of each geometry.',
    whenToUse: [
      'Convert polygon shells to lines.',
      'Extract endpoints/boundaries where supported.',
    ],
    keywords: ['boundary', 'outline', 'edge'],
  },
  execute: (c) => boundary(requireToolInput(c, 'input'), toolParams<GeometryOptions>(c), c.runtime),
});

import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { runUnary, type GeometryOptions } from './_shared';
export function centroid(
  input: MapshaperDataset,
  options: GeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runUnary('centroid', input, options, runtime);
}
export const centroidTool = defineDuckDbTool({
  id: 'centroid',
  category: 'geometry',
  title: 'Centroid',
  description: 'Create centroid points for input geometries.',
  inputs: [{ name: 'input', description: 'Input features.', required: true, geometry: ['any'] }],
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
    summary: 'Create one centroid point per feature.',
    whenToUse: ['Represent features by center points.'],
    keywords: ['centroid', 'center point'],
  },
  execute: (c) => centroid(requireToolInput(c, 'input'), toolParams<GeometryOptions>(c), c.runtime),
});

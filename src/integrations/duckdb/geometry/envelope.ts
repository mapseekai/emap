import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { type DuckDbRuntime } from '../runtime';
import { runUnary } from './_shared';
import type { GeometryOptions } from './types';
/**
 * @example
 * const result = await envelope(dataset, { outputLayer: 'envelopes' });
 */
export function envelope(
  input: MapshaperDataset,
  options: GeometryOptions = {},
  runtime: DuckDbRuntime | null = null,
) {
  return runUnary('envelope', input, options, runtime);
}
export const envelopeTool = defineDuckDbTool({
  id: 'envelope',
  category: 'geometry',
  title: 'Envelope',
  description: 'Create bounding rectangles for input geometries.',
  inputs: [
    {
      name: 'input',
      description: 'Input features.',
      required: true,
      geometry: ['any'],
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
    summary: 'Create axis-aligned bounding rectangles.',
    whenToUse: ['Approximate features by bounding boxes.'],
    keywords: ['envelope', 'bounding box', 'bbox'],
  },
  execute: (c) => envelope(requireToolInput(c, 'input'), toolParams<GeometryOptions>(c), c.runtime),
});

import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { runUnary } from './_shared';
import type { GeometryOptions } from './types';
export function convexHull(
  input: MapshaperDataset,
  options: GeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runUnary('convexHull', input, options, runtime);
}
export const convexHullTool = defineDuckDbTool({
  id: 'convexHull',
  category: 'geometry',
  title: 'Convex Hull',
  description: 'Create the convex hull of each input geometry.',
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
    summary: 'Wrap each feature in the smallest convex polygon.',
    whenToUse: ['Generalize irregular geometry to a convex footprint.'],
    keywords: ['convex hull', 'hull', 'footprint'],
  },
  execute: (c) =>
    convexHull(requireToolInput(c, 'input'), toolParams<GeometryOptions>(c), c.runtime),
});

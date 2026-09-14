import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import type { GeometryOptions } from '../geometry/types';
import { boundary } from '../geometry/boundary';
import { type DuckDbRuntime } from '../runtime';
/**
 * @example
 * const result = await polygonToLine(polygons);
 */
export function polygonToLine(
  input: MapshaperDataset,
  options: GeometryOptions = {},
  runtime: DuckDbRuntime | null = null,
) {
  return boundary(input, options, runtime);
}
export const polygonToLineTool = defineDuckDbTool({
  id: 'polygonToLine',
  category: 'transform',
  title: 'Polygon to Line',
  description: 'Convert polygon boundaries into line geometry.',
  inputs: [
    {
      name: 'input',
      description: 'Input polygon features.',
      required: true,
      geometry: ['polygon'],
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
    summary: 'Convert polygon outlines to line features.',
    whenToUse: ['Analyze or style polygon boundaries as lines.'],
    keywords: ['polygon to line', 'boundary', 'outline'],
  },
  execute: (c) =>
    polygonToLine(requireToolInput(c, 'input'), toolParams<GeometryOptions>(c), c.runtime),
});

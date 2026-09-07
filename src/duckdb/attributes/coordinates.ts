import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { runAttribute } from './_shared';
import type { AttributeOptions } from './types';

/**
 * @example
 * const result = await x(points, { outputColumn: 'x_coord' });
 */
export function x(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runAttribute('x', input, options, runtime);
}
/**
 * @example
 * const result = await y(points, { outputColumn: 'y_coord' });
 */
export function y(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runAttribute('y', input, options, runtime);
}
/**
 * @example
 * const result = await centroidX(polygons, { outputColumn: 'centroid_x' });
 */
export function centroidX(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runAttribute('centroidX', input, options, runtime);
}
/**
 * @example
 * const result = await centroidY(polygons, { outputColumn: 'centroid_y' });
 */
export function centroidY(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runAttribute('centroidY', input, options, runtime);
}

function coordinateTool(id: 'x' | 'y' | 'centroidX' | 'centroidY', title: string, fn: typeof x) {
  return defineDuckDbTool({
    id,
    category: 'attributes',
    title,
    description: `Append ${title} coordinate as an attribute.`,
    inputs: [
      {
        name: 'input',
        description: 'Features whose coordinates are inspected.',
        required: true,
        geometry: ['any'],
      },
    ],
    parameters: [
      {
        name: 'outputColumn',
        description: 'Output coordinate field.',
        type: 'string',
      },
    ],
    crs: 'any',
    units: 'dataset',
    output: {
      geometry: 'preserve',
      cardinality: 'preserve',
      attributes: 'append',
      mutatesInput: false,
    },
    cost: 'low',
    agent: {
      summary: `Calculate ${title} coordinate values.`,
      whenToUse: ['Expose geometry coordinates for sorting, labels or attribute analysis.'],
      keywords: [title.toLowerCase(), 'coordinate', 'centroid coordinate'],
    },
    execute: (c) => fn(requireToolInput(c, 'input'), toolParams<AttributeOptions>(c), c.runtime),
  });
}
export const xTool = coordinateTool('x', 'X', x);
export const yTool = coordinateTool('y', 'Y', y);
export const centroidXTool = coordinateTool('centroidX', 'Centroid X', centroidX);
export const centroidYTool = coordinateTool('centroidY', 'Centroid Y', centroidY);

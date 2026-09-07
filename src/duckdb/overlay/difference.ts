import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runOverlayTool } from '../core/runners/overlay';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { OVERLAY_OPERATIONS } from './_shared';
import type { OverlayOptions } from './types';

/**
 * @example
 * const options: DifferenceOptions = { outputLayer: 'difference' };
 */
export type DifferenceOptions = OverlayOptions;
/**
 * @example
 * const result = await difference(input, mask, { outputLayer: 'difference' });
 */
export function difference(
  input: MapshaperDataset,
  mask: MapshaperDataset,
  options: DifferenceOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runOverlayTool(input, mask, options, OVERLAY_OPERATIONS.difference, runtime);
}
export const differenceTool = defineDuckDbTool({
  id: 'difference',
  category: 'overlay',
  title: 'Difference',
  description: 'Subtract mask coverage from input geometry.',
  inputs: [
    { name: 'input', description: 'Features to subtract from.', required: true, geometry: ['any'] },
    { name: 'mask', description: 'Features to subtract.', required: true, geometry: ['any'] },
  ],
  parameters: [],
  crs: 'known',
  units: 'none',
  output: {
    geometry: 'derived',
    cardinality: 'variable',
    attributes: 'preserve',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Remove overlapping mask geometry from input features.',
    whenToUse: ['Erase exclusion zones from a layer.'],
    keywords: ['difference', 'erase', 'subtract', 'overlay'],
  },
  execute: (context) =>
    difference(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'mask'),
      toolParams<DifferenceOptions>(context),
      context.runtime,
    ),
});

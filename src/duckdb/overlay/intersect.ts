import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runOverlayTool } from '../core/runners/overlay';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { OVERLAY_OPERATIONS, type OverlayOptions } from './_shared';

export type IntersectOptions = OverlayOptions;

export function intersect(
  input: MapshaperDataset,
  mask: MapshaperDataset,
  options: IntersectOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runOverlayTool(input, mask, options, OVERLAY_OPERATIONS.intersect, runtime);
}

export const intersectTool = defineDuckDbTool({
  id: 'intersect',
  category: 'overlay',
  title: 'Intersect',
  description: 'Keep the portions of input features that intersect the mask coverage.',
  aliases: ['intersection'],
  inputs: [
    { name: 'input', description: 'Features to intersect.', required: true, geometry: ['any'] },
    { name: 'mask', description: 'Mask or overlay features.', required: true, geometry: ['any'] },
  ],
  parameters: [],
  crs: 'known',
  units: 'none',
  output: {
    geometry: 'derived',
    cardinality: 'filter',
    attributes: 'preserve',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Intersect two spatial layers and keep input attributes.',
    whenToUse: [
      'Cut input geometry by overlapping mask geometry.',
      'Keep only overlapping portions.',
    ],
    keywords: ['intersect', 'intersection', 'overlay', 'overlap'],
    examples: ['Intersect parcels with a flood zone.'],
  },
  execute: (context) =>
    intersect(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'mask'),
      toolParams<IntersectOptions>(context),
      context.runtime,
    ),
});

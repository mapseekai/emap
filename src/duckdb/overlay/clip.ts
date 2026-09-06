import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import type { DuckDbRuntime } from '../runtime';
import { getDuckDbRuntime } from '../runtime';
import { intersect, type IntersectOptions } from './intersect';

export type ClipOptions = IntersectOptions;

export function clip(
  input: MapshaperDataset,
  mask: MapshaperDataset,
  options: ClipOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return intersect(input, mask, options, runtime);
}

export const clipTool = defineDuckDbTool({
  id: 'clip',
  category: 'overlay',
  title: 'Clip',
  description:
    'Clip input features to the unioned mask coverage while preserving input attributes.',
  inputs: [
    { name: 'input', description: 'Features to clip.', required: true, geometry: ['any'] },
    { name: 'mask', description: 'Clip boundary features.', required: true, geometry: ['polygon'] },
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
    summary: 'Clip a layer to a polygon mask.',
    whenToUse: ['Trim features to an area of interest.'],
    keywords: ['clip', 'mask', 'crop', 'area of interest'],
  },
  execute: (context) =>
    clip(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'mask'),
      toolParams<ClipOptions>(context),
      context.runtime,
    ),
});

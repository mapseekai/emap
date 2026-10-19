import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { type DuckDbRuntime } from '../runtime';
import { merge, type MergeOptions } from './merge';
/**
 * @example
 * const result = await append(target, incoming);
 */
export function append(
  target: MapshaperDataset,
  incoming: MapshaperDataset,
  options: MergeOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  return merge(target, incoming, options, runtime);
}
export const appendTool = defineDuckDbTool({
  id: 'append',
  category: 'dataManagement',
  title: 'Append',
  description: 'Append incoming features to a target dataset and return a new immutable result.',
  inputs: [
    { name: 'target', description: 'Target dataset.', required: true, geometry: ['any'] },
    {
      name: 'incoming',
      description: 'Features appended to the target.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [],
  crs: 'known',
  units: 'none',
  output: { geometry: 'preserve', cardinality: 'expand', attributes: 'merge', mutatesInput: false },
  cost: 'medium',
  agent: {
    summary: 'Append new features to an existing logical dataset without mutating the original.',
    whenToUse: ['Extend a target layer with newly loaded or generated features.'],
    keywords: ['append', 'add features', 'insert rows', 'extend dataset'],
  },
  execute: (c) =>
    append(
      requireToolInput(c, 'target'),
      requireToolInput(c, 'incoming'),
      toolParams<MergeOptions>(c),
      c.runtime,
    ),
});

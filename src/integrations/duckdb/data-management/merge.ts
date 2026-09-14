import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runTwoInputTool } from '../core/runners/processing';
import type { ProcessingOptions } from '../core/types';
import { quoteIdentifier } from '../core/pipeline';
import { type DuckDbRuntime } from '../runtime';
/**
 * @example
 * const options: MergeOptions = { outputLayer: 'merged' };
 */
export type MergeOptions = ProcessingOptions;
/**
 * @example
 * const result = await merge(left, right, { outputLayer: 'merged' });
 */
export function merge(
  input: MapshaperDataset,
  incoming: MapshaperDataset,
  options: MergeOptions = {},
  runtime: DuckDbRuntime | null = null,
) {
  return runTwoInputTool(
    input,
    incoming,
    'merge',
    options,
    (left, right) =>
      `SELECT * FROM ${quoteIdentifier(left)} UNION ALL BY NAME SELECT * FROM ${quoteIdentifier(right)}`,
    runtime,
    true,
  );
}
export const mergeTool = defineDuckDbTool({
  id: 'merge',
  category: 'dataManagement',
  title: 'Merge',
  description: 'Combine two compatible datasets into a new output dataset.',
  inputs: [
    { name: 'input', description: 'Primary dataset.', required: true, geometry: ['any'] },
    {
      name: 'incoming',
      description: 'Dataset to merge with the primary.',
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
    summary: 'Combine rows/features from multiple compatible datasets.',
    whenToUse: ['Create a new dataset containing features from two sources.'],
    keywords: ['merge', 'combine datasets', 'union all', 'append rows'],
  },
  execute: (c) =>
    merge(
      requireToolInput(c, 'input'),
      requireToolInput(c, 'incoming'),
      toolParams<MergeOptions>(c),
      c.runtime,
    ),
});

import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { type DuckDbRuntime } from '../runtime';
import { runAttribute } from './_shared';
import type { AttributeOptions } from './types';

/**
 * @example
 * const result = await isValid(dataset, { outputColumn: 'is_valid' });
 */
export function isValid(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  return runAttribute('isValid', input, options, runtime);
}
/**
 * @example
 * const result = await isEmpty(dataset, { outputColumn: 'is_empty' });
 */
export function isEmpty(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  return runAttribute('isEmpty', input, options, runtime);
}
/**
 * @example
 * const result = await isSimple(dataset, { outputColumn: 'is_simple' });
 */
export function isSimple(
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  return runAttribute('isSimple', input, options, runtime);
}

function attributeTool(
  id: 'isValid' | 'isEmpty' | 'isSimple',
  title: string,
  summary: string,
  fn: typeof isValid,
) {
  return defineDuckDbTool({
    id,
    category: 'attributes',
    title,
    description: `Append ${title.toLowerCase()} geometry status as an attribute.`,
    inputs: [
      {
        name: 'input',
        description: 'Features to inspect.',
        required: true,
        geometry: ['any'],
      },
    ],
    parameters: [
      {
        name: 'outputColumn',
        description: 'Output status field.',
        type: 'string',
      },
    ],
    crs: 'any',
    units: 'none',
    output: {
      geometry: 'preserve',
      cardinality: 'preserve',
      attributes: 'append',
      mutatesInput: false,
    },
    cost: 'low',
    agent: {
      summary,
      whenToUse: ['Inspect geometry quality before downstream spatial processing.'],
      keywords: [title.toLowerCase(), 'geometry quality', 'validation'],
    },
    execute: (c) => fn(requireToolInput(c, 'input'), toolParams<AttributeOptions>(c), c.runtime),
  });
}
export const isValidTool = attributeTool(
  'isValid',
  'Is Valid',
  'Check whether each geometry is valid.',
  isValid,
);
export const isEmptyTool = attributeTool(
  'isEmpty',
  'Is Empty',
  'Check whether each geometry is empty.',
  isEmpty,
);
export const isSimpleTool = attributeTool(
  'isSimple',
  'Is Simple',
  'Check whether each geometry is simple.',
  isSimple,
);

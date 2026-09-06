import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runSingleInputTool } from '../core/runners/processing';
import type { ProcessingOptions } from '../core/types';
import { quoteIdentifier } from '../core/pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { dumpSql } from './_dump';
export type MultipartToSinglepartOptions = ProcessingOptions;
export function multipartToSinglepart(
  input: MapshaperDataset,
  options: MultipartToSinglepartOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runSingleInputTool(
    input,
    'multipart_to_singlepart',
    options,
    (table, geom) => dumpSql(table, geom, `i.${quoteIdentifier(geom)}`),
    runtime,
  );
}
export const multipartToSinglepartTool = defineDuckDbTool({
  id: 'multipartToSinglepart',
  category: 'geometry',
  title: 'Multipart to Singlepart',
  aliases: ['explode'],
  description: 'Explode multipart geometries into one feature per geometry part.',
  inputs: [
    { name: 'input', description: 'Multipart input features.', required: true, geometry: ['any'] },
  ],
  parameters: [],
  crs: 'any',
  units: 'none',
  output: {
    geometry: 'derived',
    cardinality: 'expand',
    attributes: 'preserve',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Split multipart features into individual features.',
    whenToUse: ['Normalize multipart geometry before editing, joins or analysis.'],
    keywords: ['multipart', 'singlepart', 'explode', 'split parts'],
  },
  execute: (c) =>
    multipartToSinglepart(
      requireToolInput(c, 'input'),
      toolParams<MultipartToSinglepartOptions>(c),
      c.runtime,
    ),
});

import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runSingleInputTool } from '../core/runners/processing';
import type { ProcessingOptions } from '../core/types';
import { quoteIdentifier } from '../core/pipeline';
import { type DuckDbRuntime } from '../runtime';
import { dumpSql } from './_dump';
export type ExtractVerticesOptions = ProcessingOptions;
/**
 * @example
 * const result = await extractVertices(lines);
 */
export function extractVertices(
  input: MapshaperDataset,
  options: ExtractVerticesOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  return runSingleInputTool(
    input,
    'extract_vertices',
    options,
    (table, geom) => dumpSql(table, geom, `ST_Points(i.${quoteIdentifier(geom)})`),
    runtime,
  );
}
export const extractVerticesTool = defineDuckDbTool({
  id: 'extractVertices',
  category: 'geometry',
  title: 'Extract Vertices',
  description: 'Create point features from every input geometry vertex.',
  inputs: [
    {
      name: 'input',
      description: 'Features whose vertices are extracted.',
      required: true,
      geometry: ['any'],
    },
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
    summary: 'Convert all geometry vertices to point features.',
    whenToUse: ['Inspect vertices or run point-based analysis on geometry nodes.'],
    keywords: ['extract vertices', 'vertices to points', 'nodes', 'points'],
  },
  execute: (c) =>
    extractVertices(requireToolInput(c, 'input'), toolParams<ExtractVerticesOptions>(c), c.runtime),
});

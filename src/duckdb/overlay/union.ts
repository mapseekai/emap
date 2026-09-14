import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { coverageCte, runTwoInputTool } from '../core/runners/processing';
import type { ProcessingOptions } from '../core/types';
import { quoteIdentifier } from '../core/pipeline';
import { type DuckDbRuntime } from '../runtime';

/**
 * @example
 * const options: UnionOptions = { outputLayer: 'union' };
 */
export type UnionOptions = ProcessingOptions;
/**
 * @example
 * const result = await union(left, right, { outputLayer: 'union' });
 */
export function union(
  input: MapshaperDataset,
  overlay: MapshaperDataset,
  options: UnionOptions = {},
  runtime: DuckDbRuntime | null = null,
) {
  return runTwoInputTool(
    input,
    overlay,
    'union',
    options,
    (left, right, geometryColumn) => {
      const geom = quoteIdentifier(geometryColumn);
      return `WITH\n${coverageCte(left, geometryColumn, 'a')},\n${coverageCte(right, geometryColumn, 'b')}\nSELECT ST_AsWKB(ST_Union(a.geom, b.geom)) AS ${geom}\nFROM a CROSS JOIN b\nWHERE a.geom IS NOT NULL OR b.geom IS NOT NULL`;
    },
    runtime,
    true,
  );
}
export const unionTool = defineDuckDbTool({
  id: 'union',
  category: 'overlay',
  title: 'Union',
  description: 'Create the union coverage of two datasets.',
  inputs: [
    { name: 'input', description: 'Primary coverage.', required: true, geometry: ['any'] },
    { name: 'overlay', description: 'Secondary coverage.', required: true, geometry: ['any'] },
  ],
  parameters: [],
  crs: 'known',
  units: 'none',
  output: {
    geometry: 'derived',
    cardinality: 'aggregate',
    attributes: 'replace',
    mutatesInput: false,
  },
  cost: 'high',
  agent: {
    summary: 'Combine two spatial coverages into one geometry result.',
    whenToUse: ['Merge overlapping spatial coverage from two layers.'],
    avoidWhen: ['You need full QGIS-style split overlay attributes from both layers.'],
    keywords: ['union', 'overlay', 'combine coverage'],
  },
  execute: (context) =>
    union(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'overlay'),
      toolParams<UnionOptions>(context),
      context.runtime,
    ),
});

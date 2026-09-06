import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import {
  coverageCte,
  runTwoInputTool,
  type DuckDbProcessingGeometryOptions,
} from '../core/runners/processing';
import { quoteIdentifier } from '../core/pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';

export type SymmetricDifferenceOptions = DuckDbProcessingGeometryOptions;
export function symmetricDifference(
  input: MapshaperDataset,
  overlay: MapshaperDataset,
  options: SymmetricDifferenceOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runTwoInputTool(
    input,
    overlay,
    'symmetric_difference',
    options,
    (left, right, geometryColumn) => {
      const geom = quoteIdentifier(geometryColumn);
      return `WITH\n${coverageCte(left, geometryColumn, 'a')},\n${coverageCte(right, geometryColumn, 'b')}\nSELECT ST_AsWKB(ST_Union(ST_Difference(a.geom, b.geom), ST_Difference(b.geom, a.geom))) AS ${geom}\nFROM a CROSS JOIN b\nWHERE a.geom IS NOT NULL AND b.geom IS NOT NULL`;
    },
    runtime,
    true,
  );
}
export const symmetricDifferenceTool = defineDuckDbTool({
  id: 'symmetricDifference',
  category: 'overlay',
  title: 'Symmetric Difference',
  aliases: ['symDiff'],
  description: 'Keep areas belonging to either input coverage but not both.',
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
    summary: 'Find non-overlapping portions of two coverages.',
    whenToUse: ['Compare two areas and keep only their differences.'],
    keywords: ['symmetric difference', 'symdiff', 'xor', 'overlay'],
  },
  execute: (context) =>
    symmetricDifference(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'overlay'),
      toolParams<SymmetricDifferenceOptions>(context),
      context.runtime,
    ),
});

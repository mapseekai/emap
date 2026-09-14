import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { aggregateSql, runSingleInputTool } from '../core/runners/processing';
import { quoteIdentifier } from '../core/pipeline';
import { type DuckDbRuntime } from '../runtime';
import type { AggregateOptions } from './types';

/**
 * @example
 * const result = await dissolve(dataset, { groupBy: ['category'] });
 */
export function dissolve(
  input: MapshaperDataset,
  options: AggregateOptions = {},
  runtime: DuckDbRuntime | null = null,
) {
  return runSingleInputTool(
    input,
    'dissolve',
    options,
    (tableName, geometryColumn) => {
      const geom = quoteIdentifier(geometryColumn);
      return aggregateSql(
        tableName,
        geometryColumn,
        options.groupBy ?? [],
        `ST_Union_Agg(${geom})`,
      );
    },
    runtime,
  );
}
export const dissolveTool = defineDuckDbTool({
  id: 'dissolve',
  category: 'aggregate',
  title: 'Dissolve',
  description: 'Dissolve geometries globally or by attribute fields.',
  inputs: [
    {
      name: 'input',
      description: 'Features to dissolve.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [
    {
      name: 'groupBy',
      description: 'Fields used to form dissolve groups.',
      type: 'string[]',
      default: [],
    },
  ],
  crs: 'any',
  units: 'none',
  output: {
    geometry: 'derived',
    cardinality: 'aggregate',
    attributes: 'replace',
    mutatesInput: false,
  },
  cost: 'high',
  agent: {
    summary: 'Merge features sharing group values and remove internal boundaries.',
    whenToUse: [
      'Combine polygons or lines by category.',
      'Create one coverage from many features.',
    ],
    keywords: ['dissolve', 'aggregate', 'union by field', 'remove boundaries'],
  },
  execute: (context) =>
    dissolve(
      requireToolInput(context, 'input'),
      toolParams<AggregateOptions>(context),
      context.runtime,
    ),
});

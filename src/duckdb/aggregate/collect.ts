import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { aggregateSql, runSingleInputTool } from '../core/runners/processing';
import { quoteIdentifier } from '../core/pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import type { AggregateOptions } from './types';

/**
 * @example
 * const result = await collect(dataset, { groupBy: ['category'] });
 */
export function collect(
  input: MapshaperDataset,
  options: AggregateOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runSingleInputTool(
    input,
    'collect',
    options,
    (tableName, geometryColumn) => {
      const geom = quoteIdentifier(geometryColumn);
      return aggregateSql(
        tableName,
        geometryColumn,
        options.groupBy ?? [],
        `ST_Collect(list(${geom}))`,
      );
    },
    runtime,
  );
}
export const collectTool = defineDuckDbTool({
  id: 'collect',
  category: 'aggregate',
  title: 'Collect',
  description: 'Collect geometries into multi/collection geometries globally or by fields.',
  inputs: [
    {
      name: 'input',
      description: 'Features to collect.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [
    {
      name: 'groupBy',
      description: 'Fields used to form collection groups.',
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
  cost: 'medium',
  agent: {
    summary: 'Group geometries without topological dissolving.',
    whenToUse: ['Create multi-geometries while retaining separate component boundaries.'],
    keywords: ['collect', 'multi geometry', 'aggregate', 'group'],
  },
  execute: (context) =>
    collect(
      requireToolInput(context, 'input'),
      toolParams<AggregateOptions>(context),
      context.runtime,
    ),
});

import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { aggregateSql, runSingleInputTool } from '../core/runners/processing';
import { quoteIdentifier } from '../core/pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import type { AggregateOptions } from '../aggregate/types';

/**
 * @example
 * const options: PointToLineOptions = { groupBy: ['route'], orderBy: 'sequence' };
 */
export interface PointToLineOptions extends AggregateOptions {
  orderBy?: string;
}
/**
 * @example
 * const result = await pointToLine(points, { groupBy: ['route'], orderBy: 'sequence' });
 */
export function pointToLine(
  input: MapshaperDataset,
  options: PointToLineOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runSingleInputTool(
    input,
    'point_to_line',
    options,
    (table, geomColumn) => {
      const geom = quoteIdentifier(geomColumn);
      const order = options.orderBy ? ` ORDER BY ${quoteIdentifier(options.orderBy)}` : '';
      return aggregateSql(
        table,
        geomColumn,
        options.groupBy ?? [],
        `ST_MakeLine(list(${geom}${order}))`,
      );
    },
    runtime,
  );
}
export const pointToLineTool = defineDuckDbTool({
  id: 'pointToLine',
  category: 'transform',
  title: 'Point to Line',
  description: 'Create lines from ordered point features, optionally grouped by fields.',
  inputs: [
    { name: 'input', description: 'Input point features.', required: true, geometry: ['point'] },
  ],
  parameters: [
    {
      name: 'groupBy',
      description: 'Fields defining separate output lines.',
      type: 'string[]',
      default: [],
    },
    {
      name: 'orderBy',
      description: 'Field controlling point order along each line.',
      type: 'string',
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
    summary: 'Connect ordered points into lines.',
    whenToUse: ['Build tracks, routes or paths from point observations.'],
    keywords: ['point to line', 'connect points', 'track', 'route'],
  },
  execute: (c) =>
    pointToLine(requireToolInput(c, 'input'), toolParams<PointToLineOptions>(c), c.runtime),
});

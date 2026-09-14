import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { aggregateSql, runSingleInputTool } from '../core/runners/processing';
import { quoteIdentifier } from '../core/pipeline';
import { type DuckDbRuntime } from '../runtime';
import type { AggregateOptions } from '../aggregate/types';
/**
 * @example
 * const result = await lineToPolygon(lines, { groupBy: ['zone'] });
 */
export function lineToPolygon(
  input: MapshaperDataset,
  options: AggregateOptions = {},
  runtime: DuckDbRuntime | null = null,
) {
  return runSingleInputTool(
    input,
    'line_to_polygon',
    options,
    (table, geomColumn) => {
      const geom = quoteIdentifier(geomColumn);
      return aggregateSql(
        table,
        geomColumn,
        options.groupBy ?? [],
        `ST_CollectionExtract(ST_Polygonize(list(${geom})), 3)`,
      );
    },
    runtime,
  );
}
export const lineToPolygonTool = defineDuckDbTool({
  id: 'lineToPolygon',
  category: 'transform',
  title: 'Line to Polygon',
  description: 'Polygonize closed linework into polygon features.',
  inputs: [
    {
      name: 'input',
      description: 'Input line features.',
      required: true,
      geometry: ['polyline'],
    },
  ],
  parameters: [
    {
      name: 'groupBy',
      description: 'Fields used to polygonize independent groups.',
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
    summary: 'Build polygons from line networks or closed rings.',
    whenToUse: ['Convert boundary linework into polygon areas.'],
    keywords: ['line to polygon', 'polygonize', 'closed lines', 'area'],
  },
  execute: (c) =>
    lineToPolygon(requireToolInput(c, 'input'), toolParams<AggregateOptions>(c), c.runtime),
});

import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runTwoInputTool, type DuckDbProcessingGeometryOptions } from '../core/runners/processing';
import { quoteIdentifier } from '../core/pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';

export interface NearestOptions extends DuckDbProcessingGeometryOptions {
  outputDistanceColumn?: string;
  outputNearestIdColumn?: string;
  nearestIdField?: string;
}
export function nearest(
  input: MapshaperDataset,
  reference: MapshaperDataset,
  options: NearestOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runTwoInputTool(
    input,
    reference,
    'nearest',
    options,
    (left, right, geometryColumn) => {
      const l = quoteIdentifier(left);
      const r = quoteIdentifier(right);
      const geom = quoteIdentifier(geometryColumn);
      const distanceColumn = quoteIdentifier(options.outputDistanceColumn ?? 'nearest_distance');
      const idColumn = quoteIdentifier(options.outputNearestIdColumn ?? 'nearest_id');
      const nearestId = options.nearestIdField
        ? `n.${quoteIdentifier(options.nearestIdField)}`
        : 'n.__nearest_rowid';
      return `WITH nearest_source AS (\n  SELECT *, row_number() OVER () - 1 AS __nearest_rowid FROM ${r}\n)\nSELECT\n  l.*,\n  ${nearestId} AS ${idColumn},\n  ST_Distance(l.${geom}, n.${geom}) AS ${distanceColumn}\nFROM ${l} AS l\nLEFT JOIN LATERAL (\n  SELECT * FROM nearest_source\n  WHERE ${geom} IS NOT NULL\n  ORDER BY ST_Distance(l.${geom}, ${geom})\n  LIMIT 1\n) AS n ON TRUE`;
    },
    runtime,
    true,
  );
}
export const nearestTool = defineDuckDbTool({
  id: 'nearest',
  category: 'proximity',
  title: 'Nearest',
  description: 'Find the nearest feature for each input and append its identifier and distance.',
  inputs: [
    {
      name: 'input',
      description: 'Features that need a nearest match.',
      required: true,
      geometry: ['any'],
    },
    {
      name: 'reference',
      description: 'Candidate nearest features.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [
    {
      name: 'nearestIdField',
      description: 'Reference attribute used as nearest identifier.',
      type: 'string',
    },
    {
      name: 'outputNearestIdColumn',
      description: 'Output nearest-id field name.',
      type: 'string',
      default: 'nearest_id',
    },
    {
      name: 'outputDistanceColumn',
      description: 'Output distance field name.',
      type: 'string',
      default: 'nearest_distance',
    },
  ],
  crs: 'projected',
  units: 'dataset',
  output: {
    geometry: 'preserve',
    cardinality: 'preserve',
    attributes: 'append',
    mutatesInput: false,
  },
  cost: 'high',
  agent: {
    summary: 'Find the closest reference feature for every input feature.',
    whenToUse: ['Associate each feature with its closest facility, road, point or polygon.'],
    keywords: ['nearest', 'closest', 'near', 'knn', 'proximity'],
  },
  execute: (context) =>
    nearest(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'reference'),
      toolParams<NearestOptions>(context),
      context.runtime,
    ),
});
export type DuckDbNearestOptions = NearestOptions;

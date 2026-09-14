import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { processingValidation, runTwoInputTool } from '../core/runners/processing';
import { assertProjectedCrs } from '../core/dataset-crs';
import type { ProcessingOptions } from '../core/types';
import {
  preserveEmptyGeometryType,
  quoteIdentifier,
  resolveUniqueColumnName,
  tableFieldNames,
} from '../core/pipeline';
import { type DuckDbRuntime } from '../runtime';

/**
 * @example
 * const options: NearestOptions = { nearestIdField: 'road_id' };
 */
export interface NearestOptions extends ProcessingOptions {
  outputDistanceColumn?: string;
  outputNearestIdColumn?: string;
  nearestIdField?: string;
}
/**
 * @example
 * const result = await nearest(buildings, roads, { nearestIdField: 'road_id' });
 */
export async function nearest(
  input: MapshaperDataset,
  reference: MapshaperDataset,
  options: NearestOptions = {},
  runtime: DuckDbRuntime | null = null,
) {
  assertProjectedCrs([input, reference], 'DuckDB nearest requires a known projected CRS');
  const result = await runTwoInputTool(
    input,
    reference,
    'nearest',
    options,
    (left, right, geometryColumn, [inputTable, referenceTable]) => {
      const l = quoteIdentifier(left);
      const r = quoteIdentifier(right);
      const geom = quoteIdentifier(geometryColumn);
      // DuckDB identifiers are case-insensitive, including quoted identifiers.
      const reserved = new Set(tableFieldNames(inputTable).map((name) => name.toLowerCase()));
      const outputColumn = (
        field: 'outputNearestIdColumn' | 'outputDistanceColumn',
        fallback: string,
      ) => {
        const name = options[field] ?? fallback;
        if (!name.trim() || reserved.has(name.toLowerCase())) {
          throw processingValidation('nearest', `${field} must be non-empty and unique`, field);
        }
        reserved.add(name.toLowerCase());
        return quoteIdentifier(name);
      };
      const idColumn = outputColumn('outputNearestIdColumn', 'nearest_id');
      const distanceColumn = outputColumn('outputDistanceColumn', 'nearest_distance');
      const inputRowId = quoteIdentifier(
        resolveUniqueColumnName('__nearest_input_rowid', reserved),
      );
      const referenceFields = new Set(
        tableFieldNames(referenceTable).map((name) => name.toLowerCase()),
      );
      if (
        options.nearestIdField !== undefined &&
        !referenceFields.has(options.nearestIdField.toLowerCase())
      ) {
        throw processingValidation(
          'nearest',
          'nearestIdField does not exist in the reference layer',
          'nearestIdField',
        );
      }
      const rowId = quoteIdentifier(resolveUniqueColumnName('__nearest_rowid', referenceFields));
      const nearestId = `n.${options.nearestIdField === undefined ? rowId : quoteIdentifier(options.nearestIdField)}`;
      return `WITH nearest_input AS (\n  SELECT *, row_number() OVER () - 1 AS ${inputRowId} FROM ${l}\n), nearest_source AS (\n  SELECT *, row_number() OVER () - 1 AS ${rowId} FROM ${r}\n)\nSELECT\n  l.* EXCLUDE (${inputRowId}),\n  ${nearestId} AS ${idColumn},\n  ST_Distance(l.${geom}, n.${geom}) AS ${distanceColumn}\nFROM nearest_input AS l\nLEFT JOIN LATERAL (\n  SELECT * FROM nearest_source\n  WHERE l.${geom} IS NOT NULL AND NOT ST_IsEmpty(l.${geom})\n    AND ${geom} IS NOT NULL AND NOT ST_IsEmpty(${geom})\n  ORDER BY ST_Distance(l.${geom}, ${geom}), ${rowId}\n  LIMIT 1\n) AS n ON TRUE\nORDER BY l.${inputRowId}`;
    },
    runtime,
    true,
  );
  return preserveEmptyGeometryType(result, input, options);
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

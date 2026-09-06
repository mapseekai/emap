import type { MapshaperDataset } from '../../../types/mapshaper-types';
import { alignSecondaryDatasetCrs } from '../dataset-crs';
import { DuckDbOperationError } from '../../errors';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  quoteIdentifier,
  requireDuckDbRuntime,
  runDuckDbPipeline,
} from '../pipeline';
import type { DuckDbRuntime } from '../../runtime';

export interface DuckDbProcessingGeometryOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
}

export function processingValidation(
  label: string,
  message: string,
  field?: string,
): DuckDbOperationError {
  return new DuckDbOperationError('validation', `DuckDB ${label} ${message}`, { field });
}

export function finitePositive(label: string, field: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw processingValidation(label, `${field} must be a finite positive number`, field);
  }
  return value;
}

export function quoteColumns(columns: readonly string[]): string {
  return columns.map(quoteIdentifier).join(', ');
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function runSingleInputTool(
  dataset: MapshaperDataset,
  label: string,
  opts: DuckDbProcessingGeometryOptions,
  buildSql: (tableName: string, geometryColumn: string) => string,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  const rt = requireDuckDbRuntime(runtime);
  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const input = datasetToArrowInput(dataset, opts, label);
  return runDuckDbPipeline({
    label,
    runtime: rt,
    inputs: [{ table: input, prefix: `emap_duckdb_${label}_input` }],
    buildSql: ([tableName]) => buildSql(tableName!, geometryColumn),
    convertResult: (result) =>
      arrowResultToDataset(result, { layerName: opts.outputLayer, geometryColumn }, dataset, label),
  });
}

export async function runTwoInputTool(
  primary: MapshaperDataset,
  secondary: MapshaperDataset,
  label: string,
  opts: DuckDbProcessingGeometryOptions,
  buildSql: (primaryTable: string, secondaryTable: string, geometryColumn: string) => string,
  runtime: DuckDbRuntime | null,
  alignCrs = false,
): Promise<MapshaperDataset> {
  const rt = requireDuckDbRuntime(runtime);
  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const secondaryInput = alignCrs ? await alignSecondaryDatasetCrs(primary, secondary) : secondary;
  const left = datasetToArrowInput(primary, opts, label);
  const right = datasetToArrowInput(secondaryInput, { geometryColumn }, label);
  return runDuckDbPipeline({
    label,
    runtime: rt,
    inputs: [
      { table: left, prefix: `emap_duckdb_${label}_left` },
      { table: right, prefix: `emap_duckdb_${label}_right` },
    ],
    buildSql: ([leftName, rightName]) => buildSql(leftName!, rightName!, geometryColumn),
    convertResult: (result) =>
      arrowResultToDataset(result, { layerName: opts.outputLayer, geometryColumn }, primary, label),
  });
}

export function aggregateSql(
  tableName: string,
  geometryColumn: string,
  groupBy: readonly string[],
  expression: string,
): string {
  const table = quoteIdentifier(tableName);
  const geom = quoteIdentifier(geometryColumn);
  const groups = quoteColumns(groupBy);
  const projection = groups ? `${groups},\n  ` : '';
  const groupClause = groups ? `\nGROUP BY ${groups}` : '';
  return `SELECT\n  ${projection}ST_AsWKB(${expression}) AS ${geom}\nFROM ${table}\nWHERE ${geom} IS NOT NULL${groupClause}`;
}

export function coverageCte(tableName: string, geometryColumn: string, alias: string): string {
  const table = quoteIdentifier(tableName);
  const geom = quoteIdentifier(geometryColumn);
  return `${alias} AS (SELECT ST_Union_Agg(${geom}) AS geom FROM ${table} WHERE ${geom} IS NOT NULL)`;
}

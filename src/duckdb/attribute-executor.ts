import type { Table } from 'apache-arrow';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './errors';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  requireDuckDbRuntime,
  resolveTableColumnName,
  runDuckDbPipeline,
} from './pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from './runtime';
import { buildAttributeSql } from './sql';

export interface DuckDbAttributeOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
  outputColumn?: string;
}

export interface DuckDbAttributeOperationSpec {
  id: string;
  duckDbFunction: string;
  buildExpression?: (geometryColumn: string) => string;
}

export function resolveAttributeOutputColumn(table: Table, requestedName: string): string {
  return resolveTableColumnName(table, requestedName);
}

export async function processAttributeWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOptions,
  spec: DuckDbAttributeOperationSpec,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const rt = requireDuckDbRuntime(runtime);

  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const requestedOutputColumn = opts.outputColumn ?? `duckdb_${spec.id}`;
  const trimmedOutputColumn = requestedOutputColumn.trim();
  if (!trimmedOutputColumn) {
    throw new DuckDbOperationError('validation', 'DuckDB attribute output column is required', {
      field: 'outputColumn',
    });
  }

  const input = datasetToArrowInput(dataset, { layer: opts.layer, geometryColumn }, spec.id);
  const outputColumn = resolveAttributeOutputColumn(input, trimmedOutputColumn);

  return runDuckDbPipeline({
    label: spec.id,
    runtime: rt,
    inputs: [{ table: input, prefix: 'emap_duckdb_attribute_input' }],
    buildSql: ([tableName]) =>
      buildAttributeSql({
        tableName: tableName!,
        geometryColumn,
        duckDbFunction: spec.duckDbFunction,
        buildExpression: spec.buildExpression,
        outputColumn,
      }),
    convertResult: (resultTable) =>
      arrowResultToDataset(resultTable, { layerName: opts.outputLayer }, dataset, spec.id),
  });
}

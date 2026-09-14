import type { Table } from 'apache-arrow';
import type { MapshaperDataset } from '../../../types/mapshaper-types';
import { DuckDbOperationError } from '../../errors';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  requireRuntime,
  resolveTableColumnName,
  runPipeline,
} from '../pipeline';
import { type DuckDbRuntime } from '../../runtime';
import { buildAttributeSql } from '../sql/attribute';

export interface AttributeRunnerOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
  outputColumn?: string;
}

export interface AttributeOperation {
  id: string;
  duckDbFunction: string;
  buildExpression?: (geometryColumn: string) => string;
}

export function resolveAttributeOutputColumn(table: Table, requestedName: string): string {
  return resolveTableColumnName(table, requestedName);
}

/** Shared scalar-attribute runner used by all attribute calculation tools. */
export async function runAttributeTool(
  dataset: MapshaperDataset,
  opts: AttributeRunnerOptions,
  operation: AttributeOperation,
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  const rt = requireRuntime(runtime);
  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const requestedOutputColumn = opts.outputColumn ?? `duckdb_${operation.id}`;
  const trimmedOutputColumn = requestedOutputColumn.trim();
  if (!trimmedOutputColumn) {
    throw new DuckDbOperationError('validation', 'DuckDB attribute output column is required', {
      field: 'outputColumn',
    });
  }

  const input = datasetToArrowInput(dataset, { layer: opts.layer, geometryColumn }, operation.id);
  const outputColumn = resolveAttributeOutputColumn(input, trimmedOutputColumn);

  return runPipeline({
    label: operation.id,
    runtime: rt,
    inputs: [{ table: input, prefix: 'emap_duckdb_attribute_input' }],
    buildSql: ([tableName]) =>
      buildAttributeSql({
        tableName: tableName!,
        geometryColumn,
        duckDbFunction: operation.duckDbFunction,
        buildExpression: operation.buildExpression,
        outputColumn,
      }),
    convertResult: (resultTable) =>
      arrowResultToDataset(resultTable, { layerName: opts.outputLayer }, dataset, operation.id),
  });
}

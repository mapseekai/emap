import type { Table } from 'apache-arrow';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { fromArrowTable } from '../../arrow/table-to-dataset';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import { inheritPrimaryDatasetCrs } from './dataset-crs';
import { DuckDbOperationError } from '../errors';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';

const tableNameSequences = new Map<string, number>();

export function nextDuckDbTableName(prefix: string): string {
  const next = (tableNameSequences.get(prefix) ?? 0) + 1;
  tableNameSequences.set(prefix, next);
  return `${prefix}_${next}`;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function tableFieldNames(table: Table): string[] {
  return table.schema.fields.map((field) => field.name);
}

export { resolveUniqueColumnName, resolveTableColumnName } from '../../arrow/dataset-to-table';

export interface DuckDbPipelineMessages {
  runtimeUnavailable: string;
  spatialUnavailable: string;
  inputConversion: string;
  queryFailed: string;
  resultConversion: string;
  cleanupFailed: string;
}

export function duckDbPipelineMessages(label: string): DuckDbPipelineMessages {
  return {
    runtimeUnavailable: 'DuckDB runtime is not available',
    spatialUnavailable: 'DuckDB spatial extension is unavailable',
    inputConversion: `DuckDB ${label} input could not be converted to Arrow`,
    queryFailed: `DuckDB ${label} query failed`,
    resultConversion: `DuckDB ${label} result could not be converted to a dataset`,
    cleanupFailed: `DuckDB ${label} cleanup failed`,
  };
}

export function requireDuckDbRuntime(
  runtime: DuckDbRuntime | null,
  messages?: Partial<DuckDbPipelineMessages>,
): DuckDbRuntime {
  if (!runtime) {
    throw new DuckDbOperationError(
      'runtime-unavailable',
      messages?.runtimeUnavailable ?? duckDbPipelineMessages('').runtimeUnavailable,
    );
  }
  return runtime;
}

export function datasetToArrowInput(
  dataset: MapshaperDataset,
  opts: { layer?: string | number; geometryColumn?: string },
  label: string,
): Table {
  try {
    return toArrowTable(dataset, {
      layer: opts.layer,
      encoding: 'wkb',
      geometryColumn: opts.geometryColumn ?? 'geometry',
    });
  } catch (err) {
    throw new DuckDbOperationError(
      'conversion-failed',
      duckDbPipelineMessages(label).inputConversion,
      { cause: err },
    );
  }
}

export function arrowResultToDataset(
  result: Table,
  opts: { layerName?: string; geometryColumn?: string },
  primaryDataset: MapshaperDataset,
  label: string,
): MapshaperDataset {
  try {
    const converted = fromArrowTable(result, {
      layerName: opts.layerName,
      geometryColumn: opts.geometryColumn,
    });
    return inheritPrimaryDatasetCrs(converted, primaryDataset);
  } catch (err) {
    throw new DuckDbOperationError(
      'conversion-failed',
      duckDbPipelineMessages(label).resultConversion,
      { cause: err },
    );
  }
}

export interface DuckDbPipelineInput {
  table: Table;
  prefix: string;
}

export async function runDuckDbPipeline<T>(operation: {
  label: string;
  runtime: DuckDbRuntime;
  requiresSpatial?: boolean;
  inputs: readonly DuckDbPipelineInput[];
  buildSql: (tableNames: readonly string[]) => string;
  convertResult?: (result: Table) => T;
  messages?: Partial<DuckDbPipelineMessages>;
}): Promise<T> {
  const messages = { ...duckDbPipelineMessages(operation.label), ...operation.messages };

  if (operation.requiresSpatial !== false) {
    try {
      await operation.runtime.ensureSpatial();
    } catch (err) {
      throw new DuckDbOperationError('spatial-extension-unavailable', messages.spatialUnavailable, {
        cause: err,
      });
    }
  }

  let conn: DuckDbConnection | undefined;
  const tableNames: string[] = [];
  let primaryError: unknown;
  try {
    conn = await operation.runtime.connect();
    for (const input of operation.inputs) {
      const name = nextDuckDbTableName(input.prefix);
      tableNames.push(name);
      await conn.insertArrowTable(input.table, { name });
    }
    const resultTable = await conn.query(operation.buildSql(tableNames));
    return operation.convertResult ? operation.convertResult(resultTable) : (resultTable as T);
  } catch (err) {
    if (err instanceof DuckDbOperationError) {
      primaryError = err;
      throw err;
    }
    const wrapped = new DuckDbOperationError('query-failed', messages.queryFailed, { cause: err });
    primaryError = wrapped;
    throw wrapped;
  } finally {
    let cleanupError: unknown;
    if (conn) {
      for (const name of tableNames) {
        try {
          await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`);
        } catch (err) {
          cleanupError ??= err;
        }
      }
    }
    try {
      await conn?.close?.();
    } catch (err) {
      cleanupError ??= err;
    }
    if (cleanupError && !primaryError) {
      throw new DuckDbOperationError('query-failed', messages.cleanupFailed, {
        cause: cleanupError,
      });
    }
  }
}

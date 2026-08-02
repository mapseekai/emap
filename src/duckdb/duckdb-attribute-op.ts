import type { Table } from 'apache-arrow';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { toArrowTable } from '../arrow/dataset-to-table';
import { fromArrowTable } from '../arrow/table-to-dataset';
import { DuckDbOperationError } from './duckdb-errors';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';
import { buildAttributeSql } from './duckdb-sql';
import { inheritPrimaryDatasetCrs } from './dataset-crs';

let duckDbAttributeInputTableSequence = 0;

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

function nextDuckDbAttributeInputTableName(): string {
  duckDbAttributeInputTableSequence += 1;
  return `emap_duckdb_attribute_input_${duckDbAttributeInputTableSequence}`;
}

export function resolveAttributeOutputColumn(table: Table, requestedName: string): string {
  const existing = new Set(table.schema.fields.map((field) => field.name));
  if (!existing.has(requestedName)) return requestedName;

  let suffix = 1;
  let candidate = `${requestedName}_${suffix}`;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${requestedName}_${suffix}`;
  }
  return candidate;
}

export async function processAttributeWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOptions,
  spec: DuckDbAttributeOperationSpec,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  if (!runtime) {
    throw new DuckDbOperationError('runtime-unavailable', 'DuckDB runtime is not available');
  }

  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const requestedOutputColumn = opts.outputColumn ?? `duckdb_${spec.id}`;
  const trimmedOutputColumn = requestedOutputColumn.trim();
  if (!trimmedOutputColumn) {
    throw new DuckDbOperationError('validation', 'DuckDB attribute output column is required', {
      field: 'outputColumn',
    });
  }

  let input: Table;
  try {
    input = toArrowTable(dataset, {
      layer: opts.layer,
      encoding: 'wkb',
      geometryColumn,
    });
  } catch (err) {
    throw new DuckDbOperationError(
      'conversion-failed',
      `DuckDB ${spec.id} input could not be converted to Arrow`,
      { cause: err },
    );
  }
  const outputColumn = resolveAttributeOutputColumn(input, trimmedOutputColumn);

  try {
    await runtime.ensureSpatial();
  } catch (err) {
    throw new DuckDbOperationError(
      'spatial-extension-unavailable',
      'DuckDB spatial extension is unavailable',
      { cause: err },
    );
  }

  let conn: Awaited<ReturnType<DuckDbRuntime['connect']>> | undefined;
  let inputTableName: string | undefined;
  let primaryError: unknown;
  try {
    conn = await runtime.connect();
    inputTableName = nextDuckDbAttributeInputTableName();
    await conn.insertArrowTable(input, { name: inputTableName });
    const resultTable = await conn.query(
      buildAttributeSql({
        tableName: inputTableName,
        geometryColumn,
        duckDbFunction: spec.duckDbFunction,
        buildExpression: spec.buildExpression,
        outputColumn,
      }),
    );

    try {
      const result = fromArrowTable(resultTable, { layerName: opts.outputLayer });
      return inheritPrimaryDatasetCrs(result, dataset);
    } catch (err) {
      throw new DuckDbOperationError(
        'conversion-failed',
        `DuckDB ${spec.id} result could not be converted to a dataset`,
        { cause: err },
      );
    }
  } catch (err) {
    if (err instanceof DuckDbOperationError) {
      primaryError = err;
      throw err;
    }
    const wrapped = new DuckDbOperationError('query-failed', `DuckDB ${spec.id} query failed`, {
      cause: err,
    });
    primaryError = wrapped;
    throw wrapped;
  } finally {
    let cleanupError: unknown;
    if (conn && inputTableName) {
      try {
        await conn.query(`DROP TABLE IF EXISTS ${inputTableName}`);
      } catch (err) {
        cleanupError = err;
      }
    }
    try {
      await conn?.close?.();
    } catch (err) {
      cleanupError ??= err;
    }
    if (cleanupError && !primaryError) {
      throw new DuckDbOperationError('query-failed', `DuckDB ${spec.id} cleanup failed`, {
        cause: cleanupError,
      });
    }
  }
}

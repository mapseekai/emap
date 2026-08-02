import type { Table } from 'apache-arrow';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { toArrowTable } from '../arrow/dataset-to-table';
import { fromArrowTable } from '../arrow/table-to-dataset';
import { DuckDbOperationError } from './duckdb-errors';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';
import { buildUnaryGeometrySql } from './duckdb-sql';
import { inheritPrimaryDatasetCrs } from './dataset-crs';

let duckDbGeometryInputTableSequence = 0;

export interface DuckDbUnaryGeometryOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
}

export interface DuckDbGeometryOperationSpec {
  id: string;
  duckDbFunction: string;
  args?: readonly number[];
}

function nextDuckDbGeometryInputTableName(): string {
  duckDbGeometryInputTableSequence += 1;
  return `emap_duckdb_geometry_input_${duckDbGeometryInputTableSequence}`;
}

export async function processGeometryWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions,
  spec: DuckDbGeometryOperationSpec,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  if (!runtime) {
    throw new DuckDbOperationError('runtime-unavailable', 'DuckDB runtime is not available');
  }

  const geometryColumn = opts.geometryColumn ?? 'geometry';
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
    inputTableName = nextDuckDbGeometryInputTableName();
    await conn.insertArrowTable(input, { name: inputTableName });

    let resultTable: typeof input;
    try {
      resultTable = await conn.query(
        buildUnaryGeometrySql({
          tableName: inputTableName,
          geometryColumn,
          duckDbFunction: spec.duckDbFunction,
          args: spec.args,
        }),
      );
    } catch (err) {
      throw new DuckDbOperationError('query-failed', `DuckDB ${spec.id} query failed`, {
        cause: err,
      });
    }

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

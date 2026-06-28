import type { Table } from 'apache-arrow';
import { detectGeometryColumn } from '../formats/geometry-column';
import { fromArrowTable, type FromArrowTableOptions } from '../formats/table-to-dataset';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';
import { validateDuckDbSelectSql } from './duckdb-query-sql';

export interface DuckDbGeoParquetQueryOptions extends FromArrowTableOptions {
  sql: string;
}

let duckDbGeoParquetQuerySequence = 0;

function nextDuckDbGeoParquetQueryNames(): { fileName: string; viewName: string } {
  duckDbGeoParquetQuerySequence += 1;
  return {
    fileName: `emap_duckdb_geoparquet_${duckDbGeoParquetQuerySequence}.parquet`,
    viewName: `emap_duckdb_geoparquet_input_${duckDbGeoParquetQuerySequence}`,
  };
}

function normalizeBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function quoteIdentifier(id: string): string {
  return `"${id.replaceAll('"', '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function tableFieldNames(table: Table): string[] {
  return table.schema.fields.map((field) => field.name);
}

export async function queryGeoParquetWithDuckDb(
  data: Uint8Array | ArrayBuffer,
  opts: DuckDbGeoParquetQueryOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  if (!runtime) {
    throw new DuckDbOperationError('runtime-unavailable', 'DuckDB runtime is not available');
  }
  if (typeof runtime.registerFileBuffer !== 'function') {
    throw new DuckDbOperationError(
      'runtime-unavailable',
      'DuckDB runtime does not support GeoParquet file registration',
    );
  }

  const bytes = normalizeBytes(data);
  const { fileName, viewName } = nextDuckDbGeoParquetQueryNames();
  let conn: Awaited<ReturnType<DuckDbRuntime['connect']>> | undefined;
  let primaryError: unknown;

  try {
    await runtime.registerFileBuffer(fileName, bytes);
    conn = await runtime.connect();
    await conn.query(
      `CREATE VIEW ${quoteIdentifier(viewName)} AS SELECT * FROM read_parquet(${quoteSqlString(
        fileName,
      )})`,
    );

    const schemaTable = await conn.query(`SELECT * FROM ${quoteIdentifier(viewName)} LIMIT 0`);
    const validated = validateDuckDbSelectSql(opts.sql, {
      allowGeometryProjection: true,
      availableColumns: tableFieldNames(schemaTable),
      geometryColumn: opts.geometryColumn,
      physicalTableName: viewName,
      rowIdColumn: null,
    });

    const resultTable = await conn.query(validated.sql);
    let geometryColumn: string;

    try {
      const geom = detectGeometryColumn(resultTable, opts.geometryColumn);
      if (!geom) throw new Error('DuckDB GeoParquet query result is missing a geometry column');
      geometryColumn = geom.name;
    } catch (err) {
      throw new DuckDbOperationError(
        'conversion-failed',
        'DuckDB GeoParquet query result could not be converted to a dataset',
        { cause: err },
      );
    }

    try {
      return fromArrowTable(resultTable, {
        geometryColumn,
        layerName: opts.layerName,
        noTopology: opts.noTopology,
      });
    } catch (err) {
      throw new DuckDbOperationError(
        'conversion-failed',
        'DuckDB GeoParquet query result could not be converted to a dataset',
        { cause: err },
      );
    }
  } catch (err) {
    if (err instanceof DuckDbOperationError) {
      primaryError = err;
      throw err;
    }
    const wrapped = new DuckDbOperationError('query-failed', 'DuckDB GeoParquet query failed', {
      cause: err,
    });
    primaryError = wrapped;
    throw wrapped;
  } finally {
    let cleanupError: unknown;
    if (conn) {
      try {
        await conn.query(`DROP VIEW IF EXISTS ${quoteIdentifier(viewName)}`);
      } catch (err) {
        cleanupError = err;
      }
    }

    try {
      await conn?.close?.();
    } catch (err) {
      cleanupError ??= err;
    }

    try {
      await runtime.dropFile?.(fileName);
    } catch (err) {
      cleanupError ??= err;
    }

    if (cleanupError && !primaryError) {
      throw new DuckDbOperationError('query-failed', 'DuckDB GeoParquet query cleanup failed', {
        cause: cleanupError,
      });
    }
  }
}

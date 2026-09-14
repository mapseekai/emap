import type { Table } from 'apache-arrow';
import { detectGeometryColumn } from '../../arrow/geometry-column';
import { fromArrowTable, type FromArrowTableOptions } from '../../arrow/table-to-dataset';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import { quoteIdentifier, tableFieldNames } from '../core/pipeline';
import { validateDuckDbSelectSql } from '../core/query-sql';
import { quoteSqlString, type DuckDbRuntime } from '../runtime';

export interface DuckDbGeoParquetQueryOptions extends FromArrowTableOptions {
  sql: string;
}

export interface DuckDbGeoParquetQuerySource {
  query(opts: DuckDbGeoParquetQueryOptions): Promise<MapshaperDataset>;
  close(): Promise<void>;
}

let querySequence = 0;

function nextQueryNames(): { fileName: string; viewName: string } {
  querySequence += 1;
  return {
    fileName: `emap_duckdb_geoparquet_${querySequence}.parquet`,
    viewName: `emap_duckdb_geoparquet_input_${querySequence}`,
  };
}

function normalizeBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

async function cleanupGeoParquetQuerySource(
  runtime: DuckDbRuntime,
  conn: Awaited<ReturnType<DuckDbRuntime['connect']>> | undefined,
  fileName: string,
  viewName: string,
  primaryError?: unknown,
): Promise<void> {
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

async function queryGeoParquetView(
  conn: Awaited<ReturnType<DuckDbRuntime['connect']>>,
  viewName: string,
  availableColumns: readonly string[],
  opts: DuckDbGeoParquetQueryOptions,
): Promise<MapshaperDataset> {
  let resultTable: Table;
  try {
    const validated = validateDuckDbSelectSql(opts.sql, {
      allowGeometryProjection: true,
      availableColumns,
      geometryColumn: opts.geometryColumn,
      physicalTableName: viewName,
      rowIdColumn: null,
    });
    resultTable = await conn.query(validated.sql);
  } catch (err) {
    if (err instanceof DuckDbOperationError) throw err;
    throw new DuckDbOperationError('query-failed', 'DuckDB GeoParquet query failed', {
      cause: err,
    });
  }

  let geometryColumn: string;
  try {
    const geometry = detectGeometryColumn(resultTable, opts.geometryColumn);
    if (!geometry) throw new Error('DuckDB GeoParquet query result is missing a geometry column');
    geometryColumn = geometry.name;
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
}

export async function createDuckDbGeoParquetQuerySource(
  data: Uint8Array | ArrayBuffer,
  runtime: DuckDbRuntime | null = null,
): Promise<DuckDbGeoParquetQuerySource> {
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
  const { fileName, viewName } = nextQueryNames();
  let conn: Awaited<ReturnType<DuckDbRuntime['connect']>> | undefined;
  let closed = false;

  try {
    await runtime.registerFileBuffer(fileName, bytes);
    conn = await runtime.connect();
    await conn.query(
      `CREATE VIEW ${quoteIdentifier(viewName)} AS SELECT * FROM read_parquet(${quoteSqlString(
        fileName,
      )})`,
    );

    const schemaTable = await conn.query(`SELECT * FROM ${quoteIdentifier(viewName)} LIMIT 0`);
    const availableColumns = tableFieldNames(schemaTable);

    return {
      async query(opts): Promise<MapshaperDataset> {
        if (closed) {
          throw new DuckDbOperationError(
            'runtime-unavailable',
            'DuckDB GeoParquet query source is closed',
          );
        }
        return queryGeoParquetView(conn!, viewName, availableColumns, opts);
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await cleanupGeoParquetQuerySource(runtime, conn, fileName, viewName);
      },
    };
  } catch (err) {
    const primaryError =
      err instanceof DuckDbOperationError
        ? err
        : new DuckDbOperationError('query-failed', 'DuckDB GeoParquet query failed', {
            cause: err,
          });
    await cleanupGeoParquetQuerySource(runtime, conn, fileName, viewName, primaryError);
    throw primaryError;
  }
}

export async function queryGeoParquetWithDuckDb(
  data: Uint8Array | ArrayBuffer,
  opts: DuckDbGeoParquetQueryOptions,
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  let source: DuckDbGeoParquetQuerySource | undefined;
  let primaryError: unknown;

  try {
    source = await createDuckDbGeoParquetQuerySource(data, runtime);
    return await source.query(opts);
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
    if (source) {
      try {
        await source.close();
      } catch (err) {
        if (!primaryError) throw err;
      }
    }
  }
}

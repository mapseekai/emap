import type { MapshaperDataset } from '../types/mapshaper-types';
import { toArrowTable } from '../formats/dataset-to-table';
import { fromArrowTable } from '../formats/table-to-dataset';
import { isGeographicCrs } from '../geo/crs-resolver';
import { DuckDbOperationError } from './duckdb-errors';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';
import { buildBufferSql } from './duckdb-sql';

let duckDbBufferInputTableSequence = 0;

export interface DuckDbBufferOptions {
  layer?: string | number;
  distance: number;
  outputLayer?: string;
  geometryColumn?: string;
  failOnGeographicCrs?: boolean;
}

export interface NormalizedDuckDbBufferOptions {
  layer?: string | number;
  distance: number;
  outputLayer?: string;
  geometryColumn: string;
  failOnGeographicCrs: boolean;
}

function nextDuckDbBufferInputTableName(): string {
  duckDbBufferInputTableSequence += 1;
  return `emap_duckdb_buffer_input_${duckDbBufferInputTableSequence}`;
}

export function normalizeDuckDbBufferOptions(
  dataset: MapshaperDataset,
  opts: DuckDbBufferOptions,
): NormalizedDuckDbBufferOptions {
  if (!Number.isFinite(opts.distance) || opts.distance <= 0) {
    throw new DuckDbOperationError(
      'validation',
      'DuckDB buffer distance must be a finite number greater than zero',
      {
        field: 'distance',
      },
    );
  }

  const failOnGeographicCrs = opts.failOnGeographicCrs ?? true;
  if (failOnGeographicCrs && isGeographicCrs(dataset)) {
    throw new DuckDbOperationError(
      'validation',
      'DuckDB buffer uses coordinate units; reproject to a projected CRS before buffering.',
      { field: 'crs' },
    );
  }

  return {
    layer: opts.layer,
    distance: opts.distance,
    outputLayer: opts.outputLayer,
    geometryColumn: opts.geometryColumn ?? 'geometry',
    failOnGeographicCrs,
  };
}

export async function bufferDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbBufferOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const normalized = normalizeDuckDbBufferOptions(dataset, opts);
  if (!runtime) {
    throw new DuckDbOperationError('runtime-unavailable', 'DuckDB runtime is not available');
  }

  let conn: Awaited<ReturnType<DuckDbRuntime['connect']>> | null = null;
  let inputTableName: string | null = null;
  try {
    const input = toArrowTable(dataset, {
      layer: normalized.layer,
      encoding: 'wkb',
      geometryColumn: normalized.geometryColumn,
    });

    try {
      await runtime.ensureSpatial();
    } catch (err) {
      throw new DuckDbOperationError(
        'spatial-extension-unavailable',
        'DuckDB spatial extension is unavailable',
        {
          cause: err,
        },
      );
    }

    conn = await runtime.connect();
    inputTableName = nextDuckDbBufferInputTableName();
    await conn.insertArrowTable(input, { name: inputTableName });

    let resultTable: typeof input;
    try {
      resultTable = await conn.query(
        buildBufferSql({
          tableName: inputTableName,
          geometryColumn: normalized.geometryColumn,
          distance: normalized.distance,
        }),
      );
    } catch (err) {
      throw new DuckDbOperationError('query-failed', 'DuckDB buffer query failed', { cause: err });
    }

    try {
      const result = fromArrowTable(resultTable, { layerName: normalized.outputLayer });
      if (dataset.info?.crs_string) {
        result.info = { ...result.info, crs_string: dataset.info.crs_string };
      }
      return result;
    } catch (err) {
      throw new DuckDbOperationError(
        'conversion-failed',
        'DuckDB buffer result could not be converted to a dataset',
        {
          cause: err,
        },
      );
    }
  } finally {
    if (conn && inputTableName) {
      await conn.query(`DROP TABLE IF EXISTS ${inputTableName}`).catch(() => undefined);
    }
    await conn?.close?.();
  }
}

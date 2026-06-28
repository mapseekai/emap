import type { Table } from 'apache-arrow';
import { toArrowTable } from '../formats/dataset-to-table';
import { fromArrowTable } from '../formats/table-to-dataset';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';
import { buildOverlaySql, type OverlayDuckDbFunction } from './duckdb-sql';

export interface DuckDbOverlayOptions {
  inputLayer?: string | number;
  maskLayer?: string | number;
  outputLayer?: string;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
}

export interface DuckDbOverlayOperationSpec {
  id: string;
  duckDbFunction: OverlayDuckDbFunction;
}

let duckDbOverlayInputTableSequence = 0;
let duckDbOverlayMaskTableSequence = 0;

function nextDuckDbOverlayInputTableName(): string {
  duckDbOverlayInputTableSequence += 1;
  return `emap_duckdb_overlay_input_${duckDbOverlayInputTableSequence}`;
}

function nextDuckDbOverlayMaskTableName(): string {
  duckDbOverlayMaskTableSequence += 1;
  return `emap_duckdb_overlay_mask_${duckDbOverlayMaskTableSequence}`;
}

function quoteIdentifier(id: string): string {
  return `"${id.replaceAll('"', '""')}"`;
}

export async function processOverlayWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayOptions,
  spec: DuckDbOverlayOperationSpec,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  if (!runtime) {
    throw new DuckDbOperationError('runtime-unavailable', 'DuckDB runtime is not available');
  }

  const inputGeometryColumn = opts.inputGeometryColumn ?? 'geometry';
  const maskGeometryColumn = opts.maskGeometryColumn ?? 'geometry';

  let input: Table;
  let mask: Table;
  try {
    input = toArrowTable(inputDataset, {
      layer: opts.inputLayer,
      encoding: 'wkb',
      geometryColumn: inputGeometryColumn,
    });
    mask = toArrowTable(maskDataset, {
      layer: opts.maskLayer,
      encoding: 'wkb',
      geometryColumn: maskGeometryColumn,
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
  let maskTableName: string | undefined;
  let primaryError: unknown;

  try {
    conn = await runtime.connect();
    inputTableName = nextDuckDbOverlayInputTableName();
    maskTableName = nextDuckDbOverlayMaskTableName();

    await conn.insertArrowTable(input, { name: inputTableName });
    await conn.insertArrowTable(mask, { name: maskTableName });

    const resultTable = await conn.query(
      buildOverlaySql({
        duckDbFunction: spec.duckDbFunction,
        inputGeometryColumn,
        inputTableName,
        maskGeometryColumn,
        maskTableName,
      }),
    );

    try {
      const result = fromArrowTable(resultTable, {
        layerName: opts.outputLayer,
        geometryColumn: inputGeometryColumn,
      });
      if (inputDataset.info?.crs_string) {
        result.info = {
          ...result.info,
          crs_string: inputDataset.info.crs_string,
        };
      }
      return result;
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
        await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(inputTableName)}`);
      } catch (err) {
        cleanupError = err;
      }
    }

    if (conn && maskTableName) {
      try {
        await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(maskTableName)}`);
      } catch (err) {
        cleanupError ??= err;
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

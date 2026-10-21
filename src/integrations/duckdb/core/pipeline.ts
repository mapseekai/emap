import type { Table } from 'apache-arrow';
import { resolveLayerInList } from '../../../engine/map/layer-registry';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { fromArrowTable } from '../../arrow/table-to-dataset';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { inheritPrimaryDatasetCrs } from './dataset-crs';
import { DuckDbOperationError } from '../errors';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';

const tableNameSequences = new Map<string, number>();

export function nextTableName(prefix: string): string {
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

export interface PipelineMessages {
  runtimeUnavailable: string;
  spatialUnavailable: string;
  inputConversion: string;
  queryFailed: string;
  resultConversion: string;
  cleanupFailed: string;
}

export function pipelineMessages(label: string): PipelineMessages {
  return {
    runtimeUnavailable: 'DuckDB runtime is not available',
    spatialUnavailable: 'DuckDB spatial extension is unavailable',
    inputConversion: `DuckDB ${label} input could not be converted to Arrow`,
    queryFailed: `DuckDB ${label} query failed`,
    resultConversion: `DuckDB ${label} result could not be converted to a dataset`,
    cleanupFailed: `DuckDB ${label} cleanup failed`,
  };
}

export function requireRuntime(
  runtime: DuckDbRuntime | null,
  messages?: Partial<PipelineMessages>,
): DuckDbRuntime {
  if (!runtime) {
    throw new DuckDbOperationError(
      'runtime-unavailable',
      messages?.runtimeUnavailable ?? pipelineMessages('').runtimeUnavailable,
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
    throw new DuckDbOperationError('conversion-failed', pipelineMessages(label).inputConversion, {
      cause: err,
    });
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
    throw new DuckDbOperationError('conversion-failed', pipelineMessages(label).resultConversion, {
      cause: err,
    });
  }
}

/** Restore the known input type only when a geometry-preserving result has no typed geometry. */
export function preserveEmptyGeometryType(
  result: MapshaperDataset,
  input: MapshaperDataset,
  opts: { layer?: string | number; outputLayer?: string },
): MapshaperDataset {
  const inputLayer =
    typeof opts.layer === 'string'
      ? resolveLayerInList(input.layers, opts.layer)
      : input.layers[opts.layer ?? 0];
  if (!inputLayer?.geometry_type) return result;
  if (result.layers.length === 0) {
    result.layers.push({ name: opts.outputLayer ?? 'layer', shapes: [] });
  }
  for (const layer of result.layers) {
    if (!layer.geometry_type) {
      layer.geometry_type = inputLayer.geometry_type;
      layer.shapes = new Array(layer.data?.getRecords?.().length ?? 0).fill(null);
    }
  }
  return result;
}

export interface PipelineInput {
  table: Table;
  prefix: string;
}

export async function runPipeline<T>(operation: {
  label: string;
  runtime: DuckDbRuntime;
  signal?: AbortSignal;
  requiresSpatial?: boolean;
  inputs: readonly PipelineInput[];
  buildSql: (tableNames: readonly string[]) => string;
  convertResult?: (result: Table) => T;
  messages?: Partial<PipelineMessages>;
}): Promise<T> {
  const { signal } = operation;
  signal?.throwIfAborted();
  const messages = { ...pipelineMessages(operation.label), ...operation.messages };

  if (operation.requiresSpatial !== false) {
    try {
      await operation.runtime.ensureSpatial();
    } catch (err) {
      signal?.throwIfAborted();
      throw new DuckDbOperationError('spatial-extension-unavailable', messages.spatialUnavailable, {
        cause: err,
      });
    }
  }

  let conn: DuckDbConnection | undefined;
  const tableNames: string[] = [];
  let primaryError: unknown;
  let failed = false;
  try {
    signal?.throwIfAborted();
    conn = await operation.runtime.connect();
    signal?.throwIfAborted();
    for (const input of operation.inputs) {
      signal?.throwIfAborted();
      const name = nextTableName(input.prefix);
      tableNames.push(name);
      await conn.insertArrowTable(input.table, { name });
    }
    signal?.throwIfAborted();
    const sql = operation.buildSql(tableNames);
    signal?.throwIfAborted();
    const resultTable = await conn.query(sql, signal);
    signal?.throwIfAborted();
    const result = operation.convertResult
      ? operation.convertResult(resultTable)
      : (resultTable as T);
    signal?.throwIfAborted();
    return result;
  } catch (err) {
    failed = true;
    if (signal?.aborted) {
      primaryError = err instanceof AggregateError ? err : signal.reason;
      throw primaryError;
    }
    if (err instanceof DuckDbOperationError) {
      primaryError = err;
      throw err;
    }
    const wrapped = new DuckDbOperationError('query-failed', messages.queryFailed, { cause: err });
    primaryError = wrapped;
    throw wrapped;
  } finally {
    const cleanupErrors: unknown[] = [];
    if (conn) {
      for (const name of tableNames) {
        try {
          await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`);
        } catch (err) {
          cleanupErrors.push(err);
        }
      }
    }
    try {
      await conn?.close?.();
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length && signal?.aborted && failed) {
      throw new AggregateError([primaryError, ...cleanupErrors], messages.cleanupFailed);
    }
    if (cleanupErrors.length && !failed) {
      throw new DuckDbOperationError('query-failed', messages.cleanupFailed, {
        cause: cleanupErrors[0],
      });
    }
    if (!failed) signal?.throwIfAborted();
  }
}

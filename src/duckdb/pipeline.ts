// pipeline — shared execution skeleton for DuckDB-backed ops.
//
// Every DuckDB op runs the same stages: runtime guard → dataset→Arrow
// (WKB) conversion → ensureSpatial → connect → insert input table(s) →
// run one SQL statement → convert the Arrow result back → per-table DROP
// + connection close with primary-error-wins semantics. Only the SQL and
// the result conversion vary per op; this module owns the skeleton once.
//
// Error contracts are load-bearing: `duckDbPipelineMessages(label)`
// reproduces the exact `DuckDB ${label} …` strings the hand-written
// bodies threw, so existing tests pass unmodified (label = spec.id, e.g.
// 'area', 'intersection').
//
// Deliberate unification: DROP statements quote generated table names via
// {@link quoteIdentifier}. Semantically identical for `emap_duckdb_*`
// names; two test files assert the quoted form.

import type { Table } from 'apache-arrow';
import { toArrowTable } from '../arrow/dataset-to-table';
import { fromArrowTable } from '../arrow/table-to-dataset';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { inheritPrimaryDatasetCrs } from './dataset-crs';
import { DuckDbOperationError } from './errors';
import type { DuckDbConnection, DuckDbRuntime } from './runtime';

// -- Table-name sequences ---------------------------------------------------
// Per-prefix monotonic counters; one Map replaces the per-module `let seq`
// pairs. Names keep the `emap_duckdb_<role>_<n>` shape tests observe.

const tableNameSequences = new Map<string, number>();

export function nextDuckDbTableName(prefix: string): string {
  const next = (tableNameSequences.get(prefix) ?? 0) + 1;
  tableNameSequences.set(prefix, next);
  return `${prefix}_${next}`;
}

// -- SQL identifier quoting -------------------------------------------------

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// -- Unique output-column names ---------------------------------------------

export function resolveUniqueColumnName(
  requested: string,
  existing: ReadonlySet<string>,
): string {
  if (!existing.has(requested)) return requested;
  let suffix = 1;
  let candidate = `${requested}_${suffix}`;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${requested}_${suffix}`;
  }
  return candidate;
}

export function resolveTableColumnName(table: Table, requested: string): string {
  return resolveUniqueColumnName(
    requested,
    new Set(table.schema.fields.map((field) => field.name)),
  );
}

// -- Error-message templates ------------------------------------------------

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

// -- Individual stages ------------------------------------------------------

/**
 * Runtime guard, kept as a separate step so callers preserve today's
 * ordering: runtime check → input conversion → ensureSpatial.
 */
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

/** dataset → WKB Arrow input with the uniform 'conversion-failed' wrap. */
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

/** Arrow result → dataset with 'conversion-failed' wrap + CRS inherit. */
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

// -- Pipeline ---------------------------------------------------------------

export interface DuckDbPipelineInput {
  table: Table;
  /** Table-name prefix; the generated name is `<prefix>_<n>`. */
  prefix: string;
}

/**
 * Owns: ensureSpatial → connect → name-gen → insert → query →
 * convertResult → primaryError-aware catch → per-table DROP + close
 * finally. Semantics preserved from the hand-written bodies:
 * non-DuckDbOperationError from query/convert is wrapped as 'query-failed'
 * with `cause`; a primary error suppresses cleanup errors; a cleanup
 * failure with no primary error throws 'query-failed' cleanup.
 */
export async function runDuckDbPipeline<T>(spec: {
  /** Message label — the op's spec.id ('area', 'intersection', …). */
  label: string;
  /** Already non-null via {@link requireDuckDbRuntime}. */
  runtime: DuckDbRuntime;
  /** Default true; query-only ops pass false. */
  requiresSpatial?: boolean;
  inputs: readonly DuckDbPipelineInput[];
  buildSql: (tableNames: readonly string[]) => string;
  /** Default: identity (T = Table). */
  convertResult?: (result: Table) => T;
  messages?: Partial<DuckDbPipelineMessages>;
}): Promise<T> {
  const messages = { ...duckDbPipelineMessages(spec.label), ...spec.messages };

  if (spec.requiresSpatial !== false) {
    try {
      await spec.runtime.ensureSpatial();
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
    conn = await spec.runtime.connect();
    for (const input of spec.inputs) {
      // Reserve the name BEFORE the insert: the finally block must attempt
      // DROP IF EXISTS even when this insert fails (matches the
      // hand-written bodies, which assigned the name before inserting).
      const name = nextDuckDbTableName(input.prefix);
      tableNames.push(name);
      await conn.insertArrowTable(input.table, { name });
    }
    const resultTable = await conn.query(spec.buildSql(tableNames));
    return spec.convertResult ? spec.convertResult(resultTable) : (resultTable as T);
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

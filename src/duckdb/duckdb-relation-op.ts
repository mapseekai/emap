import type { Field, Table } from 'apache-arrow';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { toArrowTable } from '../formats/dataset-to-table';
import { fromArrowTable } from '../formats/table-to-dataset';
import { DuckDbOperationError } from './duckdb-errors';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';
import {
  buildRelationAttributeSql,
  buildRelationFilterSql,
  type RelationDuckDbFunction,
} from './duckdb-sql';

let duckDbRelationInputTableSequence = 0;
let duckDbRelationMaskTableSequence = 0;

export type DuckDbRelationMode = 'filter' | 'attribute';
export type DuckDbRelationOutputKind = 'predicate' | 'distance';

interface DuckDbRelationOperationBaseSpec {
  id: string;
}

export interface DuckDbRelationFilterPredicateOperationSpec
  extends DuckDbRelationOperationBaseSpec {
  mode: 'filter';
  duckDbFunction: RelationDuckDbFunction;
}

export interface DuckDbRelationFilterDistanceWithinOperationSpec
  extends DuckDbRelationOperationBaseSpec {
  mode: 'filter';
  duckDbFunction: 'ST_Distance';
  distance: number;
}

export interface DuckDbRelationAttributePredicateOperationSpec
  extends DuckDbRelationOperationBaseSpec {
  mode: 'attribute';
  duckDbFunction: RelationDuckDbFunction;
  output?: 'predicate';
  outputColumn?: string;
}

export interface DuckDbRelationAttributeDistanceOperationSpec
  extends DuckDbRelationOperationBaseSpec {
  mode: 'attribute';
  duckDbFunction: 'ST_Distance';
  output: 'distance';
  outputColumn?: string;
}

export interface DuckDbRelationAttributeDistanceWithinOperationSpec
  extends DuckDbRelationOperationBaseSpec {
  mode: 'attribute';
  duckDbFunction: 'ST_Distance';
  output?: 'predicate';
  outputColumn?: string;
  distance: number;
}

export type DuckDbRelationOperationSpec =
  | DuckDbRelationFilterPredicateOperationSpec
  | DuckDbRelationFilterDistanceWithinOperationSpec
  | DuckDbRelationAttributePredicateOperationSpec
  | DuckDbRelationAttributeDistanceOperationSpec
  | DuckDbRelationAttributeDistanceWithinOperationSpec;

export interface DuckDbRelationOptions {
  inputLayer?: string | number;
  maskLayer?: string | number;
  outputLayer?: string;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
  outputColumn?: string;
}

function nextDuckDbRelationInputTableName(): string {
  duckDbRelationInputTableSequence += 1;
  return `emap_duckdb_relation_input_${duckDbRelationInputTableSequence}`;
}

function nextDuckDbRelationMaskTableName(): string {
  duckDbRelationMaskTableSequence += 1;
  return `emap_duckdb_relation_mask_${duckDbRelationMaskTableSequence}`;
}

export function resolveRelationOutputColumn(table: Table, requestedName: string): string {
  const existing = new Set(table.schema.fields.map((field: Field) => field.name));
  if (!existing.has(requestedName)) return requestedName;

  let suffix = 1;
  let candidate = `${requestedName}_${suffix}`;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${requestedName}_${suffix}`;
  }
  return candidate;
}

function relationOutputColumn(
  input: Table,
  opts: DuckDbRelationOptions,
  spec: DuckDbRelationOperationSpec,
): string | undefined {
  if (spec.mode !== 'attribute') return undefined;

  const requestedOutputColumn = opts.outputColumn ?? spec.outputColumn ?? `duckdb_${spec.id}`;
  const trimmedOutputColumn = requestedOutputColumn.trim();
  if (!trimmedOutputColumn) {
    throw new DuckDbOperationError('validation', 'DuckDB relation output column is required', {
      field: 'outputColumn',
    });
  }

  return resolveRelationOutputColumn(input, trimmedOutputColumn);
}

export async function processRelationWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationOptions,
  spec: DuckDbRelationOperationSpec,
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

  const outputColumn = relationOutputColumn(input, opts, spec);

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
    inputTableName = nextDuckDbRelationInputTableName();
    maskTableName = nextDuckDbRelationMaskTableName();

    await conn.insertArrowTable(input, { name: inputTableName });
    await conn.insertArrowTable(mask, { name: maskTableName });

    const baseSqlOptions = {
      inputTableName,
      maskTableName,
      inputGeometryColumn,
      maskGeometryColumn,
    };

    const resultTable = await conn.query(
      spec.mode === 'filter'
        ? 'distance' in spec
          ? buildRelationFilterSql({
              ...baseSqlOptions,
              duckDbFunction: 'ST_Distance',
              distance: spec.distance,
            })
          : buildRelationFilterSql({
              ...baseSqlOptions,
              duckDbFunction: spec.duckDbFunction,
            })
        : spec.output === 'distance'
          ? buildRelationAttributeSql({
              ...baseSqlOptions,
              duckDbFunction: 'ST_Distance',
              output: 'distance',
              outputColumn: outputColumn!,
            })
          : 'distance' in spec
            ? buildRelationAttributeSql({
                ...baseSqlOptions,
                duckDbFunction: 'ST_Distance',
                distance: spec.distance,
                outputColumn: outputColumn!,
              })
            : buildRelationAttributeSql({
                ...baseSqlOptions,
                duckDbFunction: spec.duckDbFunction,
                outputColumn: outputColumn!,
              }),
    );

    try {
      const result = fromArrowTable(resultTable, {
        layerName: opts.outputLayer,
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
        await conn.query(`DROP TABLE IF EXISTS ${inputTableName}`);
      } catch (err) {
        cleanupError = err;
      }
    }

    if (conn && maskTableName) {
      try {
        await conn.query(`DROP TABLE IF EXISTS ${maskTableName}`);
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

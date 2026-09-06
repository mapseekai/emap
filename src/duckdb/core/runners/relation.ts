import type { Table } from 'apache-arrow';
import type { MapshaperDataset } from '../../../types/mapshaper-types';
import { alignSecondaryDatasetCrs } from '../dataset-crs';
import { DuckDbOperationError } from '../../errors';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  duckDbPipelineMessages,
  requireDuckDbRuntime,
  resolveTableColumnName,
  runDuckDbPipeline,
} from '../pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../../runtime';
import {
  buildRelationAttributeSql,
  buildRelationFilterSql,
  type RelationDuckDbFunction,
} from '../sql/relation';

export type DuckDbRelationMode = 'filter' | 'attribute';
export type DuckDbRelationOutputKind = 'predicate' | 'distance';

interface DuckDbRelationOperationBase {
  id: string;
}

export interface DuckDbRelationFilterPredicateOperation extends DuckDbRelationOperationBase {
  mode: 'filter';
  duckDbFunction: RelationDuckDbFunction;
}

export interface DuckDbRelationFilterDistanceWithinOperation extends DuckDbRelationOperationBase {
  mode: 'filter';
  duckDbFunction: 'ST_Distance';
  distance: number;
}

export interface DuckDbRelationAttributePredicateOperation extends DuckDbRelationOperationBase {
  mode: 'attribute';
  duckDbFunction: RelationDuckDbFunction;
  output?: 'predicate';
  outputColumn?: string;
}

export interface DuckDbRelationAttributeDistanceOperation extends DuckDbRelationOperationBase {
  mode: 'attribute';
  duckDbFunction: 'ST_Distance';
  output: 'distance';
  outputColumn?: string;
}

export interface DuckDbRelationAttributeDistanceWithinOperation
  extends DuckDbRelationOperationBase {
  mode: 'attribute';
  duckDbFunction: 'ST_Distance';
  output?: 'predicate';
  outputColumn?: string;
  distance: number;
}

export type DuckDbRelationOperation =
  | DuckDbRelationFilterPredicateOperation
  | DuckDbRelationFilterDistanceWithinOperation
  | DuckDbRelationAttributePredicateOperation
  | DuckDbRelationAttributeDistanceOperation
  | DuckDbRelationAttributeDistanceWithinOperation;

export interface DuckDbRelationOptions {
  inputLayer?: string | number;
  maskLayer?: string | number;
  outputLayer?: string;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
  outputColumn?: string;
}

export function resolveRelationOutputColumn(table: Table, requestedName: string): string {
  return resolveTableColumnName(table, requestedName);
}

function relationOutputColumn(
  opts: DuckDbRelationOptions,
  operation: DuckDbRelationOperation,
): string | undefined {
  if (operation.mode !== 'attribute') return undefined;
  const requestedOutputColumn =
    opts.outputColumn ?? operation.outputColumn ?? `duckdb_${operation.id}`;
  const trimmedOutputColumn = requestedOutputColumn.trim();
  if (!trimmedOutputColumn) {
    throw new DuckDbOperationError('validation', 'DuckDB relation output column is required', {
      field: 'outputColumn',
    });
  }
  return trimmedOutputColumn;
}

/** Shared binary-relation runner for spatial filter, relation attributes and distance tools. */
export async function runRelationTool(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationOptions,
  operation: DuckDbRelationOperation,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const rt = requireDuckDbRuntime(runtime);
  const inputGeometryColumn = opts.inputGeometryColumn ?? 'geometry';
  const maskGeometryColumn = opts.maskGeometryColumn ?? 'geometry';
  const requestedOutputColumn = relationOutputColumn(opts, operation);
  const input = datasetToArrowInput(
    inputDataset,
    { layer: opts.inputLayer, geometryColumn: inputGeometryColumn },
    operation.id,
  );
  const outputColumn =
    requestedOutputColumn === undefined
      ? undefined
      : resolveRelationOutputColumn(input, requestedOutputColumn);

  let alignedMaskDataset: MapshaperDataset;
  try {
    alignedMaskDataset = await alignSecondaryDatasetCrs(inputDataset, maskDataset);
  } catch (err) {
    throw new DuckDbOperationError(
      'conversion-failed',
      duckDbPipelineMessages(operation.id).inputConversion,
      { cause: err },
    );
  }
  const mask = datasetToArrowInput(
    alignedMaskDataset,
    { layer: opts.maskLayer, geometryColumn: maskGeometryColumn },
    operation.id,
  );

  return runDuckDbPipeline({
    label: operation.id,
    runtime: rt,
    inputs: [
      { table: input, prefix: 'emap_duckdb_relation_input' },
      { table: mask, prefix: 'emap_duckdb_relation_mask' },
    ],
    buildSql: ([inputTableName, maskTableName]) => {
      const baseSqlOptions = {
        inputTableName: inputTableName!,
        maskTableName: maskTableName!,
        inputGeometryColumn,
        maskGeometryColumn,
      };
      return operation.mode === 'filter'
        ? 'distance' in operation
          ? buildRelationFilterSql({
              ...baseSqlOptions,
              duckDbFunction: 'ST_Distance',
              distance: operation.distance,
            })
          : buildRelationFilterSql({
              ...baseSqlOptions,
              duckDbFunction: operation.duckDbFunction,
            })
        : operation.output === 'distance'
          ? buildRelationAttributeSql({
              ...baseSqlOptions,
              duckDbFunction: 'ST_Distance',
              output: 'distance',
              outputColumn: outputColumn!,
            })
          : 'distance' in operation
            ? buildRelationAttributeSql({
                ...baseSqlOptions,
                duckDbFunction: 'ST_Distance',
                distance: operation.distance,
                outputColumn: outputColumn!,
              })
            : buildRelationAttributeSql({
                ...baseSqlOptions,
                duckDbFunction: operation.duckDbFunction,
                outputColumn: outputColumn!,
              });
    },
    convertResult: (resultTable) =>
      arrowResultToDataset(
        resultTable,
        { layerName: opts.outputLayer },
        inputDataset,
        operation.id,
      ),
  });
}

import type { Table } from 'apache-arrow';
import type { MapshaperDataset } from '../../../types/mapshaper-types';
import { alignSecondaryDatasetCrs } from '../dataset-crs';
import { DuckDbOperationError } from '../../errors';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  pipelineMessages,
  requireRuntime,
  resolveTableColumnName,
  runPipeline,
} from '../pipeline';
import { type DuckDbRuntime } from '../../runtime';
import {
  buildRelationAttributeSql,
  buildRelationFilterSql,
  type RelationDuckDbFunction,
} from '../sql/relation';

export type RelationMode = 'filter' | 'attribute';
export type RelationOutputKind = 'predicate' | 'distance';

interface RelationOperationBase {
  id: string;
}

export interface RelationFilterPredicateOperation extends RelationOperationBase {
  mode: 'filter';
  duckDbFunction: RelationDuckDbFunction;
}

export interface RelationFilterDistanceWithinOperation extends RelationOperationBase {
  mode: 'filter';
  duckDbFunction: 'ST_Distance';
  distance: number;
}

export interface RelationAttributePredicateOperation extends RelationOperationBase {
  mode: 'attribute';
  duckDbFunction: RelationDuckDbFunction;
  output?: 'predicate';
  outputColumn?: string;
}

export interface RelationAttributeDistanceOperation extends RelationOperationBase {
  mode: 'attribute';
  duckDbFunction: 'ST_Distance';
  output: 'distance';
  outputColumn?: string;
}

export interface RelationAttributeDistanceWithinOperation extends RelationOperationBase {
  mode: 'attribute';
  duckDbFunction: 'ST_Distance';
  output?: 'predicate';
  outputColumn?: string;
  distance: number;
}

export type RelationOperation =
  | RelationFilterPredicateOperation
  | RelationFilterDistanceWithinOperation
  | RelationAttributePredicateOperation
  | RelationAttributeDistanceOperation
  | RelationAttributeDistanceWithinOperation;

export interface RelationRunnerOptions {
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
  opts: RelationRunnerOptions,
  operation: RelationOperation,
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
  opts: RelationRunnerOptions,
  operation: RelationOperation,
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  const rt = requireRuntime(runtime);
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
      pipelineMessages(operation.id).inputConversion,
      { cause: err },
    );
  }
  const mask = datasetToArrowInput(
    alignedMaskDataset,
    { layer: opts.maskLayer, geometryColumn: maskGeometryColumn },
    operation.id,
  );

  return runPipeline({
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

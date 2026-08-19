import type { Table } from 'apache-arrow';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './errors';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  duckDbPipelineMessages,
  requireDuckDbRuntime,
  resolveTableColumnName,
  runDuckDbPipeline,
} from './pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from './runtime';
import {
  buildRelationAttributeSql,
  buildRelationFilterSql,
  type RelationDuckDbFunction,
} from './sql';
import { alignSecondaryDatasetCrs } from './dataset-crs';

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

export function resolveRelationOutputColumn(table: Table, requestedName: string): string {
  return resolveTableColumnName(table, requestedName);
}

function relationOutputColumn(
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

  return trimmedOutputColumn;
}

export async function processRelationWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationOptions,
  spec: DuckDbRelationOperationSpec,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const rt = requireDuckDbRuntime(runtime);
  const inputGeometryColumn = opts.inputGeometryColumn ?? 'geometry';
  const maskGeometryColumn = opts.maskGeometryColumn ?? 'geometry';

  const requestedOutputColumn = relationOutputColumn(opts, spec);
  const input = datasetToArrowInput(
    inputDataset,
    { layer: opts.inputLayer, geometryColumn: inputGeometryColumn },
    spec.id,
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
      duckDbPipelineMessages(spec.id).inputConversion,
      { cause: err },
    );
  }
  const mask = datasetToArrowInput(
    alignedMaskDataset,
    { layer: opts.maskLayer, geometryColumn: maskGeometryColumn },
    spec.id,
  );

  return runDuckDbPipeline({
    label: spec.id,
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

      return spec.mode === 'filter'
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
              });
    },
    convertResult: (resultTable) =>
      arrowResultToDataset(resultTable, { layerName: opts.outputLayer }, inputDataset, spec.id),
  });
}

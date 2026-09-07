import type { Table } from 'apache-arrow';
import { toArrowTable } from '../../arrow/dataset-to-table';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import { alignSecondaryDatasetCrs } from '../core/dataset-crs';
import { DuckDbOperationError } from '../errors';
import { resolveUniqueColumnName, runPipeline } from '../core/pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { buildSpatialSummaryJoinSql } from './_spatial-summary-sql';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import {
  aggregateRowsByTargetId,
  createTargetInputDataset,
  rebuildSpatialSummaryDataset,
} from './_spatial-summary-result';
import {
  PREDICATE_FUNCTIONS,
  collectLayerFieldNames,
  featureCount,
  normalizeSpatialAggregations,
  resolveSpatialSummaryLayer,
  spatialSummaryValidation,
  validateAggregationFieldTypes,
  validateGeometryLayer,
  validateSpatialSummaryOptions,
  type SpatialSummaryJoinOptions,
} from './_spatial-summary-types';

export type {
  SpatialSummaryJoinOptions,
  SpatialSummaryJoinPredicate,
  SpatialSummaryJoinType,
  SpatialSummaryOperation,
  SpatialAggregation,
} from './_spatial-summary-types';

/**
 * @example
 * const result = await spatialSummaryJoin(polygons, points, { predicate: 'contains', aggregations: [{ operation: 'count', outputColumn: 'point_count' }] });
 */
export async function spatialSummaryJoin(
  targetDataset: MapshaperDataset,
  joinDataset: MapshaperDataset,
  opts: SpatialSummaryJoinOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const { options, predicate, joinType, targetGeometryColumn, joinGeometryColumn } =
    validateSpatialSummaryOptions(opts);
  normalizeSpatialAggregations(options, new Set(), targetGeometryColumn);
  const target = resolveSpatialSummaryLayer(
    targetDataset,
    options.targetLayer,
    'targetLayer',
    'target',
  );
  const join = resolveSpatialSummaryLayer(joinDataset, options.joinLayer, 'joinLayer', 'join');
  validateGeometryLayer(
    target.layer,
    'target',
    targetGeometryColumn,
    'targetGeometryColumn',
    !options.targetGeometryColumn,
  );
  validateGeometryLayer(
    join.layer,
    'join',
    joinGeometryColumn,
    'joinGeometryColumn',
    !options.joinGeometryColumn,
  );
  const targetFields = collectLayerFieldNames(target.layer);
  const aggregations = normalizeSpatialAggregations(options, targetFields, targetGeometryColumn);
  if (!runtime) {
    throw new DuckDbOperationError(
      'runtime-unavailable',
      'DuckDB spatial summary join runtime is not available',
    );
  }

  const rowCount = featureCount(target.layer);
  const reserved = new Set(targetFields);
  reserved.add(targetGeometryColumn);
  for (const aggregation of aggregations) reserved.add(aggregation.outputColumn);
  const rowIdColumn = resolveUniqueColumnName('__emap_rowid', reserved);

  let targetTable: Table | undefined;
  let joinTable: Table;
  try {
    const alignedJoinDataset = await alignSecondaryDatasetCrs(targetDataset, joinDataset);
    if (featureCount(join.layer) === 0) {
      for (const [index, aggregation] of aggregations.entries()) {
        if (aggregation.operation !== 'count') {
          throw spatialSummaryValidation(
            `aggregation field ${JSON.stringify(aggregation.field)} was not found in the join layer`,
            `aggregations[${index}].field`,
          );
        }
      }
      const rowIds =
        joinType === 'left' ? Array.from({ length: rowCount }, (_, index) => index) : [];
      return rebuildSpatialSummaryDataset(
        targetDataset,
        target.layer,
        rowIds,
        new Map(),
        aggregations,
        options.outputLayer,
      );
    }
    if (rowCount > 0) {
      targetTable = toArrowTable(
        createTargetInputDataset(targetDataset, target.layer, rowIdColumn),
        {
          encoding: 'wkb',
          geometryColumn: targetGeometryColumn,
          layer: 0,
        },
      );
    }
    joinTable = toArrowTable(alignedJoinDataset, {
      encoding: 'wkb',
      geometryColumn: joinGeometryColumn,
      layer: join.index,
    });
    validateAggregationFieldTypes(joinTable, joinGeometryColumn, aggregations);
  } catch (err) {
    if (err instanceof DuckDbOperationError) throw err;
    throw new DuckDbOperationError(
      'conversion-failed',
      'DuckDB spatial summary join input could not be converted to Arrow',
      { cause: err },
    );
  }

  if (rowCount === 0 || joinTable.numRows === 0) {
    const rowIds = joinType === 'left' ? Array.from({ length: rowCount }, (_, index) => index) : [];
    return rebuildSpatialSummaryDataset(
      targetDataset,
      target.layer,
      rowIds,
      new Map(),
      aggregations,
      options.outputLayer,
    );
  }

  return runPipeline({
    label: 'spatial summary join',
    runtime,
    messages: {
      spatialUnavailable: 'DuckDB spatial summary join spatial extension is unavailable',
    },
    inputs: [
      { table: targetTable!, prefix: 'emap_duckdb_spatial_aggregate_target' },
      { table: joinTable, prefix: 'emap_duckdb_spatial_aggregate_join' },
    ],
    buildSql: ([targetTableName, joinTableName]) =>
      buildSpatialSummaryJoinSql({
        targetTableName: targetTableName!,
        joinTableName: joinTableName!,
        targetGeometryColumn,
        joinGeometryColumn,
        targetRowIdColumn: rowIdColumn,
        duckDbFunction: PREDICATE_FUNCTIONS[predicate],
        aggregations,
      }),
    convertResult: (resultTable) => {
      try {
        const aggregateRows = aggregateRowsByTargetId(
          resultTable,
          rowIdColumn,
          aggregations,
          rowCount,
        );
        const rowIds = Array.from({ length: rowCount }, (_, index) => index).filter(
          (rowId) => joinType === 'left' || aggregateRows.has(rowId),
        );
        return rebuildSpatialSummaryDataset(
          targetDataset,
          target.layer,
          rowIds,
          aggregateRows,
          aggregations,
          options.outputLayer,
        );
      } catch (err) {
        throw new DuckDbOperationError(
          'conversion-failed',
          'DuckDB spatial summary join result could not be converted to a dataset',
          { cause: err },
        );
      }
    },
  });
}

export const spatialSummaryJoinTool = defineDuckDbTool({
  id: 'spatialSummaryJoin',
  category: 'join',
  title: 'Spatial Summary Join',
  description:
    'Summarize matching join features onto target features using count, sum, average, minimum or maximum.',
  inputs: [
    {
      name: 'input',
      description: 'Target features receiving summary fields.',
      required: true,
      geometry: ['any'],
    },
    {
      name: 'join',
      description: 'Features to match and summarize.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [
    {
      name: 'predicate',
      description: 'Spatial predicate used to match features.',
      type: 'enum',
      required: true,
      enumValues: Object.keys(PREDICATE_FUNCTIONS),
    },
    {
      name: 'aggregations',
      description: 'One or more aggregate calculations to append to each target feature.',
      type: 'object[]',
      required: true,
      minItems: 1,
      itemProperties: [
        {
          name: 'operation',
          description: 'Aggregate operation.',
          type: 'enum',
          required: true,
          enumValues: ['count', 'sum', 'avg', 'min', 'max'],
        },
        {
          name: 'field',
          description: 'Join field for sum, avg, min or max; omitted for count.',
          type: 'string',
        },
        {
          name: 'outputColumn',
          description: 'Output field receiving the aggregate value.',
          type: 'string',
          required: true,
        },
      ],
    },
    {
      name: 'joinType',
      description: 'Keep unmatched target features or only matched targets.',
      type: 'enum',
      default: 'left',
      enumValues: ['left', 'inner'],
    },
  ],
  crs: 'known',
  units: 'none',
  output: {
    geometry: 'preserve',
    cardinality: 'variable',
    attributes: 'append',
    mutatesInput: false,
  },
  cost: 'high',
  agent: {
    summary: 'Aggregate values from spatially matching features onto a target layer.',
    whenToUse: [
      'Count points per polygon.',
      'Sum or average attributes of features inside each target feature.',
    ],
    avoidWhen: ['You need every individual matching feature; use spatialJoin instead.'],
    keywords: [
      'spatial summary join',
      'aggregate by location',
      'count points in polygon',
      'spatial statistics',
    ],
  },
  execute: (context) =>
    spatialSummaryJoin(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'join'),
      toolParams<SpatialSummaryJoinOptions>(context),
      context.runtime,
    ),
});

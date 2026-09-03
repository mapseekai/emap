import { DataType, type Table } from 'apache-arrow';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import { toArrowTable } from '../arrow/dataset-to-table';
import { recordsFromArrowTable } from '../arrow/table-to-dataset';
import { resolveLayerInList } from '../map/layer-registry';
import type { FeatureShape, MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import { alignSecondaryDatasetCrs } from './dataset-crs';
import { DuckDbOperationError } from './errors';
import { resolveUniqueColumnName, runDuckDbPipeline } from './pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from './runtime';
import { buildSpatialAggregateJoinSql, type SpatialAggregateJoinDuckDbFunction } from './sql';

export type DuckDbSpatialAggregateJoinPredicate =
  | 'intersects'
  | 'contains'
  | 'within'
  | 'touches'
  | 'overlaps'
  | 'equals'
  | 'crosses'
  | 'covers'
  | 'coveredBy'
  | 'containsProperly';

export type DuckDbSpatialAggregateJoinType = 'left' | 'inner';

export type DuckDbSpatialAggregateOperation = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type DuckDbSpatialAggregation =
  | { operation: 'count'; outputColumn: string; field?: never }
  | {
      operation: Exclude<DuckDbSpatialAggregateOperation, 'count'>;
      field: string;
      outputColumn: string;
    };

export interface DuckDbSpatialAggregateJoinOptions {
  predicate: DuckDbSpatialAggregateJoinPredicate;
  aggregations: readonly DuckDbSpatialAggregation[];
  joinType?: DuckDbSpatialAggregateJoinType;
  targetLayer?: string | number;
  joinLayer?: string | number;
  targetGeometryColumn?: string;
  joinGeometryColumn?: string;
  outputLayer?: string;
}

const PREDICATE_FUNCTIONS = {
  intersects: 'ST_Intersects',
  contains: 'ST_Contains',
  within: 'ST_Within',
  touches: 'ST_Touches',
  overlaps: 'ST_Overlaps',
  equals: 'ST_Equals',
  crosses: 'ST_Crosses',
  covers: 'ST_Covers',
  coveredBy: 'ST_CoveredBy',
  containsProperly: 'ST_ContainsProperly',
} as const satisfies Record<
  DuckDbSpatialAggregateJoinPredicate,
  SpatialAggregateJoinDuckDbFunction
>;


interface NormalizedAggregation {
  operation: DuckDbSpatialAggregateOperation;
  outputColumn: string;
  field?: string;
}

interface ResolvedLayer {
  layer: MapshaperLayer;
  index: number;
}


function validation(message: string, field?: string): DuckDbOperationError {
  return new DuckDbOperationError('validation', `DuckDB spatial aggregate join ${message}`, {
    field,
  });
}

function isOwnKey<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeGeometryColumn(
  value: unknown,
  field: 'targetGeometryColumn' | 'joinGeometryColumn',
) {
  if (!value) return 'geometry';
  if (typeof value !== 'string') throw validation(`${field} must be a string`, field);
  return value;
}

function resolveSelectedLayer(
  dataset: MapshaperDataset,
  selector: unknown,
  field: 'targetLayer' | 'joinLayer',
  role: 'target' | 'join',
): ResolvedLayer {
  const layers = dataset.layers ?? [];
  let layer: MapshaperLayer | null | undefined;
  if (selector === undefined) {
    layer = layers[0];
  } else if (typeof selector === 'string') {
    layer = resolveLayerInList(layers, selector);
  } else if (typeof selector === 'number' && Number.isInteger(selector)) {
    layer = selector >= 0 && selector < layers.length ? layers[selector] : undefined;
  } else {
    layer = undefined;
  }

  const index = layer ? layers.indexOf(layer) : -1;
  if (!layer || index < 0) {
    throw validation(`${role} layer ${String(selector ?? 0)} was not found`, field);
  }
  return { layer, index };
}

function collectLayerFieldNames(layer: MapshaperLayer): Set<string> {
  const fields = new Set(layer.data?.getFields?.() ?? []);
  for (const record of layer.data?.getRecords?.() ?? []) {
    for (const name of Object.keys(record)) fields.add(name);
  }
  return fields;
}

function normalizeAggregations(
  rawOptions: unknown,
  targetFields: ReadonlySet<string>,
  targetGeometryColumn: string,
): NormalizedAggregation[] {
  const options = rawOptions as Partial<DuckDbSpatialAggregateJoinOptions>;
  if (!Array.isArray(options.aggregations) || options.aggregations.length === 0) {
    throw validation('aggregations must be a non-empty array', 'aggregations');
  }

  const reserved = new Set(targetFields);
  reserved.add(targetGeometryColumn);
  const outputNames = new Set<string>();
  return options.aggregations.map((entry, index) => {
    const fieldPrefix = `aggregations[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw validation(`${fieldPrefix} must be an object`, fieldPrefix);
    }
    const aggregation = entry as Record<string, unknown>;
    const operation = aggregation.operation;
    if (
      operation !== 'count' &&
      operation !== 'sum' &&
      operation !== 'avg' &&
      operation !== 'min' &&
      operation !== 'max'
    ) {
      throw validation(`${fieldPrefix}.operation is invalid`, `${fieldPrefix}.operation`);
    }
    if (typeof aggregation.outputColumn !== 'string' || !aggregation.outputColumn.trim()) {
      throw validation(`${fieldPrefix}.outputColumn is required`, `${fieldPrefix}.outputColumn`);
    }
    const outputColumn = aggregation.outputColumn.trim();
    if (reserved.has(outputColumn) || outputNames.has(outputColumn)) {
      throw validation(
        `${fieldPrefix}.outputColumn collides with an existing target or aggregate column`,
        `${fieldPrefix}.outputColumn`,
      );
    }
    outputNames.add(outputColumn);
    if (operation === 'count') {
      if (aggregation.field !== undefined) {
        throw validation(`${fieldPrefix}.field is not supported for count`, `${fieldPrefix}.field`);
      }
      return { operation, outputColumn };
    }
    if (typeof aggregation.field !== 'string' || !aggregation.field.trim()) {
      throw validation(`${fieldPrefix}.field is required`, `${fieldPrefix}.field`);
    }
    return { operation, field: aggregation.field, outputColumn };
  });
}


function validateOptions(rawOptions: unknown): {
  options: Partial<DuckDbSpatialAggregateJoinOptions>;
  predicate: DuckDbSpatialAggregateJoinPredicate;
  joinType: DuckDbSpatialAggregateJoinType;
  targetGeometryColumn: string;
  joinGeometryColumn: string;
} {
  if (!rawOptions || typeof rawOptions !== 'object') {
    throw validation('options must be an object');
  }
  const options = rawOptions as Partial<DuckDbSpatialAggregateJoinOptions>;
  const targetGeometryColumn = normalizeGeometryColumn(
    options.targetGeometryColumn,
    'targetGeometryColumn',
  );
  const joinGeometryColumn = normalizeGeometryColumn(
    options.joinGeometryColumn,
    'joinGeometryColumn',
  );
  if (typeof options.predicate !== 'string' || !isOwnKey(PREDICATE_FUNCTIONS, options.predicate)) {
    throw validation('predicate is invalid', 'predicate');
  }
  const joinType = options.joinType === undefined ? 'left' : options.joinType;
  if (joinType !== 'left' && joinType !== 'inner') {
    throw validation('joinType is invalid', 'joinType');
  }
  return {
    options,
    predicate: options.predicate,
    joinType,
    targetGeometryColumn,
    joinGeometryColumn,
  };
}

function validateGeometryLayer(
  layer: MapshaperLayer,
  role: 'target' | 'join',
  geometryColumn: string,
  geometryField: 'targetGeometryColumn' | 'joinGeometryColumn',
  usesFallbackGeometryColumn: boolean,
): void {
  if (featureCount(layer) > 0 && !layer.geometry_type) {
    throw validation(
      `${role} layer has no geometry type for ${geometryColumn}`,
      usesFallbackGeometryColumn ? undefined : geometryField,
    );
  }
}

function createTargetInputDataset(
  dataset: MapshaperDataset,
  layer: MapshaperLayer,
  rowIdColumn: string,
): MapshaperDataset {
  const sourceRecords = layer.data?.getRecords?.() ?? [];
  const rowCount = layer.shapes?.length ?? sourceRecords.length;
  const records = Array.from({ length: rowCount }, (_, index) => ({
    ...(sourceRecords[index] ?? {}),
    [rowIdColumn]: index,
  }));
  return {
    ...dataset,
    layers: [{ ...layer, data: getDefaultMapshaperAdapter().createDataTable(records) }],
  };
}

function featureCount(layer: MapshaperLayer): number {
  return layer.shapes?.length ?? layer.data?.getRecords?.().length ?? 0;
}

function validateAggregationFieldTypes(
  joinTable: Table,
  joinGeometryColumn: string,
  aggregations: readonly NormalizedAggregation[],
): void {
  for (const [index, aggregation] of aggregations.entries()) {
    if (aggregation.operation === 'count') continue;
    const field = joinTable.schema.fields.find((candidate) => candidate.name === aggregation.field);
    if (!field) {
      throw validation(
        `aggregation field ${JSON.stringify(aggregation.field)} was not found in the join layer`,
        `aggregations[${index}].field`,
      );
    }
    const numeric =
      DataType.isInt(field.type) || DataType.isFloat(field.type) || DataType.isDecimal(field.type);
    const orderable =
      numeric ||
      DataType.isUtf8(field.type) ||
      DataType.isBool(field.type) ||
      DataType.isDate(field.type) ||
      DataType.isTime(field.type) ||
      DataType.isTimestamp(field.type) ||
      DataType.isDuration(field.type);
    if ((aggregation.operation === 'sum' || aggregation.operation === 'avg') && !numeric) {
      throw validation(
        `${aggregation.operation} requires a numeric join field`,
        `aggregations[${index}].field`,
      );
    }
    if ((aggregation.operation === 'min' || aggregation.operation === 'max') && !orderable) {
      throw validation(
        `${aggregation.operation} requires an orderable scalar join field`,
        `aggregations[${index}].field`,
      );
    }
    if (aggregation.field === joinGeometryColumn) {
      throw validation(
        'aggregate fields cannot use the join geometry column',
        `aggregations[${index}].field`,
      );
    }
  }
}

type ShapeNode = number | ShapeNode[];

function cloneShapeNode(node: ShapeNode): ShapeNode {
  return Array.isArray(node) ? node.map((child) => cloneShapeNode(child)) : node;
}

function cloneShape(shape: FeatureShape | null): FeatureShape | null {
  return shape === null ? null : (cloneShapeNode(shape as ShapeNode) as FeatureShape);
}

function rebuildShapes(
  layer: MapshaperLayer,
  rowIds: readonly number[],
): (FeatureShape | null)[] | null {
  return layer.shapes ? rowIds.map((rowId) => cloneShape(layer.shapes![rowId] ?? null)) : null;
}

function aggregateRowsByTargetId(
  resultTable: Table,
  rowIdColumn: string,
  aggregations: readonly NormalizedAggregation[],
  targetRowCount: number,
): Map<number, Record<string, unknown>> {
  const expectedColumns = [
    rowIdColumn,
    ...aggregations.map((aggregation) => aggregation.outputColumn),
  ];
  for (const name of expectedColumns) {
    if (!resultTable.schema.fields.some((field) => field.name === name)) {
      throw new Error(`DuckDB spatial aggregate join result is missing column ${name}`);
    }
  }
  const records = recordsFromArrowTable(resultTable);
  const rows = new Map<number, Record<string, unknown>>();
  for (const [index, record] of records.entries()) {
    const rawRowId = record[rowIdColumn];
    const rowId =
      typeof rawRowId === 'bigint' &&
      rawRowId >= BigInt(Number.MIN_SAFE_INTEGER) &&
      rawRowId <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(rawRowId)
        : rawRowId;
    if (
      typeof rowId !== 'number' ||
      !Number.isSafeInteger(rowId) ||
      rowId < 0 ||
      rowId >= targetRowCount
    ) {
      throw new Error(`DuckDB spatial aggregate join result has invalid row id at row ${index}`);
    }
    if (rows.has(rowId)) {
      throw new Error(`DuckDB spatial aggregate join result has duplicate row id ${rowId}`);
    }
    const values: Record<string, unknown> = {};
    for (const aggregation of aggregations) {
      Object.defineProperty(values, aggregation.outputColumn, {
        configurable: true,
        enumerable: true,
        value: record[aggregation.outputColumn],
        writable: true,
      });
    }
    rows.set(rowId, values);
  }
  return rows;
}

function emptyAggregateValues(
  aggregations: readonly NormalizedAggregation[],
): Record<string, unknown> {
  return Object.fromEntries(
    aggregations.map((aggregation) => [
      aggregation.outputColumn,
      aggregation.operation === 'count' ? 0 : null,
    ]),
  );
}

function rebuildDataset(
  targetDataset: MapshaperDataset,
  targetLayer: MapshaperLayer,
  rowIds: readonly number[],
  aggregateRows: ReadonlyMap<number, Record<string, unknown>>,
  aggregations: readonly NormalizedAggregation[],
  outputLayerName: unknown,
): MapshaperDataset {
  const sourceRecords = targetLayer.data?.getRecords?.() ?? [];
  const defaults = emptyAggregateValues(aggregations);
  const records = rowIds.map((rowId) => ({
    ...(sourceRecords[rowId] ?? {}),
    ...(aggregateRows.get(rowId) ?? defaults),
  }));
  const outputLayer: MapshaperLayer = {
    ...targetLayer,
    name: typeof outputLayerName === 'string' ? outputLayerName : targetLayer.name,
    data: getDefaultMapshaperAdapter().createDataTable(records),
    shapes: rebuildShapes(targetLayer, rowIds),
  };
  return {
    ...targetDataset,
    layers: [outputLayer],
    info: targetDataset.info ? { ...targetDataset.info } : undefined,
  };
}

export async function spatialAggregateJoinDatasetWithDuckDb(
  targetDataset: MapshaperDataset,
  joinDataset: MapshaperDataset,
  opts: DuckDbSpatialAggregateJoinOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const { options, predicate, joinType, targetGeometryColumn, joinGeometryColumn } =
    validateOptions(opts);
  normalizeAggregations(options, new Set(), targetGeometryColumn);
  const target = resolveSelectedLayer(targetDataset, options.targetLayer, 'targetLayer', 'target');
  const join = resolveSelectedLayer(joinDataset, options.joinLayer, 'joinLayer', 'join');
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
  const aggregations = normalizeAggregations(options, targetFields, targetGeometryColumn);
  if (!runtime) {
    throw new DuckDbOperationError(
      'runtime-unavailable',
      'DuckDB spatial aggregate join runtime is not available',
    );
  }

  const rowCount = featureCount(target.layer);
  const reserved = new Set(targetFields);
  reserved.add(targetGeometryColumn);
  for (const aggregation of aggregations) reserved.add(aggregation.outputColumn);
  const rowIdColumn = resolveUniqueColumnName('__emap_rowid', reserved);

  let alignedJoinDataset: MapshaperDataset;
  let targetTable: Table | undefined;
  let joinTable: Table | undefined;
  try {
    alignedJoinDataset = await alignSecondaryDatasetCrs(targetDataset, joinDataset);
    if (featureCount(join.layer) === 0) {
      for (const [index, aggregation] of aggregations.entries()) {
        if (aggregation.operation !== 'count') {
          throw validation(
            `aggregation field ${JSON.stringify(aggregation.field)} was not found in the join layer`,
            `aggregations[${index}].field`,
          );
        }
      }
      const rowIds =
        joinType === 'left' ? Array.from({ length: rowCount }, (_, index) => index) : [];
      return rebuildDataset(
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
      'DuckDB spatial aggregate join input could not be converted to Arrow',
      { cause: err },
    );
  }

  if (rowCount === 0 || joinTable.numRows === 0) {
    const rowIds = joinType === 'left' ? Array.from({ length: rowCount }, (_, index) => index) : [];
    return rebuildDataset(
      targetDataset,
      target.layer,
      rowIds,
      new Map(),
      aggregations,
      options.outputLayer,
    );
  }

  return runDuckDbPipeline({
    label: 'spatial aggregate join',
    runtime,
    messages: {
      spatialUnavailable: 'DuckDB spatial aggregate join spatial extension is unavailable',
    },
    inputs: [
      { table: targetTable!, prefix: 'emap_duckdb_spatial_aggregate_target' },
      { table: joinTable, prefix: 'emap_duckdb_spatial_aggregate_join' },
    ],
    buildSql: ([targetTableName, joinTableName]) =>
      buildSpatialAggregateJoinSql({
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
        return rebuildDataset(
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
          'DuckDB spatial aggregate join result could not be converted to a dataset',
          { cause: err },
        );
      }
    },
  });
}

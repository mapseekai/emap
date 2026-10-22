import { DataType, type Table } from 'apache-arrow';
import { resolveLayerInList } from '../../../engine/map/layer-registry';
import type { MapshaperDataset, MapshaperLayer } from '../../../shared/types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import type { SpatialSummaryJoinDuckDbFunction } from './_spatial-summary-sql';

/**
 * @example
 * const predicate: SpatialSummaryJoinPredicate = 'intersects';
 */
export type SpatialSummaryJoinPredicate =
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
/**
 * @example
 * const joinType: SpatialSummaryJoinType = 'left';
 */
export type SpatialSummaryJoinType = 'left' | 'inner';
/**
 * @example
 * const operation: SpatialSummaryOperation = 'sum';
 */
export type SpatialSummaryOperation = 'count' | 'sum' | 'avg' | 'min' | 'max';
/**
 * @example
 * const aggregation: SpatialAggregation = { operation: 'sum', field: 'sales', outputColumn: 'sales_sum' };
 */
export type SpatialAggregation =
  | { operation: 'count'; outputColumn: string; field?: never }
  | {
      operation: Exclude<SpatialSummaryOperation, 'count'>;
      field: string;
      outputColumn: string;
    };

/**
 * @example
 * const options: SpatialSummaryJoinOptions = { predicate: 'contains', aggregations: [{ operation: 'count', outputColumn: 'point_count' }] };
 */
export interface SpatialSummaryJoinOptions {
  signal?: AbortSignal;
  predicate: SpatialSummaryJoinPredicate;
  aggregations: readonly SpatialAggregation[];
  joinType?: SpatialSummaryJoinType;
  targetLayer?: string | number;
  joinLayer?: string | number;
  targetGeometryColumn?: string;
  joinGeometryColumn?: string;
  outputLayer?: string;
}

export const PREDICATE_FUNCTIONS = {
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
} as const satisfies Record<SpatialSummaryJoinPredicate, SpatialSummaryJoinDuckDbFunction>;

export interface NormalizedAggregation {
  operation: SpatialSummaryOperation;
  outputColumn: string;
  field?: string;
}

export interface ResolvedLayer {
  layer: MapshaperLayer;
  index: number;
}

export function spatialSummaryValidation(message: string, field?: string): DuckDbOperationError {
  return new DuckDbOperationError('validation', `DuckDB spatial summary join ${message}`, {
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
  if (typeof value !== 'string') {
    throw spatialSummaryValidation(`${field} must be a string`, field);
  }
  return value;
}

export function resolveSpatialSummaryLayer(
  dataset: MapshaperDataset,
  selector: unknown,
  field: 'targetLayer' | 'joinLayer',
  role: 'target' | 'join',
): ResolvedLayer {
  const layers = dataset.layers ?? [];
  let layer: MapshaperLayer | null | undefined;
  if (selector === undefined) layer = layers[0];
  else if (typeof selector === 'string') layer = resolveLayerInList(layers, selector);
  else if (typeof selector === 'number' && Number.isInteger(selector)) {
    layer = selector >= 0 && selector < layers.length ? layers[selector] : undefined;
  }
  const index = layer ? layers.indexOf(layer) : -1;
  if (!layer || index < 0) {
    throw spatialSummaryValidation(`${role} layer ${String(selector ?? 0)} was not found`, field);
  }
  return { layer, index };
}

export function collectLayerFieldNames(layer: MapshaperLayer): Set<string> {
  const fields = new Set(layer.data?.getFields?.() ?? []);
  for (const record of layer.data?.getRecords?.() ?? []) {
    for (const name of Object.keys(record)) fields.add(name);
  }
  return fields;
}

export function normalizeSpatialAggregations(
  rawOptions: unknown,
  targetFields: ReadonlySet<string>,
  targetGeometryColumn: string,
): NormalizedAggregation[] {
  const options = rawOptions as Partial<SpatialSummaryJoinOptions>;
  if (!Array.isArray(options.aggregations) || options.aggregations.length === 0) {
    throw spatialSummaryValidation('aggregations must be a non-empty array', 'aggregations');
  }
  const reserved = new Set(targetFields);
  reserved.add(targetGeometryColumn);
  const outputNames = new Set<string>();
  return options.aggregations.map((entry, index) => {
    const fieldPrefix = `aggregations[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw spatialSummaryValidation(`${fieldPrefix} must be an object`, fieldPrefix);
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
      throw spatialSummaryValidation(
        `${fieldPrefix}.operation is invalid`,
        `${fieldPrefix}.operation`,
      );
    }
    if (typeof aggregation.outputColumn !== 'string' || !aggregation.outputColumn.trim()) {
      throw spatialSummaryValidation(
        `${fieldPrefix}.outputColumn is required`,
        `${fieldPrefix}.outputColumn`,
      );
    }
    const outputColumn = aggregation.outputColumn.trim();
    if (reserved.has(outputColumn) || outputNames.has(outputColumn)) {
      throw spatialSummaryValidation(
        `${fieldPrefix}.outputColumn collides with an existing target or aggregate column`,
        `${fieldPrefix}.outputColumn`,
      );
    }
    outputNames.add(outputColumn);
    if (operation === 'count') {
      if (aggregation.field !== undefined) {
        throw spatialSummaryValidation(
          `${fieldPrefix}.field is not supported for count`,
          `${fieldPrefix}.field`,
        );
      }
      return { operation, outputColumn };
    }
    if (typeof aggregation.field !== 'string' || !aggregation.field.trim()) {
      throw spatialSummaryValidation(`${fieldPrefix}.field is required`, `${fieldPrefix}.field`);
    }
    return { operation, field: aggregation.field, outputColumn };
  });
}

export function validateSpatialSummaryOptions(rawOptions: unknown) {
  if (!rawOptions || typeof rawOptions !== 'object') {
    throw spatialSummaryValidation('options must be an object');
  }
  const options = rawOptions as Partial<SpatialSummaryJoinOptions>;
  const targetGeometryColumn = normalizeGeometryColumn(
    options.targetGeometryColumn,
    'targetGeometryColumn',
  );
  const joinGeometryColumn = normalizeGeometryColumn(
    options.joinGeometryColumn,
    'joinGeometryColumn',
  );
  if (typeof options.predicate !== 'string' || !isOwnKey(PREDICATE_FUNCTIONS, options.predicate)) {
    throw spatialSummaryValidation('predicate is invalid', 'predicate');
  }
  const joinType = options.joinType === undefined ? 'left' : options.joinType;
  if (joinType !== 'left' && joinType !== 'inner') {
    throw spatialSummaryValidation('joinType is invalid', 'joinType');
  }
  return {
    options,
    predicate: options.predicate,
    joinType,
    targetGeometryColumn,
    joinGeometryColumn,
  } as const;
}

export function featureCount(layer: MapshaperLayer): number {
  return layer.shapes?.length ?? layer.data?.getRecords?.().length ?? 0;
}

export function validateGeometryLayer(
  layer: MapshaperLayer,
  role: 'target' | 'join',
  geometryColumn: string,
  geometryField: 'targetGeometryColumn' | 'joinGeometryColumn',
  usesFallbackGeometryColumn: boolean,
): void {
  if (featureCount(layer) > 0 && !layer.geometry_type) {
    throw spatialSummaryValidation(
      `${role} layer has no geometry type for ${geometryColumn}`,
      usesFallbackGeometryColumn ? undefined : geometryField,
    );
  }
}

export function validateAggregationFieldTypes(
  joinTable: Table,
  joinGeometryColumn: string,
  aggregations: readonly NormalizedAggregation[],
): void {
  for (const [index, aggregation] of aggregations.entries()) {
    if (aggregation.operation === 'count') continue;
    const field = joinTable.schema.fields.find((candidate) => candidate.name === aggregation.field);
    if (!field) {
      throw spatialSummaryValidation(
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
      throw spatialSummaryValidation(
        `${aggregation.operation} requires a numeric join field`,
        `aggregations[${index}].field`,
      );
    }
    if ((aggregation.operation === 'min' || aggregation.operation === 'max') && !orderable) {
      throw spatialSummaryValidation(
        `${aggregation.operation} requires an orderable scalar join field`,
        `aggregations[${index}].field`,
      );
    }
    if (aggregation.field === joinGeometryColumn) {
      throw spatialSummaryValidation(
        'aggregate fields cannot use the join geometry column',
        `aggregations[${index}].field`,
      );
    }
  }
}

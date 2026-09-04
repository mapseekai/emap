export * from './errors';
export * from './buffer';
export * from './geoparquet-query';
export * from './geometry-executor';
export * from './attribute-executor';
export {
  DUCKDB_ATTRIBUTE_OPERATION_SPECS,
  getDuckDbAttributeOperationSpec,
  areaDatasetWithDuckDb,
  lengthDatasetWithDuckDb,
  perimeterDatasetWithDuckDb,
  geometryTypeDatasetWithDuckDb,
  isValidDatasetWithDuckDb,
  isEmptyDatasetWithDuckDb,
  isSimpleDatasetWithDuckDb,
  xDatasetWithDuckDb,
  yDatasetWithDuckDb,
  centroidXDatasetWithDuckDb,
  centroidYDatasetWithDuckDb,
} from './attribute-registry';
export type {
  DuckDbAttributeOperationId,
  DuckDbAttributeOperationOptions,
} from './attribute-registry';
export * from './query-executor';
export * from './query-sql';
export * from './relation-executor';
export {
  getDuckDbRelationOperationSpec,
  intersectsDatasetWithDuckDb,
  containsDatasetWithDuckDb,
  withinDatasetWithDuckDb,
  touchesDatasetWithDuckDb,
  disjointDatasetWithDuckDb,
  overlapsDatasetWithDuckDb,
  equalsDatasetWithDuckDb,
  crossesDatasetWithDuckDb,
  coversDatasetWithDuckDb,
  coveredByDatasetWithDuckDb,
  containsProperlyDatasetWithDuckDb,
  distanceWithinDatasetWithDuckDb,
  intersectsAttributeDatasetWithDuckDb,
  containsAttributeDatasetWithDuckDb,
  withinAttributeDatasetWithDuckDb,
  touchesAttributeDatasetWithDuckDb,
  disjointAttributeDatasetWithDuckDb,
  overlapsAttributeDatasetWithDuckDb,
  equalsAttributeDatasetWithDuckDb,
  crossesAttributeDatasetWithDuckDb,
  coversAttributeDatasetWithDuckDb,
  coveredByAttributeDatasetWithDuckDb,
  containsProperlyAttributeDatasetWithDuckDb,
  distanceDatasetWithDuckDb,
  distanceWithinAttributeDatasetWithDuckDb,
} from './relation-registry';
export type {
  DuckDbRelationOperationId,
  DuckDbNamedRelationOperationSpec,
  DuckDbRelationHelperOptions,
} from './relation-registry';
export * from './overlay-executor';
export {
  getDuckDbOverlayOperationSpec,
  intersectionDatasetWithDuckDb,
  differenceDatasetWithDuckDb,
} from './overlay-registry';
export type { DuckDbOverlayOperationId, DuckDbOverlayHelperOptions } from './overlay-registry';
export * from './runtime';
export {
  DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS,
  centroidDatasetWithDuckDb,
  envelopeDatasetWithDuckDb,
  convexHullDatasetWithDuckDb,
  boundaryDatasetWithDuckDb,
  makeValidDatasetWithDuckDb,
  simplifyDatasetWithDuckDb,
  simplifyPreserveTopologyDatasetWithDuckDb,
  getDuckDbUnaryGeometryOperationSpec,
} from './geometry-registry';
export type {
  DuckDbUnaryGeometryOperationId,
  DuckDbSimplifyOptions,
} from './geometry-registry';
export * from './spatial-aggregate-join';
export * from './map-operations';

/** @module duckdb */
// Infrastructure
export { DuckDbOperationError } from './errors';
export type { DuckDbOperationErrorKind } from './errors';
export {
  closeDuckDbRuntime,
  quoteSqlString,
  createDuckDbRuntimeFromJsDelivr,
} from './runtime';
export type {
  DuckDbConnection,
  DuckDbRuntime,
  DuckDbWasmModule,
  DuckDbSpatialExtensionUrls,
  CreateDuckDbRuntimeOptions,
} from './runtime';
export { validateDuckDbSelectSql } from './core/query-sql';
export type {
  ValidateDuckDbSelectSqlOptions,
  ValidatedDuckDbSelectSql,
  ValidatedDuckDbSelectSqlWithRowId,
  ValidatedDuckDbSelectSqlWithoutRowId,
} from './core/query-sql';
export { createDuckDbGeoParquetQuerySource, queryGeoParquetWithDuckDb } from './geoparquet';
export type { DuckDbGeoParquetQueryOptions, DuckDbGeoParquetQuerySource } from './geoparquet';

// Agent/UI/workflow processing registry
export { duckDbToolbox } from './toolbox';
export type { DuckDbToolId } from './toolbox';
export type {
  DuckDbToolDefinition,
  DuckDbToolExecutionContext,
  DuckDbToolInput,
  DuckDbToolParameter,
  DuckDbToolObjectProperty,
  DuckDbToolOutput,
  DuckDbAgentMetadata,
  DuckDbToolCategory,
} from './core/tool-definition';

// Canonical processing API — short GIS-oriented names.
export { clip, intersect, union, difference, symmetricDifference } from './overlay';
export type {
  ClipOptions,
  IntersectOptions,
  DifferenceOptions,
  UnionOptions,
  SymmetricDifferenceOptions,
} from './overlay';

export { buffer, near, nearest } from './proximity';
export type { BufferOptions, NearOptions, NearestOptions } from './proximity';

export { dissolve, collect } from './aggregate';
export type { AggregateOptions } from './aggregate';

export { attributeJoin, spatialJoin, spatialSummaryJoin } from './join';
export type {
  AttributeJoinOptions,
  SpatialJoinOptions,
  SpatialJoinPredicate,
  SpatialSummaryJoinOptions,
  SpatialSummaryJoinPredicate,
  SpatialSummaryJoinType,
  SpatialSummaryOperation,
  SpatialAggregation,
} from './join';

export {
  centroid,
  envelope,
  convexHull,
  boundary,
  simplify,
  simplifyPreserveTopology,
  densify,
  multipartToSinglepart,
  extractVertices,
} from './geometry';
export type { GeometryOptions, SimplifyOptions, DensifyOptions } from './geometry';

export { pointToLine, lineToPolygon, polygonToLine } from './transform';
export type { PointToLineOptions } from './transform';

export { attributeFilter, spatialFilter, spatialRelation } from './selection';
export type {
  AttributeFilterOptions,
  SpatialFilterOptions,
  SpatialFilterPredicate,
  SpatialRelationOptions,
} from './selection';

export { merge, append, reproject, repairGeometry } from './data-management';
export type { MergeOptions, ReprojectOptions, RepairGeometryOptions } from './data-management';

export {
  area,
  length,
  perimeter,
  geometryType,
  isValid,
  isEmpty,
  isSimple,
  x,
  y,
  centroidX,
  centroidY,
} from './attributes';
export type { AttributeOptions } from './attributes';

// Advanced map/source adapters. New applications should prefer duckDbToolbox.execute()
// or the short dataset functions above.
export {
  duckDbAttributeFilterLayer,
  duckDbSpatialSummaryJoinLayer,
  duckDbGeoParquetQueryLayer,
  duckDbOverlayLayer,
} from './map-operations';
export type {
  DuckDbMapOpSource,
  DuckDbMapOpContext,
  DuckDbSpatialSummaryJoinLayerOptions,
  DuckDbAttributeFilterLayerOptions,
  DuckDbGeoParquetQueryLayerOptions,
  DuckDbSpatialSummaryJoinLayerResult,
  DuckDbAttributeFilterLayerResult,
  DuckDbGeoParquetQueryLayerResult,
  DuckDbOverlayLayerOptions,
  DuckDbOverlayLayerResult,
} from './map-operations';

export { DuckDbRuntimeScope } from './runtime-scope';
export type { DuckDbRuntimeOptions } from './runtime-scope';
export { duckDbPlugin } from './plugin';
export type { DuckDbProcessing } from './plugin';
export { duckDbCapabilityPlugins } from './capabilities';

// Infrastructure
export * from './errors';
export * from './runtime';
export * from './core/query-sql';
export * from './geoparquet';

// Agent/UI/workflow processing registry
export * from './toolbox';
export type {
  DuckDbToolDefinition,
  DuckDbToolExecutionContext,
  DuckDbToolInputSpec,
  DuckDbToolParameterSpec,
  DuckDbToolOutputSpec,
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

// Advanced map/source adapters. New applications should prefer toolbox.execute()
// or the short dataset functions above.
export {
  duckDbAttributeFilterLayer,
  duckDbGeometryLayer,
  duckDbRelationLayer,
  duckDbSpatialSummaryJoinLayer,
  duckDbAttributeLayer,
  duckDbGeoParquetQueryLayer,
  duckDbOverlayLayer,
} from './map-operations';
export type {
  DuckDbMapOpSource,
  DuckDbMapOpContext,
  DuckDbGeometryLayerOptions,
  DuckDbAttributeLayerOptions,
  DuckDbRelationLayerOptions,
  DuckDbSpatialSummaryJoinLayerOptions,
  DuckDbAttributeFilterLayerOptions,
  DuckDbGeoParquetQueryLayerOptions,
  DuckDbGeometryLayerResult,
  DuckDbAttributeLayerResult,
  DuckDbRelationLayerResult,
  DuckDbSpatialSummaryJoinLayerResult,
  DuckDbAttributeFilterLayerResult,
  DuckDbGeoParquetQueryLayerResult,
  DuckDbOverlayLayerOptions,
  DuckDbOverlayLayerResult,
} from './map-operations';

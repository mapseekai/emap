import './shim';
import 'mapshaper';

export { Emap } from './map/map';
export type {
  QueryRenderedFeaturesOptions,
  RenderedFeatureAttributes,
  ExpressionEvaluationPolicy,
  FeatureRef,
  FeatureTranslateSession,
  FeatureAffineSession,
  HighlightFeatureRef,
  HighlightStyle,
  ClipEraseOptions,
  DissolveOptions,
  CleanOptions,
  BufferOptions,
  ApplyExpressionOptions,
  ExplodeOptions,
  InnerlinesOptions,
  FilterOptions,
  SnapOptions,
  MosaicOptions,
  UnionOptions,
  DivideOptions,
  PointsOptions,
  PointsMode,
  LinesOptions,
  PolygonsOptions,
  SimplifyOptions,
  SimplifyMethod,
  ProjectOptions,
  RebuildTopologyOptions,
  RenameLayerOptions,
  MergeLayersOptions,
  SplitLayerOptions,
  DropLayerOptions,
  SortFeaturesOptions,
  UniqueFeaturesOptions,
  FilterFieldsOptions,
  RenameFieldsOptions,
  JoinTableOptions,
  JoinTableData,
  CheckGeometryOptions,
  GeometryCheckReport,
  IntersectionPointsLayerOptions,
  ExportSnapshotOptions,
  LoadSnapshotOptions,
} from './map/map';
export { FeatureQuery } from './map/feature-query';
export {
  quoteCliArg,
  isValidLayerName,
  isValidFieldName,
  findInvalidFieldName,
} from './map/command-args';
export { HighlightManager } from './map/highlight-manager';
export { Selection } from './map/selection';
export type { SelectMode, SelectionDiff } from './map/selection';
export type {
  LayerSpecification,
  LayerType,
  LayerPaint,
  LayerLayout,
  FillPaint,
  LinePaint,
  CirclePaint,
} from './map/layer';
export { resolveStrokeStyle, resolvePointStyle } from './map/layer';
export * from './core/events';
export { DragPanHandler } from './core/drag-pan-handler';
export { MapshaperWorkerPool } from './core/mapshaper-worker-pool';
export type { MapshaperWorkerPoolOptions } from './core/mapshaper-worker-pool';
export * from './source/topology-source';
export type { ExportFormat, ExportOptions } from './source/source';
export * from './renderer/canvas-painter';
export * from './renderer/edit-overlay-renderer';
export * from './geo/bounds';
export { AffineTransform, AffineTransform as Transform } from './geo/transform';
export { Viewport } from './geo/viewport';
export { Projection } from './geo/projection';
export * from './ui/control';
export * from './ui/navigation-control';
export * from './ui/status-control';
export * from './ui/basemap-control';
export * from './ui/vertex-edit-control';
export * from './ui/edit-toolbar';
export * from './ui/draw-feature-control';
export * from './ui/history-control';
export * from './ui/box-select-control';
export * from './ui/lasso-select-control';
export type { EditCommand } from './edit/edit-command';
export { EditHistory } from './edit/edit-history';
export type { HistoryStateSnapshot, EditHistoryOptions } from './edit/edit-history';
export { VertexMoveCommand } from './edit/commands/vertex-move';
export { VertexInsertCommand } from './edit/commands/vertex-insert';
export { VertexDeleteCommand } from './edit/commands/vertex-delete';
export { FeatureCreateCommand } from './edit/commands/feature-create';
export { FeatureDeleteCommand, BulkFeatureDeleteCommand } from './edit/commands/feature-delete';
export type {
  FeatureDeleteCommandOptions,
  BulkFeatureDeleteCommandOptions,
} from './edit/commands/feature-delete';
export { FeatureTranslateCommand } from './edit/commands/feature-translate';
export type {
  FeatureTranslateCommandOptions,
  TranslatedPointFeature,
} from './edit/commands/feature-translate';
export { SplitSharedArcsCommand, planSharedArcSplit } from './edit/commands/split-shared-arcs';
export type {
  SplitSharedArcsCommandOptions,
  SplitSharedArcsRemap,
  AppendedArc,
} from './edit/commands/split-shared-arcs';
export {
  FeatureAffineCommand,
  rotateMatrix,
  scaleMatrix,
  invertMatrix,
  composeMatrix,
  IDENTITY_MATRIX,
} from './edit/commands/feature-affine';
export type {
  FeatureAffineCommandOptions,
  AffineMatrix,
} from './edit/commands/feature-affine';
export { CompositeCommand } from './edit/commands/composite';
export { DatasetReplaceCommand } from './edit/commands/dataset-replace';
export type { DatasetReplaceCommandOptions } from './edit/commands/dataset-replace';
export { FeaturePropertyChangeCommand } from './edit/commands/feature-property-change';
export type { FeaturePropertyChangeCommandOptions } from './edit/commands/feature-property-change';
export { FieldAddCommand } from './edit/commands/field-add';
export type { FieldAddCommandOptions } from './edit/commands/field-add';
export { FieldRemoveCommand } from './edit/commands/field-remove';
export type { FieldRemoveCommandOptions } from './edit/commands/field-remove';
export { FieldRenameCommand } from './edit/commands/field-rename';
export type { FieldRenameCommandOptions } from './edit/commands/field-rename';
export * from './types/mapshaper-types';

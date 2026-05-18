// Public entry point. Sections below match the conceptual layers documented
// in CLAUDE.md (`map.ts orchestrates → painters → sources → edit commands →
// UI controls`). Avoid `export *` — every public name is listed explicitly so
// tree-shaking is precise and the API surface stays auditable.

import './shim';
import 'mapshaper';

// ===========================================================================
// Core orchestrator + types
// ===========================================================================
export { Emap } from './map/map';
export type {
  MapOptions,
  // map options + view
  ExpressionEvaluationPolicy,
  // queries
  QueryFeaturesOptions,
  QueriedFeature,
  FeatureRef,
  HighlightFeatureRef,
  HighlightStyle,
  // edit sessions
  FeatureTranslateSession,
  FeatureAffineSession,
  DragSessionOptions,
  // mapshaper-op option records
  ClipEraseOptions,
  DissolveOptions,
  CleanOptions,
  BufferOptions,
  ApplyExpressionOptions,
  ExplodeOptions,
  InnerlinesOptions,
  FilterOptions,
  FilterIslandsOptions,
  FilterSliversOptions,
  FilterGeomOptions,
  AffineLayerOptions,
  DataFillOptions,
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
  // snapshot
  ExportSnapshotOptions,
  LoadSnapshotOptions,
} from './map/map';

// ===========================================================================
// Layers + selection + highlights
// ===========================================================================
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
export { HighlightManager } from './map/highlight-manager';
export { Selection } from './map/selection';
export type { SelectMode, SelectionDiff, SelectionSnapshot } from './map/selection';
export { FeatureQuery } from './map/feature-query';
export { FeatureAccessor } from './map/feature-accessor';
export type { Feature } from './map/feature-accessor';

// ===========================================================================
// Op-result + CLI safety helpers
// ===========================================================================
export { Err, OK, okValue } from './map/op-result';
export type { OpError, OpResult } from './map/op-result';
export {
  quoteCliArg,
  isValidLayerName,
  isValidFieldName,
  findInvalidFieldName,
} from './map/command-args';

// ===========================================================================
// Mapshaper / topology types (path / point shape vocabulary, ArcCollection,
// dataset shape). Re-exported so apps that build custom commands can type
// against the same shapes the engine uses.
// ===========================================================================
export type {
  ArcCollection,
  ArcIterator,
  ArcVertexData,
  Coord2,
  DataTable,
  FeatureShape,
  GeometryType,
  LegacyPointShape,
  MapshaperDataset,
  MapshaperLayer,
  PathGeometryType,
  PathLayer,
  PathPart,
  PathShape,
  PointLayer,
  PointShape,
  PointStyle,
  SignedArcId,
  StrokeStyle,
  VertexDotStyle,
} from './types/mapshaper-types';
export { isPathLayer, isPointLayer, bumpEditVersion } from './types/mapshaper-types';

// ===========================================================================
// Adapter + worker pool (low-level mapshaper bridges; advanced users only)
// ===========================================================================
export {
  DefaultMapshaperAdapter,
  getDefaultMapshaperAdapter,
  setDefaultMapshaperAdapter,
} from './adapter/mapshaper-adapter';
export type {
  ExportedFile,
  MapshaperAdapter,
  MapshaperBBox,
  PackedSession,
  RunnerInputFiles,
  SegmentIntersection,
} from './adapter/mapshaper-adapter';
export { MapshaperWorkerPool } from './core/mapshaper-worker-pool';
export type { MapshaperWorkerPoolOptions } from './core/mapshaper-worker-pool';

// ===========================================================================
// Sources / data loading
// ===========================================================================
export { TopologySource } from './source/topology-source';
export type {
  TopologySourceData,
  TopologySourceInput,
  TopologySourceOptions,
  TopologySourceFromBytesOptions,
  ZipExtractionLimits,
} from './source/topology-source';
export type { TopologySource as ITopologySource, ExportFormat, ExportOptions } from './source/source';

// ===========================================================================
// Geometry / projection
// ===========================================================================
export { Bounds } from './geo/bounds';
export { AffineTransform, AffineTransform as Transform } from './geo/transform';
export { Viewport } from './geo/viewport';
export { Projection } from './geo/projection';
export {
  DEFAULT_CRS,
  inferFromPrj,
  normalizeCrsString,
  resolveDatasetCRS,
} from './geo/crs-resolver';

// ===========================================================================
// Renderers
// ===========================================================================
export { CanvasPainter } from './renderer/canvas-painter';
export { EditOverlayRenderer } from './renderer/edit-overlay-renderer';

// ===========================================================================
// Core events + interactions
// ===========================================================================
export { EventDispatcher } from './core/events';
export type { EventListener } from './core/events';
export { HandlerManager } from './core/handler-manager';
export { isHandler } from './core/handler';
export type { Handler, HandlerResult, NormalizedPointerEvent, PointerModifiers } from './core/handler';
export { DragPanHandler } from './core/handlers/drag-pan';
export type { DragPanOptions } from './core/handlers/drag-pan';
export { ScrollZoomHandler } from './core/handlers/scroll-zoom';
export type { ScrollZoomOptions } from './core/handlers/scroll-zoom';
export { ClickSelectHandler } from './core/handlers/click-select';
export type { SelectHandlerOptions } from './core/handlers/click-select';
export { BoxSelectHandler } from './core/handlers/box-select';
export type { BoxSelectHandlerOptions } from './core/handlers/box-select';
export { LassoSelectHandler } from './core/handlers/lasso-select';
export type { LassoSelectHandlerOptions, LassoStyle } from './core/handlers/lasso-select';
export { resolveMode } from './core/handlers/select-mode';
export type { ModifierCombo } from './core/handlers/select-mode';
export type { FeatureEvent, FeatureEventFilter } from './core/feature-event-dispatcher';
export { VertexEditHandler } from './core/handlers/vertex-edit';
export type { VertexEditOptions } from './core/handlers/vertex-edit';
export { DrawFeatureHandler } from './core/handlers/draw-feature';
export type { DrawFeatureOptions } from './core/handlers/draw-feature';
export { TransformFeatureHandler } from './core/handlers/transform-feature';
export type { TransformFeatureOptions } from './core/handlers/transform-feature';

// ===========================================================================
// Edit history + commands
// ===========================================================================
export type { EditCommand } from './edit/edit-command';
export { EditHistory } from './edit/edit-history';
export type { HistoryStateSnapshot, EditHistoryOptions } from './edit/edit-history';
export { Transaction } from './edit/transaction';

// ===========================================================================
// Validation (post-edit hooks for GIS / attribute constraints)
// ===========================================================================
export { ValidatorRegistry } from './validation/registry';
export type {
  Validator,
  ValidatorPhase,
  ValidatorResult,
  ValidationChange,
  ValidationIssue,
  ValidationReport,
} from './validation/validator';
export { topologyValidator } from './validation/builtin/topology';
export type { TopologyValidatorOptions } from './validation/builtin/topology';

// vertex-level
export { VertexMoveCommand } from './edit/commands/vertex-move';
export { VertexInsertCommand } from './edit/commands/vertex-insert';
export { VertexDeleteCommand } from './edit/commands/vertex-delete';

// feature-level
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

// topology-level
export { SplitSharedArcsCommand, planSharedArcSplit } from './edit/commands/split-shared-arcs';
export type {
  SplitSharedArcsCommandOptions,
  SplitSharedArcsRemap,
  AppendedArc,
} from './edit/commands/split-shared-arcs';

// dataset-replace + composite envelope
export { CompositeCommand } from './edit/commands/composite';
export { DatasetReplaceCommand } from './edit/commands/dataset-replace';
export type { DatasetReplaceCommandOptions } from './edit/commands/dataset-replace';

// attribute / schema commands
export { FeaturePropertyChangeCommand } from './edit/commands/feature-property-change';
export type { FeaturePropertyChangeCommandOptions } from './edit/commands/feature-property-change';
export { FieldAddCommand } from './edit/commands/field-add';
export type { FieldAddCommandOptions } from './edit/commands/field-add';
export { FieldRemoveCommand } from './edit/commands/field-remove';
export type { FieldRemoveCommandOptions } from './edit/commands/field-remove';
export { FieldRenameCommand } from './edit/commands/field-rename';
export type { FieldRenameCommandOptions } from './edit/commands/field-rename';

// ===========================================================================
// UI controls
// ===========================================================================
export type { Control, ControlPosition } from './ui/control';
export { NavigationControl } from './ui/navigation-control';
export type { NavigationOptions } from './ui/navigation-control';
export { StatusControl } from './ui/status-control';
export type { StatusOptions } from './ui/status-control';
export { BasemapControl } from './ui/basemap-control';
export type { BasemapOptions, BasemapStyle } from './ui/basemap-control';
export { VertexEditControl } from './ui/vertex-edit-control';
export type { VertexEditControlOptions } from './ui/vertex-edit-control';
export { EditToolbar } from './ui/edit-toolbar';
export type { EditToolbarOptions } from './ui/edit-toolbar';
export { DrawFeatureControl } from './ui/draw-feature-control';
export type { DrawFeatureControlOptions, DrawGeometryType } from './ui/draw-feature-control';
export { HistoryControl } from './ui/history-control';
export type { HistoryControlOptions } from './ui/history-control';
export { BoxSelectControl } from './ui/box-select-control';
export type { BoxSelectControlOptions, BoxSelectStyle } from './ui/box-select-control';
export {
  LassoSelectControl,
  pointInPolygon,
  featureMatchesLasso,
} from './ui/lasso-select-control';
export type { LassoSelectControlOptions, LassoSelectStyle } from './ui/lasso-select-control';
export { SimplifyControl } from './ui/simplify-control';
export type { SimplifyControlOptions } from './ui/simplify-control';

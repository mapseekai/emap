/**
 * @module emap
 */

// Public entry point. Sections below match the conceptual layers documented
// in AGENTS.md and README.md (`map.ts orchestrates → painters → sources → edit commands →
// UI controls`). Avoid `export *` — every public name is listed explicitly so
// tree-shaking is precise and the API surface stays auditable.

import './integrations/mapshaper/browser-shim';

// ===========================================================================
// Core orchestrator + types
// ===========================================================================
export { Emap } from './engine/map/map';
export type { CreateLayerOptions, LayerFieldDefinition } from './domain/source/create-layer';
export type {
  MapOptions,
  // map options + view
  ExpressionEvaluationPolicy,
  // queries
  QueryFeaturesOptions,
  QueriedFeature,
  FeatureRef,
  HighlightStyle,
  // edit sessions
  FeatureTranslateSession,
  FeatureAffineSession,
  DragSessionOptions,
  // mapshaper-op option records
  ClipEraseOptions,
  DissolveOptions,
  MergeSelectedOptions,
  SplitCutter,
  SplitSelectedOptions,
  SplitSelectedResult,
  SplitFeatureOptions,
  ReshapeSelectedOptions,
  ReshapeSelectedResult,
  AddRingOptions,
  DeleteRingOptions,
  FillRingOptions,
  AddPartOptions,
  DeletePartOptions,
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
  ProjectLayerOutputOptions,
  ProjectLayerExport,
  RebuildTopologyOptions,
  RenameLayerOptions,
  MergeLayersOptions,
  SplitLayerOptions,
  DropLayerOptions,
  SortFeaturesOptions,
  UniqueFeaturesOptions,
  FilterFieldsOptions,
  RenameFieldsOptions,
  ClassifyFeaturesOptions,
  ClassificationResult,
  JoinTableOptions,
  JoinTableData,
  CheckGeometryOptions,
  GeometryCheckReport,
  IntersectionPointsLayerOptions,
  // snapshot
  ExportSnapshotOptions,
  LoadSnapshotOptions,
} from './engine/map/map';
export type { VisibleLayerLookup } from './engine/map/structured-keys';
export type {
  MapLibreService,
  MapLibreBasemapService,
  MapLibreOverlayServiceBase,
  MapLibreOverlayResourceService,
  MapLibreOverlayStyleService,
  MapLibreOverlayService,
  MapLibreIntegrationOptions,
  MapLibreServiceState,
  MapLibreServiceChangeReason,
  MapLibreServiceChangeEvent,
  MapLibreServiceErrorEvent,
  MapLibreServiceEventMap,
  MapLibreServiceManager,
} from './integrations/maplibre/maplibre-service';

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
} from './engine/map/layer';
export { resolveStrokeStyle, resolvePointStyle } from './engine/map/layer';
export type { StyleExpression } from './engine/map/style-expression';
export { HighlightManager } from './engine/map/highlight-manager';
export { Selection } from './engine/map/selection';
export type { SelectMode, SelectionDiff, SelectionSnapshot } from './engine/map/selection';
export { FeatureQuery } from './engine/map/feature-query';
export { FeatureAccessor } from './engine/map/feature-accessor';
export type { Feature } from './engine/map/feature-accessor';

// ===========================================================================
// Op-result + CLI safety helpers
// ===========================================================================
export { Err, OK, okValue } from './engine/map/op-result';
export type { OpError, OpResult } from './engine/map/op-result';
export { isValidFieldName, findInvalidFieldName } from './engine/map/command-args';

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
  PointMarkerShape,
  ReadonlyArcCollection,
  ReadonlyArcVertexData,
  ReadonlyCoord2,
  ReadonlyDataTable,
  ReadonlyFeatureShape,
  ReadonlyMapshaperDataset,
  ReadonlyMapshaperLayer,
  ReadonlyNumericArray,
  ReadonlyPathPart,
  ReadonlyPathShape,
  ReadonlyPointShape,
  PointStyle,
  SignedArcId,
  LineDashStyle,
  StrokeStyle,
  VertexDotStyle,
} from './shared/types/mapshaper-types';
export {
  isPathLayer,
  isPointLayer,
  bumpEditVersion,
  bumpAttributeVersion,
} from './shared/types/mapshaper-types';

// ===========================================================================
// Adapter + worker pool (low-level mapshaper bridges; advanced users only)
// ===========================================================================
export {
  DefaultMapshaperAdapter,
  getDefaultMapshaperAdapter,
  setDefaultMapshaperAdapter,
} from './integrations/mapshaper/adapter';
export type {
  ArcCutPoint,
  ExportedFile,
  MapshaperAdapter,
  MapshaperBBox,
  PackedSession,
  RunnerInputFiles,
  SegmentIntersection,
} from './integrations/mapshaper/adapter';
export { MapshaperWorkerPool } from './engine/core/mapshaper-worker-pool';
export type { MapshaperWorkerPoolOptions } from './engine/core/mapshaper-worker-pool';

// ===========================================================================
// Sources / data loading
// ===========================================================================
export { TopologySource } from './domain/source/topology-source';
export type {
  TopologySourceData,
  TopologySourceInput,
  TopologySourceOptions,
  TopologySourceFromBytesOptions,
  ZipExtractionLimits,
} from './domain/source/topology-source';
export type { ImportResourceLimits } from './shared/import-resource-limits';
export type {
  TopologySource as ITopologySource,
  ReplaceableTopologySource,
  ExportFormat,
  ExportOptions,
} from './domain/source/source';
export { SourceLoadError } from './engine/map/source-loading';
export type {
  ReadySourceLoadPlan,
  SourceLoadAnswers,
  SourceLoadDiagnostic,
  SourceLoadDiagnosticCode,
  SourceLoadDraft,
  SourceLoadRequest,
  SourceLoadRequirement,
  SourceLoadSummary,
  SourcePreflightResult,
} from './engine/map/source-loading';
// Format-plugin registry (the optional `@mapseekai/emap/arrow` bundle
// registers GeoParquet / GeoArrow support through this; arrow-free).
export { FormatRegistry, registerFormat } from './domain/source/format-registry';
export type { FormatRegistryContract } from './runtime/services/formats';
export type { DatasetFormatPlugin, ExportedFormatFile } from './domain/source/format-registry';

// ===========================================================================
// Geometry / projection
// ===========================================================================
export { Bounds } from './domain/geo/bounds';
export { AffineTransform, AffineTransform as Transform } from './domain/geo/transform';
export { Viewport } from './domain/geo/viewport';
export { Projection } from './domain/geo/projection';
export type {
  GetScaleMetricsOptions,
  ScaleCalculationMethod,
  ScaleMetrics,
  ScaleViewMetrics,
} from './domain/geo/scale-calculator';
export type { MeasurementMode } from './domain/geo/measurement';
export {
  DEFAULT_CRS,
  inferFromPrj,
  normalizeCrsString,
  resolveDatasetCRS,
  setDatasetCrsMetadata,
} from './domain/geo/crs-resolver';

// ===========================================================================
// Renderers
// ===========================================================================
export { CanvasPainter } from './engine/rendering/canvas-painter';
export type { ArrowDotPathOptions } from './engine/rendering/painter';
export { EditOverlayRenderer } from './engine/rendering/edit-overlay-renderer';

// ===========================================================================
// Core events + interactions
// ===========================================================================
export { EventDispatcher } from './engine/core/events';
export type { EventListener } from './engine/core/events';
export type {
  EmapEventMap,
  CameraEvent,
  LayerChangeReason,
  LayerChangeEvent,
} from './engine/core/event-map';
export type {
  CameraOptions,
  AnimationOptions,
  FlyToOptions,
  FitBoundsOptions,
} from './domain/geo/camera';
export { HandlerManager } from './engine/core/handler-manager';
export { isHandler } from './engine/core/handler';
export type {
  Handler,
  HandlerResult,
  NormalizedPointerEvent,
  PointerModifiers,
} from './engine/core/handler';
export { DragPanHandler } from './engine/core/handlers/drag-pan';
export type { DragPanOptions } from './engine/core/handlers/drag-pan';
export { ScrollZoomHandler } from './engine/core/handlers/scroll-zoom';
export type { ScrollZoomOptions } from './engine/core/handlers/scroll-zoom';
export { ClickSelectHandler } from './engine/core/handlers/click-select';
export type { SelectHandlerOptions } from './engine/core/handlers/click-select';
export { BoxSelectHandler } from './engine/core/handlers/box-select';
export type { BoxSelectHandlerOptions } from './engine/core/handlers/box-select';
export { LassoSelectHandler } from './engine/core/handlers/lasso-select';
export type { LassoSelectHandlerOptions } from './engine/core/handlers/lasso-select';
export { resolveMode } from './engine/core/handlers/select-mode';
export type { ModifierCombo } from './engine/core/handlers/select-mode';
export type { FeatureEvent, FeatureEventFilter } from './engine/core/feature-event-dispatcher';
export type { PointerMoveEvent } from './engine/core/pointer-event-dispatcher';
export { VertexEditHandler } from './engine/core/handlers/vertex-edit';
export type { VertexEditOptions } from './engine/core/handlers/vertex-edit';
export { DrawFeatureHandler } from './engine/core/handlers/draw-feature';
export type { DrawFeatureOptions } from './engine/core/handlers/draw-feature';
export { SplitFeatureHandler } from './engine/core/handlers/split-feature';
export { ReshapeFeatureHandler } from './engine/core/handlers/reshape-feature';
export { AutoCompletePolygonHandler } from './engine/core/handlers/auto-complete-polygon';
export type { AutoCompletePolygonOptions, AutoCompletePolygonResult } from './engine/map/types';
export type { ReshapeFeatureOptions } from './engine/core/handlers/reshape-feature';
export { RingEditHandler } from './engine/core/handlers/ring-edit';
export type { RingEditOptions } from './engine/core/handlers/ring-edit';
export { PartEditHandler } from './engine/core/handlers/part-edit';
export type { PartEditOptions } from './engine/core/handlers/part-edit';
export { MeasureHandler } from './engine/core/handlers/measure';
export type { MeasureOptions, MeasureResult } from './engine/core/handlers/measure';
export { TransformFeatureHandler } from './engine/core/handlers/transform-feature';
export type { TransformFeatureOptions } from './engine/core/handlers/transform-feature';

// ===========================================================================
// Edit history + commands
// ===========================================================================
export type { EditCommand } from './domain/edit/edit-command';
export { EditHistory } from './domain/edit/edit-history';
export type { HistoryStateSnapshot, EditHistoryOptions } from './domain/edit/edit-history';
export { Transaction } from './domain/edit/transaction';

// ===========================================================================
// Validation (post-edit hooks for GIS / attribute constraints)
// ===========================================================================
export { ValidatorRegistry } from './domain/validation/registry';
export type {
  Validator,
  ValidatorPhase,
  ValidatorResult,
  ValidationChange,
  ValidationIssue,
  ValidationReport,
} from './domain/validation/validator';
export { topologyValidator } from './domain/validation/builtin/topology';
export type { TopologyValidatorOptions } from './domain/validation/builtin/topology';

// vertex-level
export { VertexMoveCommand } from './domain/edit/commands/vertex-move';
export { VertexInsertCommand } from './domain/edit/commands/vertex-insert';
export { VertexDeleteCommand } from './domain/edit/commands/vertex-delete';

// feature-level
export { FeatureCreateCommand } from './domain/edit/commands/feature-create';
export { FeatureAppendCommand } from './domain/edit/commands/feature-append';
export type { FeatureAppendCommandOptions } from './domain/edit/commands/feature-append';
export {
  FeatureDeleteCommand,
  BulkFeatureDeleteCommand,
} from './domain/edit/commands/feature-delete';
export type {
  FeatureDeleteCommandOptions,
  BulkFeatureDeleteCommandOptions,
} from './domain/edit/commands/feature-delete';
export { FeatureTranslateCommand } from './domain/edit/commands/feature-translate';
export type {
  FeatureTranslateCommandOptions,
  TranslatedPointFeature,
} from './domain/edit/commands/feature-translate';
export {
  FeatureAffineCommand,
  rotateMatrix,
  scaleMatrix,
  invertMatrix,
  composeMatrix,
  IDENTITY_MATRIX,
} from './domain/edit/commands/feature-affine';
export type {
  FeatureAffineCommandOptions,
  AffineMatrix,
} from './domain/edit/commands/feature-affine';

// topology-level
export {
  SplitSharedArcsCommand,
  planSharedArcSplit,
} from './domain/edit/commands/split-shared-arcs';
export type {
  SplitSharedArcsCommandOptions,
  SplitSharedArcsRemap,
  AppendedArc,
} from './domain/edit/commands/split-shared-arcs';
export {
  SplitSharedNodeCommand,
  planSharedNodeSplit,
} from './domain/edit/commands/split-shared-node';
export type { SplitSharedNodePlan } from './domain/edit/commands/split-shared-node';

// dataset-replace + composite envelope
export { CompositeCommand } from './domain/edit/commands/composite';
export { DatasetReplaceCommand } from './domain/edit/commands/dataset-replace';
export type { DatasetReplaceCommandOptions } from './domain/edit/commands/dataset-replace';

// attribute / schema commands
export { FeaturePropertyChangeCommand } from './domain/edit/commands/feature-property-change';
export type { FeaturePropertyChangeCommandOptions } from './domain/edit/commands/feature-property-change';
export { FieldAddCommand } from './domain/edit/commands/field-add';
export type { FieldAddCommandOptions } from './domain/edit/commands/field-add';
export { FieldRemoveCommand } from './domain/edit/commands/field-remove';
export type { FieldRemoveCommandOptions } from './domain/edit/commands/field-remove';
export { FieldRenameCommand } from './domain/edit/commands/field-rename';
export type { FieldRenameCommandOptions } from './domain/edit/commands/field-rename';

// ===========================================================================
// UI controls
// ===========================================================================
export type { Control, ControlPosition } from './ui/control';
export { NavigationControl } from './ui/navigation-control';
export type { NavigationOptions } from './ui/navigation-control';
export { StatusControl } from './ui/status-control';
export type { StatusOptions } from './ui/status-control';
export { ScaleControl } from './ui/scale-control';
export type { ScaleControlOptions, ScaleControlStyle } from './ui/scale-control';
export { BasemapControl } from './ui/basemap-control';
export type { BasemapOptions, BasemapStyle } from './ui/basemap-control';
export { LayerControl } from './ui/layer-control';
export { VertexEditControl } from './ui/vertex-edit-control';
export type { VertexEditControlOptions } from './ui/vertex-edit-control';
export { EditToolbar } from './ui/edit-toolbar';
export type { EditToolbarOptions } from './ui/edit-toolbar';
export { DrawFeatureControl } from './ui/draw-feature-control';
export type { DrawFeatureControlOptions, DrawGeometryType } from './ui/draw-feature-control';
export { MeasureControl } from './ui/measure-control';
export type { MeasureControlOptions } from './ui/measure-control';
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

export type { EmapOptions } from './runtime/services/options';
export type {
  CapabilityDescriptor,
  CapabilityAuthorizer,
  CapabilityRegistryContract,
} from './runtime/services/capabilities';

export type { FeatureReadContext } from './engine/map/feature-accessor';
export type { HandlerRegistration } from './engine/core/handler-manager';

export { Context, Service, Fiber } from 'cordis';
export type { Plugin } from 'cordis';
export { inspectContext, inspectServices } from './runtime/context/inspection';
export { settleContext } from './runtime/context/settle';

export type { RendererBackend } from './engine/map/renderer';
export type { IconOptions } from './engine/map/icon';
export type {
  SymbolStyle,
  SymbolLayout,
  SymbolPaint,
  SymbolImage,
  SymbolLabeling,
  SymbolIconSettings,
} from './engine/map/symbol';
export type { LabelOptions } from './engine/map/label';

export { createEmapWorkerRuntime } from './integrations/tasklane/runtime';
export type { EmapWorkerRuntimeOptions, EmapWorkerPool } from './integrations/tasklane/runtime';

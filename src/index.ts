import './shim';
import 'mapshaper';

export { Emap } from './map/map';
export type {
  QueryRenderedFeaturesOptions,
  RenderedFeatureAttributes,
  FeatureRef,
  HighlightFeatureRef,
  HighlightStyle,
  ClipEraseOptions,
  DissolveOptions,
  BufferOptions,
  ApplyExpressionOptions,
  ExplodeOptions,
} from './map/map';
export { FeatureQuery } from './map/feature-query';
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
export * from './source/topology-source';
export type { ExportFormat, ExportOptions } from './source/source';
export * from './renderer/canvas-painter';
export * from './renderer/canvaskit-painter';
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
export type { EditCommand } from './edit/edit-command';
export { EditHistory } from './edit/edit-history';
export type { HistoryStateSnapshot, EditHistoryOptions } from './edit/edit-history';
export { VertexMoveCommand } from './edit/commands/vertex-move';
export { VertexInsertCommand } from './edit/commands/vertex-insert';
export { VertexDeleteCommand } from './edit/commands/vertex-delete';
export { FeatureCreateCommand } from './edit/commands/feature-create';
export { FeatureDeleteCommand } from './edit/commands/feature-delete';
export type { FeatureDeleteCommandOptions } from './edit/commands/feature-delete';
export { FeatureTranslateCommand } from './edit/commands/feature-translate';
export type {
  FeatureTranslateCommandOptions,
  TranslatedPointFeature,
} from './edit/commands/feature-translate';
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

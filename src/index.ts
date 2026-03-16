import './shim';
import 'mapshaper';

export { Emap } from './map/map';
export type {
  QueryRenderedFeaturesOptions,
  RenderedFeatureAttributes,
  HighlightFeatureRef,
  HighlightStyle
} from './map/map';
export { FeatureQuery } from './map/feature-query';
export { HighlightManager } from './map/highlight-manager';
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
export * from './types/mapshaper-types';

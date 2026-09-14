import type { EmapEventMap } from '../../engine/core/event-map';
import { type EventListener } from '../../engine/core/events';
import {
  type FeatureEvent,
  type FeatureEventFilter,
} from '../../engine/core/feature-event-dispatcher';
import type { Handler } from '../../engine/core/handler';
import { type BoxSelectHandlerOptions } from '../../engine/core/handlers/box-select';
import { type DrawFeatureOptions } from '../../engine/core/handlers/draw-feature';
import { type LassoSelectHandlerOptions } from '../../engine/core/handlers/lasso-select';
import { MeasureHandler } from '../../engine/core/handlers/measure';
import { type PartEditOptions } from '../../engine/core/handlers/part-edit';
import { type ReshapeFeatureOptions } from '../../engine/core/handlers/reshape-feature';
import { type RingEditOptions } from '../../engine/core/handlers/ring-edit';
import { type VertexEditOptions } from '../../engine/core/handlers/vertex-edit';
import { type PointerMoveEvent } from '../../engine/core/pointer-event-dispatcher';
import {
  type GetScaleMetricsOptions,
  type ScaleViewMetrics,
} from '../../domain/geo/scale-calculator';
import { type LayerSpecification } from '../../engine/map/layer';
import type { MapLibreServiceManager } from '../../integrations/maplibre/maplibre-service';
import { MapshaperOps } from '../../engine/map/mapshaper-ops';

/** The bounded API offered to controls; never the Emap implementation. */
export interface ControlContext {
  readonly autoCompletePolygon: Handler<ReshapeFeatureOptions>;
  readonly boxSelect: Handler<BoxSelectHandlerOptions>;
  canRedo(): boolean;
  canUndo(): boolean;
  readonly drawFeature: Handler<DrawFeatureOptions>;
  fire<T = Record<string, unknown>>(type: string, data?: T): this;
  getCRS(): string;
  getRenderedLayers(): readonly LayerSpecification[];
  getScaleMetrics(options?: GetScaleMetricsOptions): Promise<ScaleViewMetrics | null>;
  readonly lassoSelect: Handler<LassoSelectHandlerOptions>;
  readonly mapLibreServices: MapLibreServiceManager;
  readonly measure: Pick<MeasureHandler, keyof MeasureHandler>;
  off(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  off<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;
  off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  off(type: string, listener: (e: FeatureEvent) => void): this;
  on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  on<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;
  on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  on(type: string, listener: (e: FeatureEvent) => void): this;
  on(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;
  readonly ops: Pick<MapshaperOps, 'simplifyLayer'>;
  readonly partEdit: Handler<PartEditOptions>;
  redo(): boolean;
  readonly reshapeFeature: Handler<ReshapeFeatureOptions>;
  readonly ringEdit: Handler<RingEditOptions>;
  setLayerVisibility(id: string, visibility: 'visible' | 'none'): void;
  undo(): boolean;
  readonly vertexEdit: Handler<VertexEditOptions>;
  zoomIn(): void;
  zoomOut(): void;
}

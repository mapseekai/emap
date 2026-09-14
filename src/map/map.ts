import { CapabilityService } from '../services/capabilities';
import { FormatService } from '../services/formats';
import { SourceLoadError } from './source-loading';
import type { EmapEventMap } from '../core/event-map';
import { EventDispatcher, type EventListener } from '../core/events';
import { type FeatureEvent, type FeatureEventFilter } from '../core/feature-event-dispatcher';
import type { Handler } from '../core/handler';
import { type BoxSelectHandlerOptions } from '../core/handlers/box-select';
import { type SelectHandlerOptions } from '../core/handlers/click-select';
import type { DragPanOptions } from '../core/handlers/drag-pan';
import { type DrawFeatureOptions } from '../core/handlers/draw-feature';
import { type LassoSelectHandlerOptions } from '../core/handlers/lasso-select';
import { MeasureHandler } from '../core/handlers/measure';
import { type PartEditOptions } from '../core/handlers/part-edit';
import { type ReshapeFeatureOptions } from '../core/handlers/reshape-feature';
import { type RingEditOptions } from '../core/handlers/ring-edit';
import type { ScrollZoomOptions } from '../core/handlers/scroll-zoom';
import { type SplitFeatureOptions } from '../core/handlers/split-feature';
import { type TransformFeatureOptions } from '../core/handlers/transform-feature';
import { type VertexEditOptions } from '../core/handlers/vertex-edit';
import { type PointerMoveEvent } from '../core/pointer-event-dispatcher';
import type { EditCommand } from '../edit/edit-command';
import { Transaction } from '../edit/transaction';
import { Bounds } from '../geo/bounds';
import {
  type AnimationOptions,
  type CameraOptions,
  type FitBoundsOptions,
  type FlyToOptions,
} from '../geo/camera';
import { type GetScaleMetricsOptions, type ScaleViewMetrics } from '../geo/scale-calculator';
import { AffineTransform } from '../geo/transform';
import type { Plugin } from '../kernel/plugin';
import { PluginRuntime } from '../kernel/runtime';
import type { ServiceKey, ServiceResolver } from '../kernel/service';
import {
  autoCompletePolygonService,
  boxSelectService,
  clickSelectService,
  dragPanService,
  drawFeatureService,
  lassoSelectService,
  measureService,
  partEditService,
  reshapeFeatureService,
  ringEditService,
  scrollZoomService,
  splitFeatureService,
  transformFeatureService,
  vertexEditService,
} from '../plugins/interactions/keys';
import { resolvePlugins } from '../presets';
import { optionsPlugin } from '../providers/workspace/base-plugins';
import type { DrawOverlayState, MeasurementOverlayState } from '../renderer/painter';
import {
  AttributeService,
  CacheService,
  ControlsService,
  DocumentService,
  EditSessionService,
  EditStateService,
  EventService,
  ExecutionService,
  HistoryService,
  LayerService,
  MapLibreService,
  MapshaperProcessingService,
  MutationService,
  PolicyService,
  ProjectionService,
  QueryService,
  RenderService,
  RoutingService,
  ScaleService,
  SelectionService,
  ShortcutsService,
  SnapshotService,
  SourceService,
  SurfaceService,
  ValidationService,
  ViewService,
} from '../services/keys';
import type { EmapOptions } from '../services/options';
import type { CreateLayerOptions } from '../source/create-layer';
import { type TopologySource } from '../source/source';
import { TopologySource as ConcreteTopologySource } from '../source/topology-source';
import type { Control, ControlPosition } from '../ui/control';
import { ValidatorRegistry } from '../validation/registry';
import { AttributeOps } from './attribute-ops';
import { EditSessions } from './edit-sessions';
import { type EditMode } from './edit-state-store';
import { FeatureAccessor } from './feature-accessor';
import { type LayerSpecification } from './layer';
import { LayerRegistry } from './layer-registry';
import type { MapLibreServiceManager } from './maplibre-service';
import { MapshaperOps } from './mapshaper-ops';
import { type SelectMode } from './selection';
import {
  type ReadySourceLoadPlan,
  type SourceLoadAnswers,
  type SourceLoadDraft,
  type SourceLoadRequest,
  type SourcePreflightResult,
} from './source-loading';
import { type StyleExpression } from './style-expression';
import {
  type EditVertexState,
  type ExportSnapshotOptions,
  type ExpressionEvaluationPolicy,
  type FeatureRef,
  type HighlightStyle,
  type LoadSnapshotOptions,
  type QueriedFeature,
  type QueryFeaturesOptions,
  type RenderRequest,
} from './types';

export type { EmapOptions } from '../services/options';
export type * from './source-loading';
export * from './types';

/** Public GIS façade. Every capability is obtained from the mounted plugin graph. */
export class Emap extends EventDispatcher {
  readonly runtime: PluginRuntime;
  private _closed = false;
  private _disposal?: Promise<void>;

  constructor(options: EmapOptions = {}) {
    super();
    this.runtime = new PluginRuntime();
    const config = Object.freeze({
      ...options,
      plugins: Object.freeze([...(options.plugins ?? [])]),
      excludePlugins: Object.freeze([...(options.excludePlugins ?? [])]),
    });
    try {
      this.runtime.mount([optionsPlugin(config), ...resolvePlugins(config)]);
      this.runtime.assertReady();
      if (config.mapLibre && !this.services.has(MapLibreService)) {
        throw new Error(
          'mapLibre options require the explicit mapLibrePlugin from @mapseekai/emap/maplibre',
        );
      }
    } catch (error) {
      void this.runtime.dispose().catch(() => undefined);
      throw error;
    }
  }

  get services(): ServiceResolver {
    return this.runtime.services;
  }

  /** Install additional functionality without modifying the engine façade. */
  get controls() {
    return this.services.get(ControlsService);
  }

  get capabilities() {
    return this.services.get(CapabilityService);
  }

  get formats() {
    return this.services.get(FormatService);
  }

  use(plugin: Plugin): this {
    this.runtime.use(plugin);
    return this;
  }

  getService<T>(key: ServiceKey<T>): T {
    return this.services.get(key);
  }

  private _eventTarget(
    type: string,
  ):
    | EventDispatcher
    | Pick<import('../services/contracts/routing').RoutingContract, 'on' | 'off' | 'once'> {
    return type === 'mousemove' || type.startsWith('feature:')
      ? this.services.get(RoutingService)
      : this.services.get(EventService);
  }

  fire<T = Record<string, unknown>>(type: string, data?: T): this {
    if (!this.runtime?.isDisposed && this.services.has(EventService))
      this.services.get(EventService).fire(type, data);
    return this;
  }

  /** Immediately unregister effects; use dispose() to also observe asynchronous cleanup. */
  remove(): void {
    if (this._closed) return;
    this._closed = true;
    const events = this.services.has(EventService) ? this.services.get(EventService) : undefined;
    if (this.services.has(DocumentService)) this.services.get(DocumentService)._removed = true;
    this._disposal = this.runtime.dispose();
    void this._disposal.catch((error) => events?.fire('error', { error }));
  }

  async dispose(): Promise<void> {
    this.remove();
    await this._disposal;
  }
  get layers(): LayerRegistry {
    return this.services.get(DocumentService).layers;
  }

  get features(): FeatureAccessor {
    return this.services.get(QueryService).features;
  }

  public cancelWorkerJobs(): void {
    return this.services.get(ExecutionService).cancelWorkerJobs();
  }

  public setExpressionPolicy(policy: ExpressionEvaluationPolicy): void {
    return this.services.get(PolicyService).setExpressionPolicy(policy);
  }

  public getExpressionPolicy(): ExpressionEvaluationPolicy {
    return this.services.get(PolicyService).getExpressionPolicy();
  }

  on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;

  on<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;

  on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;

  on(type: string, listener: (e: FeatureEvent) => void): this;

  on(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;

  on(type: string, filterOrListener: unknown, listener?: unknown): this {
    const target = this._eventTarget(type);
    Reflect.apply(target.on, target, [type, filterOrListener, listener]);
    return this;
  }

  off(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;

  off<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;

  off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;

  off(type: string, listener: (e: FeatureEvent) => void): this;

  off(type: string, listener: unknown): this {
    const target = this._eventTarget(type);
    Reflect.apply(target.off, target, [type, listener]);
    return this;
  }

  once(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;

  once<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;

  once<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;

  once(type: string, listener: (e: FeatureEvent) => void): this;

  once(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;

  once(type: string, filterOrListener: unknown, listener?: unknown): this {
    const target = this._eventTarget(type);
    Reflect.apply(target.once, target, [type, filterOrListener, listener]);
    return this;
  }

  public getCanvasContainer(): HTMLElement {
    return this.services.get(SurfaceService).getCanvasContainer();
  }

  public getEditMode(): EditMode {
    return this.services.get(EditStateService).getEditMode();
  }

  public setEditMode(mode: EditMode): void {
    return this.services.get(EditStateService).setEditMode(mode);
  }

  public setEditVertexState(state: EditVertexState): void {
    return this.services.get(EditStateService).setEditVertexState(state);
  }

  public clearEditVertexState(): void {
    return this.services.get(EditStateService).clearEditVertexState();
  }

  public setEditDrawState(state: DrawOverlayState): void {
    return this.services.get(EditStateService).setEditDrawState(state);
  }

  public clearEditDrawState(): void {
    return this.services.get(EditStateService).clearEditDrawState();
  }

  public setEditMeasurementState(state: MeasurementOverlayState): void {
    return this.services.get(EditStateService).setEditMeasurementState(state);
  }

  public clearEditMeasurementState(): void {
    return this.services.get(EditStateService).clearEditMeasurementState();
  }

  public async preflightSource(request: SourceLoadRequest): Promise<SourcePreflightResult>;

  public async preflightSource(
    draft: SourceLoadDraft,
    answers: SourceLoadAnswers,
  ): Promise<SourcePreflightResult>;

  public async preflightSource(
    requestOrDraft: SourceLoadRequest | SourceLoadDraft,
    answers: SourceLoadAnswers = {},
  ): Promise<SourcePreflightResult> {
    const service = this.services.get(SourceService);
    return Reflect.apply(service.preflightSource, service, [requestOrDraft, answers]);
  }

  public async addSource(
    id: string,
    source: TopologySource,
    answers: SourceLoadAnswers = {},
  ): Promise<void> {
    return this.services.get(SourceService).addSource(id, source, answers);
  }

  public async createLayer(
    id: string,
    options: CreateLayerOptions,
  ): Promise<ConcreteTopologySource> {
    return this.services.get(SourceService).createLayer(id, options);
  }

  public async confirmSource(plan: ReadySourceLoadPlan): Promise<void> {
    if (this._closed)
      throw new SourceLoadError('source-load-cancelled', [
        {
          code: 'source-load-cancelled',
          severity: 'error',
          message: 'Cannot confirm a source after map removal',
        },
      ]);
    return this.services.get(SourceService).confirmSource(plan);
  }

  public removeSource(id: string): void {
    return this.services.get(SourceService).removeSource(id);
  }

  public getSource(id: string): TopologySource | undefined {
    return this._closed ? undefined : this.services.get(SourceService).getSource(id);
  }

  public async exportSnapshot(opts: ExportSnapshotOptions = {}): Promise<Blob> {
    return this.services.get(SnapshotService).exportSnapshot(opts);
  }

  public async loadSnapshot(
    input: Blob | Uint8Array | ArrayBuffer,
    opts: LoadSnapshotOptions = {},
  ): Promise<string[]> {
    return this.services.get(SnapshotService).loadSnapshot(input, opts);
  }

  public addLayer(layer: LayerSpecification, before?: string): void {
    return this.services.get(LayerService).addLayer(layer, before);
  }

  public removeLayer(id: string): void {
    return this.services.get(LayerService).removeLayer(id);
  }

  public getLayer(id: string): LayerSpecification | undefined {
    return this.services.get(LayerService).getLayer(id);
  }

  public getLayers(): readonly LayerSpecification[] {
    return this.services.get(LayerService).getLayers();
  }

  public getRenderedLayers(): readonly LayerSpecification[] {
    return this.services.get(LayerService).getRenderedLayers();
  }

  public setLayerVisibility(id: string, visibility: 'visible' | 'none'): void {
    return this.services.get(LayerService).setLayerVisibility(id, visibility);
  }

  public setPaintProperty(id: string, name: string, value: unknown): void {
    return this.services.get(LayerService).setPaintProperty(id, name, value);
  }

  public setFilter(id: string, expression: StyleExpression | null): void {
    return this.services.get(LayerService).setFilter(id, expression);
  }

  public getFilter(id: string): StyleExpression | undefined {
    return this.services.get(LayerService).getFilter(id);
  }

  public moveLayer(id: string, beforeId?: string): void {
    return this.services.get(LayerService).moveLayer(id, beforeId);
  }

  public getCRS(): string {
    return this.services.get(ViewService).getCRS();
  }

  public setCRS(crs: string): void {
    return this.services.get(ProjectionService).setCRS(crs);
  }

  public async reproject(targetCrs: string): Promise<void> {
    return this.services.get(ProjectionService).reproject(targetCrs);
  }

  public getCenter(): [number, number] {
    return this.services.get(ViewService).getCenter();
  }

  public getZoom(): number {
    return this.services.get(ViewService).getZoom();
  }

  public async getScaleMetrics(
    options: GetScaleMetricsOptions = {},
  ): Promise<ScaleViewMetrics | null> {
    return this.services.get(ScaleService).getScaleMetrics(options);
  }

  public getTransform(): AffineTransform {
    return this.services.get(ViewService).getTransform();
  }

  public getExtent(): Bounds {
    return this.services.get(ViewService).getExtent();
  }

  public setExtent(bounds: Bounds): void {
    return this.services.get(ViewService).setExtent(bounds);
  }

  public reset(): void {
    return this.services.get(ViewService).reset();
  }

  public addControl(control: Control, position: ControlPosition = 'top-left'): void {
    return this.services.get(ControlsService).addControl(control, position);
  }

  public removeControl(control: Control): void {
    return this.services.get(ControlsService).removeControl(control);
  }

  public zoomIn(): void {
    return this.services.get(ViewService).zoomIn();
  }

  public zoomOut(): void {
    return this.services.get(ViewService).zoomOut();
  }

  public jumpTo(o: CameraOptions): this {
    this.services.get(ViewService).jumpTo(o);
    return this;
  }

  public setCenter(center: [number, number]): this {
    this.services.get(ViewService).setCenter(center);
    return this;
  }

  public setZoom(zoom: number): this {
    this.services.get(ViewService).setZoom(zoom);
    return this;
  }

  public easeTo(o: CameraOptions & AnimationOptions): this {
    this.services.get(ViewService).easeTo(o);
    return this;
  }

  public panTo(center: [number, number], o: AnimationOptions = {}): this {
    this.services.get(ViewService).panTo(center, o);
    return this;
  }

  public panBy(offset: [number, number], o: AnimationOptions = {}): this {
    this.services.get(ViewService).panBy(offset, o);
    return this;
  }

  public zoomTo(zoom: number, o: AnimationOptions = {}): this {
    this.services.get(ViewService).zoomTo(zoom, o);
    return this;
  }

  public flyTo(o: FlyToOptions): this {
    this.services.get(ViewService).flyTo(o);
    return this;
  }

  public fitBounds(b: import('../geo/bounds').Bounds, o: FitBoundsOptions = {}): this {
    this.services.get(ViewService).fitBounds(b, o);
    return this;
  }

  public stop(): this {
    this.services.get(ViewService).stop();
    return this;
  }

  public render(req?: RenderRequest): void {
    return this.services.get(RenderService).render(req);
  }

  public project(x: number, y: number): [number, number] {
    return this.services.get(ViewService).project(x, y);
  }

  public unproject(px: number, py: number): [number, number] {
    return this.services.get(ViewService).unproject(px, py);
  }

  public resize(): void {
    return this.services.get(RenderService).resize();
  }

  public queryFeatures(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryFeaturesOptions,
    options?: QueryFeaturesOptions,
  ): QueriedFeature[] {
    return this.services.get(QueryService).queryFeatures(geometryOrOptions, options);
  }

  public prebuildSpatialIndex(sourceId?: string): void {
    return this.services.get(CacheService).prebuildSpatialIndex(sourceId);
  }

  public clearSpatialIndex(sourceId?: string): void {
    return this.services.get(CacheService).clearSpatialIndex(sourceId);
  }

  public setHighlightedFeatures(
    features: Array<QueriedFeature | FeatureRef>,
    style?: HighlightStyle,
  ): void {
    return this.services.get(SelectionService).setHighlightedFeatures(features, style);
  }

  public clearHighlightedFeatures(): void {
    return this.services.get(SelectionService).clearHighlightedFeatures();
  }

  public setHighlightStyle(style: HighlightStyle): void {
    return this.services.get(SelectionService).setHighlightStyle(style);
  }

  public select(features: ReadonlyArray<FeatureRef>, options?: { mode?: SelectMode }): void {
    return this.services.get(SelectionService).select(features, options);
  }

  public deselect(features: ReadonlyArray<FeatureRef>): void {
    return this.services.get(SelectionService).deselect(features);
  }

  public clearSelection(): void {
    return this.services.get(SelectionService).clearSelection();
  }

  public getSelection(): FeatureRef[] {
    return this.services.get(SelectionService).getSelection();
  }

  public isSelected(feature: FeatureRef): boolean {
    return this.services.get(SelectionService).isSelected(feature);
  }

  public deleteSelected(): boolean {
    return this.services.get(MutationService).deleteSelected();
  }

  public pushCommand(cmd: EditCommand): void {
    return this.services.get(HistoryService).pushCommand(cmd);
  }

  public undo(): boolean {
    return this.services.get(HistoryService).undo();
  }

  public redo(): boolean {
    return this.services.get(HistoryService).redo();
  }

  public canUndo(): boolean {
    return this.services.get(HistoryService).canUndo();
  }

  public canRedo(): boolean {
    return this.services.get(HistoryService).canRedo();
  }

  public clearHistory(): void {
    return this.services.get(HistoryService).clearHistory();
  }

  public beginTransaction(): Transaction {
    return this.services.get(HistoryService).beginTransaction();
  }

  public bindHistoryShortcuts(target?: HTMLElement): () => void {
    return this.services.get(ShortcutsService).bindHistoryShortcuts(target);
  }

  get ops(): Pick<MapshaperOps, keyof MapshaperOps> {
    return this.services.get(MapshaperProcessingService);
  }

  get editSession(): Pick<EditSessions, keyof EditSessions> {
    return this.services.get(EditSessionService);
  }

  get attributes(): Pick<AttributeOps, keyof AttributeOps> {
    return this.services.get(AttributeService);
  }

  get validators(): ValidatorRegistry {
    return this.services.get(ValidationService).validators;
  }

  get mapLibreServices(): MapLibreServiceManager {
    return this.services.get(MapLibreService);
  }

  get dragPan(): Handler<DragPanOptions> {
    return this.services.get(dragPanService);
  }

  get scrollZoom(): Handler<ScrollZoomOptions> {
    return this.services.get(scrollZoomService);
  }

  get clickSelect(): Handler<SelectHandlerOptions> {
    return this.services.get(clickSelectService);
  }

  get boxSelect(): Handler<BoxSelectHandlerOptions> {
    return this.services.get(boxSelectService);
  }

  get lassoSelect(): Handler<LassoSelectHandlerOptions> {
    return this.services.get(lassoSelectService);
  }

  get vertexEdit(): Handler<VertexEditOptions> {
    return this.services.get(vertexEditService);
  }

  get drawFeature(): Handler<DrawFeatureOptions> {
    return this.services.get(drawFeatureService);
  }

  get splitFeature(): Handler<SplitFeatureOptions> {
    return this.services.get(splitFeatureService);
  }

  get reshapeFeature(): Handler<ReshapeFeatureOptions> {
    return this.services.get(reshapeFeatureService);
  }

  get autoCompletePolygon(): Handler<ReshapeFeatureOptions> {
    return this.services.get(autoCompletePolygonService);
  }

  get ringEdit(): Handler<RingEditOptions> {
    return this.services.get(ringEditService);
  }

  get partEdit(): Handler<PartEditOptions> {
    return this.services.get(partEditService);
  }

  get measure(): Pick<MeasureHandler, keyof MeasureHandler> {
    return this.services.get(measureService);
  }

  get transformFeature(): Handler<TransformFeatureOptions> {
    return this.services.get(transformFeatureService);
  }
}

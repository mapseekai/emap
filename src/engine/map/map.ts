import { Context } from 'cordis';
import '../../runtime/services/context';
import { contextFibers } from '../../runtime/context/inspection';
import { settleContext } from '../../runtime/context/settle';
import { nativeFiberStates } from '../../runtime/context/state';
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
import type { EditCommand } from '../../domain/edit/edit-command';
import { Transaction } from '../../domain/edit/transaction';
import { Bounds } from '../../domain/geo/bounds';
import {
  type AnimationOptions,
  type CameraOptions,
  type FitBoundsOptions,
  type FlyToOptions,
} from '../../domain/geo/camera';
import {
  type GetScaleMetricsOptions,
  type ScaleViewMetrics,
} from '../../domain/geo/scale-calculator';
import { AffineTransform } from '../../domain/geo/transform';
import { resolvePlugins } from '../../runtime/presets';
import { optionsPlugin } from '../providers/workspace/base-plugins';
import type { DrawOverlayState, MeasurementOverlayState } from '../rendering/painter';
import type { EmapOptions } from '../../runtime/services/options';
import type { CreateLayerOptions } from '../../domain/source/create-layer';
import { type TopologySource } from '../../domain/source/source';
import { TopologySource as ConcreteTopologySource } from '../../domain/source/topology-source';
import type { Control, ControlPosition } from '../../ui/control';
import { ValidatorRegistry } from '../../domain/validation/registry';
import { AttributeOps } from './attribute-ops';
import { EditSessions } from './edit-sessions';
import { type EditMode } from './edit-state-store';
import { FeatureAccessor } from './feature-accessor';
import { type LayerSpecification } from './layer';
import { LayerRegistry } from './layer-registry';
import type { MapLibreServiceManager } from '../../integrations/maplibre/maplibre-service';
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
export type { EmapOptions } from '../../runtime/services/options';
export type * from './source-loading';
export * from './types';
/** Public GIS façade. Every capability is obtained from the mounted plugin graph. */
export class Emap extends EventDispatcher {
  /** The actual upstream Cordis context. */
  readonly ctx: Context;
  readonly ready: Promise<this>;
  private _closed = false;
  private _disposal?: Promise<void>;

  constructor(options: EmapOptions = {}) {
    super();
    this.ctx = new Context();
    const ctx = this.ctx;
    const config = Object.freeze({
      ...options,
      plugins: Object.freeze([...(options.plugins ?? [])]),
      excludePlugins: Object.freeze([...(options.excludePlugins ?? [])]),
    });
    const plugins = [optionsPlugin(config), ...resolvePlugins(config)];
    try {
      for (const plugin of plugins) this.ctx.plugin(plugin);
    } catch (error) {
      // A malformed native plugin can throw before its Fiber is created.
      // Release already-mounted siblings as well as asynchronously failing ones.
      this.remove();
      throw error;
    }
    this.ready = (async () => {
      try {
        await settleContext(ctx);
        if (this._closed)
          throw new DOMException('Map disposed before initialization', 'AbortError');
        const pending = contextFibers(ctx).filter(
          (fiber) => fiber.state !== nativeFiberStates.ACTIVE,
        );
        if (pending.length)
          throw new Error(`Plugins not ready: ${pending.map((fiber) => fiber.name).join(', ')}`);
        if (config.mapLibre && !ctx.get('mapLibre')) {
          throw new Error('mapLibre options require mapLibrePlugin from @mapseekai/emap/maplibre');
        }
        return this;
      } catch (error) {
        this.remove();
        await this._disposal;
        throw error;
      }
    })();
    void this.ready.catch(() => undefined);
  }

  static async create(options: EmapOptions = {}): Promise<Emap> {
    const map = new Emap(options);
    await map.ready;
    return map;
  }

  /** Install additional functionality without modifying the engine façade. */
  get controls() {
    return this.ctx.controls;
  }
  get capabilities() {
    return this.ctx.capabilities;
  }
  get formats() {
    return this.ctx.formats;
  }
  private _eventTarget(
    type: string,
  ):
    | EventDispatcher
    | Pick<
        import('../../runtime/services/contracts/routing').RoutingContract,
        'on' | 'off' | 'once'
      > {
    return type === 'mousemove' || type.startsWith('feature:')
      ? this.ctx.routing
      : this.ctx.mapEvents;
  }
  fire<T = Record<string, unknown>>(type: string, data?: T): this {
    if (!this._closed && !!this.ctx.get('mapEvents')) this.ctx.mapEvents.fire(type, data);
    return this;
  }
  /** Request native Cordis teardown. Await dispose() before reusing a container. */
  remove(): void {
    if (this._closed) return;
    this._closed = true;
    const events = !!this.ctx.get('mapEvents') ? this.ctx.mapEvents : undefined;
    if (!!this.ctx.get('document')) this.ctx.document._removed = true;
    this._disposal = this.ctx.fiber.dispose();
    void this._disposal.catch((error) => events?.fire('error', { error }));
  }
  async dispose(): Promise<void> {
    this.remove();
    await this._disposal;
  }
  get layers(): LayerRegistry {
    return this.ctx.document.layers;
  }
  get features(): FeatureAccessor {
    return this.ctx.query.features;
  }
  public cancelWorkerJobs(): void {
    return this.ctx.execution.cancelWorkerJobs();
  }
  public setExpressionPolicy(policy: ExpressionEvaluationPolicy): void {
    return this.ctx.policy.setExpressionPolicy(policy);
  }
  public getExpressionPolicy(): ExpressionEvaluationPolicy {
    return this.ctx.policy.getExpressionPolicy();
  }
  on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  on<K extends keyof EmapEventMap>(
    type: K,
    listener: (
      e: {
        type: K;
      } & EmapEventMap[K],
    ) => void,
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
    listener: (
      e: {
        type: K;
      } & EmapEventMap[K],
    ) => void,
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
    listener: (
      e: {
        type: K;
      } & EmapEventMap[K],
    ) => void,
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
    return this.ctx.surface.getCanvasContainer();
  }
  public getEditMode(): EditMode {
    return this.ctx.editState.getEditMode();
  }
  public setEditMode(mode: EditMode): void {
    return this.ctx.editState.setEditMode(mode);
  }
  public setEditVertexState(state: EditVertexState): void {
    return this.ctx.editState.setEditVertexState(state);
  }
  public clearEditVertexState(): void {
    return this.ctx.editState.clearEditVertexState();
  }
  public setEditDrawState(state: DrawOverlayState): void {
    return this.ctx.editState.setEditDrawState(state);
  }
  public clearEditDrawState(): void {
    return this.ctx.editState.clearEditDrawState();
  }
  public setEditMeasurementState(state: MeasurementOverlayState): void {
    return this.ctx.editState.setEditMeasurementState(state);
  }
  public clearEditMeasurementState(): void {
    return this.ctx.editState.clearEditMeasurementState();
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
    const service = this.ctx.source;
    return Reflect.apply(service.preflightSource, service, [requestOrDraft, answers]);
  }
  public async addSource(
    id: string,
    source: TopologySource,
    answers: SourceLoadAnswers = {},
  ): Promise<void> {
    return this.ctx.source.addSource(id, source, answers);
  }
  public async createLayer(
    id: string,
    options: CreateLayerOptions,
  ): Promise<ConcreteTopologySource> {
    return this.ctx.source.createLayer(id, options);
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
    return this.ctx.source.confirmSource(plan);
  }
  public removeSource(id: string): void {
    return this.ctx.source.removeSource(id);
  }
  public getSource(id: string): TopologySource | undefined {
    return this._closed ? undefined : this.ctx.source.getSource(id);
  }
  public async exportSnapshot(opts: ExportSnapshotOptions = {}): Promise<Blob> {
    return this.ctx.snapshot.exportSnapshot(opts);
  }
  public async loadSnapshot(
    input: Blob | Uint8Array | ArrayBuffer,
    opts: LoadSnapshotOptions = {},
  ): Promise<string[]> {
    return this.ctx.snapshot.loadSnapshot(input, opts);
  }
  public addLayer(layer: LayerSpecification, before?: string): void {
    return this.ctx.layers.addLayer(layer, before);
  }
  public removeLayer(id: string): void {
    return this.ctx.layers.removeLayer(id);
  }
  public getLayer(id: string): LayerSpecification | undefined {
    return this.ctx.layers.getLayer(id);
  }
  public getLayers(): readonly LayerSpecification[] {
    return this.ctx.layers.getLayers();
  }
  public getRenderedLayers(): readonly LayerSpecification[] {
    return this.ctx.layers.getRenderedLayers();
  }
  public setLayerVisibility(id: string, visibility: 'visible' | 'none'): void {
    return this.ctx.layers.setLayerVisibility(id, visibility);
  }
  public setPaintProperty(id: string, name: string, value: unknown): void {
    return this.ctx.layers.setPaintProperty(id, name, value);
  }
  public setFilter(id: string, expression: StyleExpression | null): void {
    return this.ctx.layers.setFilter(id, expression);
  }
  public getFilter(id: string): StyleExpression | undefined {
    return this.ctx.layers.getFilter(id);
  }
  public moveLayer(id: string, beforeId?: string): void {
    return this.ctx.layers.moveLayer(id, beforeId);
  }
  public getCRS(): string {
    return this.ctx.view.getCRS();
  }
  public setCRS(crs: string): void {
    return this.ctx.projection.setCRS(crs);
  }
  public async reproject(targetCrs: string): Promise<void> {
    return this.ctx.projection.reproject(targetCrs);
  }
  public getCenter(): [number, number] {
    return this.ctx.view.getCenter();
  }
  public getZoom(): number {
    return this.ctx.view.getZoom();
  }
  public async getScaleMetrics(
    options: GetScaleMetricsOptions = {},
  ): Promise<ScaleViewMetrics | null> {
    return this.ctx.scale.getScaleMetrics(options);
  }
  public getTransform(): AffineTransform {
    return this.ctx.view.getTransform();
  }
  public getExtent(): Bounds {
    return this.ctx.view.getExtent();
  }
  public setExtent(bounds: Bounds): void {
    return this.ctx.view.setExtent(bounds);
  }
  public reset(): void {
    return this.ctx.view.reset();
  }
  public addControl(control: Control, position: ControlPosition = 'top-left'): Promise<void> {
    return this.ctx.controls.addControl(control, position);
  }
  public removeControl(control: Control): Promise<void> {
    return this.ctx.controls.removeControl(control);
  }
  public zoomIn(): void {
    return this.ctx.view.zoomIn();
  }
  public zoomOut(): void {
    return this.ctx.view.zoomOut();
  }
  public jumpTo(o: CameraOptions): this {
    this.ctx.view.jumpTo(o);
    return this;
  }
  public setCenter(center: [number, number]): this {
    this.ctx.view.setCenter(center);
    return this;
  }
  public setZoom(zoom: number): this {
    this.ctx.view.setZoom(zoom);
    return this;
  }
  public easeTo(o: CameraOptions & AnimationOptions): this {
    this.ctx.view.easeTo(o);
    return this;
  }
  public panTo(center: [number, number], o: AnimationOptions = {}): this {
    this.ctx.view.panTo(center, o);
    return this;
  }
  public panBy(offset: [number, number], o: AnimationOptions = {}): this {
    this.ctx.view.panBy(offset, o);
    return this;
  }
  public zoomTo(zoom: number, o: AnimationOptions = {}): this {
    this.ctx.view.zoomTo(zoom, o);
    return this;
  }
  public flyTo(o: FlyToOptions): this {
    this.ctx.view.flyTo(o);
    return this;
  }
  public fitBounds(b: import('../../domain/geo/bounds').Bounds, o: FitBoundsOptions = {}): this {
    this.ctx.view.fitBounds(b, o);
    return this;
  }
  public stop(): this {
    this.ctx.view.stop();
    return this;
  }
  public render(req?: RenderRequest): void {
    return this.ctx.render.render(req);
  }
  public project(x: number, y: number): [number, number] {
    return this.ctx.view.project(x, y);
  }
  public unproject(px: number, py: number): [number, number] {
    return this.ctx.view.unproject(px, py);
  }
  public resize(): void {
    return this.ctx.render.resize();
  }
  public queryFeatures(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryFeaturesOptions,
    options?: QueryFeaturesOptions,
  ): QueriedFeature[] {
    return this.ctx.query.queryFeatures(geometryOrOptions, options);
  }
  public prebuildSpatialIndex(sourceId?: string): void {
    return this.ctx.cache.prebuildSpatialIndex(sourceId);
  }
  public clearSpatialIndex(sourceId?: string): void {
    return this.ctx.cache.clearSpatialIndex(sourceId);
  }
  public setHighlightedFeatures(
    features: Array<QueriedFeature | FeatureRef>,
    style?: HighlightStyle,
  ): void {
    return this.ctx.selection.setHighlightedFeatures(features, style);
  }
  public clearHighlightedFeatures(): void {
    return this.ctx.selection.clearHighlightedFeatures();
  }
  public setHighlightStyle(style: HighlightStyle): void {
    return this.ctx.selection.setHighlightStyle(style);
  }
  public select(
    features: ReadonlyArray<FeatureRef>,
    options?: {
      mode?: SelectMode;
    },
  ): void {
    return this.ctx.selection.select(features, options);
  }
  public deselect(features: ReadonlyArray<FeatureRef>): void {
    return this.ctx.selection.deselect(features);
  }
  public clearSelection(): void {
    return this.ctx.selection.clearSelection();
  }
  public getSelection(): FeatureRef[] {
    return this.ctx.selection.getSelection();
  }
  public isSelected(feature: FeatureRef): boolean {
    return this.ctx.selection.isSelected(feature);
  }
  public deleteSelected(): boolean {
    return this.ctx.mutation.deleteSelected();
  }
  public pushCommand(cmd: EditCommand): void {
    return this.ctx.history.pushCommand(cmd);
  }
  public undo(): boolean {
    return this.ctx.history.undo();
  }
  public redo(): boolean {
    return this.ctx.history.redo();
  }
  public canUndo(): boolean {
    return this.ctx.history.canUndo();
  }
  public canRedo(): boolean {
    return this.ctx.history.canRedo();
  }
  public clearHistory(): void {
    return this.ctx.history.clearHistory();
  }
  public beginTransaction(): Transaction {
    return this.ctx.history.beginTransaction();
  }
  public bindHistoryShortcuts(target?: HTMLElement): () => void {
    return this.ctx.shortcuts.bindHistoryShortcuts(target);
  }
  get ops(): Pick<MapshaperOps, keyof MapshaperOps> {
    return this.ctx.ops;
  }
  get editSession(): Pick<EditSessions, keyof EditSessions> {
    return this.ctx.editSession;
  }
  get attributes(): Pick<AttributeOps, keyof AttributeOps> {
    return this.ctx.attributes;
  }
  get validators(): ValidatorRegistry {
    return this.ctx.validation.validators;
  }
  get mapLibreServices(): MapLibreServiceManager {
    return this.ctx.mapLibre;
  }
  get dragPan(): Handler<DragPanOptions> {
    return this.ctx.dragPan;
  }
  get scrollZoom(): Handler<ScrollZoomOptions> {
    return this.ctx.scrollZoom;
  }
  get clickSelect(): Handler<SelectHandlerOptions> {
    return this.ctx.clickSelect;
  }
  get boxSelect(): Handler<BoxSelectHandlerOptions> {
    return this.ctx.boxSelect;
  }
  get lassoSelect(): Handler<LassoSelectHandlerOptions> {
    return this.ctx.lassoSelect;
  }
  get vertexEdit(): Handler<VertexEditOptions> {
    return this.ctx.vertexEdit;
  }
  get drawFeature(): Handler<DrawFeatureOptions> {
    return this.ctx.drawFeature;
  }
  get splitFeature(): Handler<SplitFeatureOptions> {
    return this.ctx.splitFeature;
  }
  get reshapeFeature(): Handler<ReshapeFeatureOptions> {
    return this.ctx.reshapeFeature;
  }
  get autoCompletePolygon(): Handler<ReshapeFeatureOptions> {
    return this.ctx.autoCompletePolygon;
  }
  get ringEdit(): Handler<RingEditOptions> {
    return this.ctx.ringEdit;
  }
  get partEdit(): Handler<PartEditOptions> {
    return this.ctx.partEdit;
  }
  get measure(): Pick<MeasureHandler, keyof MeasureHandler> {
    return this.ctx.measure;
  }
  get transformFeature(): Handler<TransformFeatureOptions> {
    return this.ctx.transformFeature;
  }
}

import { EventDispatcher } from '../core/events';
import { Bounds } from '../geo/bounds';
import { AffineTransform } from '../geo/transform';
import { Viewport } from '../geo/viewport';
import { Camera, type CameraOptions, type AnimationOptions, type FlyToOptions, type FitBoundsOptions } from '../geo/camera';
import { Projection } from '../geo/projection';
import { EpsgProjectionError, normalizeProjectCrs, resolveProjectCrs } from '../geo/crs-resolver';
import { Painter } from '../renderer/painter';
import { CanvasPainter } from '../renderer/canvas-painter';
import { EditOverlayRenderer } from '../renderer/edit-overlay-renderer';
import { RenderScheduler, type RenderSnapshot } from '../renderer/render-scheduler';
import { MapshaperOps } from './mapshaper-ops';
import { EditSessions } from './edit-sessions';
import { AttributeOps } from './attribute-ops';
import { EditStateStore, type EditMode } from './edit-state-store';
import { LayerRegistry } from './layer-registry';
import { TopologySource } from '../source/source';
import { TopologySource as ConcreteTopologySource } from '../source/topology-source';
import { ScrollZoomHandler } from '../core/handlers/scroll-zoom';
import type { ScrollZoomOptions } from '../core/handlers/scroll-zoom';
import { DragPanHandler } from '../core/handlers/drag-pan';
import type { DragPanOptions } from '../core/handlers/drag-pan';
import { ClickSelectHandler, type SelectHandlerOptions } from '../core/handlers/click-select';
import { BoxSelectHandler, type BoxSelectHandlerOptions } from '../core/handlers/box-select';
import { LassoSelectHandler, type LassoSelectHandlerOptions } from '../core/handlers/lasso-select';
import { VertexEditHandler, type VertexEditOptions } from '../core/handlers/vertex-edit';
import { DrawFeatureHandler, type DrawFeatureOptions } from '../core/handlers/draw-feature';
import { TransformFeatureHandler, type TransformFeatureOptions } from '../core/handlers/transform-feature';
import type { Handler } from '../core/handler';
import { HandlerManager } from '../core/handler-manager';
import { MapshaperWorkerPool } from '../core/mapshaper-worker-pool';
import { FeatureEventDispatcher, type FeatureEvent, type FeatureEventFilter } from '../core/feature-event-dispatcher';
import { PointerEventDispatcher, type PointerMoveEvent } from '../core/pointer-event-dispatcher';
import { type EventListener } from '../core/events';
import type { EmapEventMap } from '../core/event-map';
import { FeatureQuery } from './feature-query';
import { FeatureAccessor } from './feature-accessor';
import { ValidatorRegistry } from '../validation/registry';
import { HighlightManager } from './highlight-manager';
import { Selection, type SelectMode, SelectionDiff } from './selection';
import { EditHistory, HistoryStateSnapshot } from '../edit/edit-history';
import type { EditCommand } from '../edit/edit-command';
import { CompositeCommand } from '../edit/commands/composite';
import { Transaction, type TransactionInternal } from '../edit/transaction';
import { BulkFeatureDeleteCommand, type BulkFeatureDeleteCommandOptions } from '../edit/commands/feature-delete';
// `MapshaperOps`, `EditSessions`, `AttributeOps` are composed onto `Emap`
// via the `ops` / `editSession` / `attributes` getters below.
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import { Control, ControlPosition } from '../ui/control';
import { getLayerId } from '../source/layer-utils';
import { resolveStrokeStyle, resolvePointStyle } from './layer';
import type { LayerSpecification, FillPaint, LinePaint, CirclePaint } from './layer';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
// All public type/option surfaces moved to `./types`. Re-export here so
// existing `import { MapOptions, ... } from './map'` paths keep working.
export * from './types';
import {
  DEFAULT_WORKER_THRESHOLD,
  type ExpressionEvaluationPolicy,
  type MapOptions,
  type QueryFeaturesOptions,
  type QueriedFeature,
  type FeatureRef,
  type HighlightFeatureRef,
  type ExportSnapshotOptions,
  type LoadSnapshotOptions,
  type HighlightStyle,
  type EditVertexState,
  type EditDrawState,
  type RenderRequest,
  type RenderAction,
  type AffineDelta,
} from './types';

export class Emap extends EventDispatcher {
  private _container: HTMLElement;
  private _canvasContainer: HTMLElement;
  private _canvas: HTMLCanvasElement;
  private _painter: Painter;
  private _editOverlay: EditOverlayRenderer;
  private _scheduler!: RenderScheduler;
  private _viewport: Viewport = new Viewport();
  private _projection: Projection = new Projection();
  private _camera!: Camera;
  // Accessed by composed managers via `EmapHostInternal`. Treat as
  // read-only outside this class.
  _sources: globalThis.Map<string, TopologySource> =
    new globalThis.Map();
  /**
   * Single resolution surface for `(sourceId, layerId) → MapshaperLayer`.
   * Exposed to managers via `EmapHostInternal.layers`. Reads `_sources`
   * lazily so it stays in sync with `addSource`/`removeSource` without
   * needing its own listener. Constructed on first access so test paths
   * that bypass the constructor via `Object.create(Emap.prototype)` still
   * see a working registry once they `setPrivate(map, '_sources', ...)`.
   */
  private _layersCache?: LayerRegistry;
  get layers(): LayerRegistry {
    return this._layersCache ?? (this._layersCache = new LayerRegistry(this._sources));
  }
  private _sourceListeners: globalThis.Map<string, (e: any) => void> =
    new globalThis.Map();
  private _layers: LayerSpecification[] = [];
  private _effectiveLayersCache: LayerSpecification[] = [];
  private _defaultLayersDirty = true;
  private _layerArcFlagsCache: globalThis.Map<string, Uint8Array> = new globalThis.Map();

  // Interactions (delegated)
  private _handlers: HandlerManager;
  private _featureEvents!: FeatureEventDispatcher;
  private _pointerEvents!: PointerEventDispatcher;
  private _scrollZoom: ScrollZoomHandler;
  private _dragPan: DragPanHandler;
  private _clickSelect: ClickSelectHandler;
  private _boxSelect: BoxSelectHandler;
  private _lassoSelect: LassoSelectHandler;
  private _vertexEdit!: VertexEditHandler;
  private _drawFeature!: DrawFeatureHandler;
  private _transformFeature!: TransformFeatureHandler;

  // Rendering
  private _pendingRender = 0;
  private _rafId = 0;
  private _pendingAction: RenderAction = 'redraw';
  private _pendingNavDelta: AffineDelta | null = null;
  private _navSnapshotTransform: { mx: number; my: number; bx: number; by: number } | null = null;
  private _wheelSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly _WHEEL_SETTLE_MS = 250;

  // UI controls
  private _controlContainers: globalThis.Map<ControlPosition, HTMLElement> =
    new globalThis.Map();
  // Track every `addControl()` instance so `remove()` can call
  // `onRemove()` on each. We intentionally don't drop entries on
  // `removeControl()` — that would require both an Array and a Set —
  // and the array is short-lived so the duplicate is harmless.
  private _controls: Control[] = [];

  // Delegated managers. `_selection` and `_history` are read by composed
  // managers via `EmapHostInternal`; the rest stay private.
  private _highlightManager: HighlightManager = new HighlightManager();
  private _featureQuery: FeatureQuery;
  /**
   * Read-side feature accessor — `engine.features.get(ref)` returns one
   * feature's geometry + frozen properties; `iter(sourceId, layerId)`
   * walks a layer; `count(...)` is O(1). Constructed lazily in the
   * Emap constructor so test paths that bypass it via
   * `Object.create(Emap.prototype)` still see a working accessor once
   * they wire up the host.
   */
  public features!: FeatureAccessor;
  _selection: Selection = new Selection();
  _history: EditHistory = new EditHistory();
  /**
   * Currently active transaction, or `null`. Mutated by
   * `Transaction`'s constructor / commit / rollback. Exposed via the
   * `EmapHostInternal` contract so the runner can record per-source
   * snapshots without threading a transaction param through every op
   * signature.
   */
  _activeTransaction: TransactionInternal | null = null;
  /**
   * Post-commit validator registry. Validators registered here run
   * after every `historychange` event; failures surface via
   * `validationfailed` (no auto-undo — apps decide how to react).
   *
   * Public-facing alias is `engine.validators` (see initialiser below).
   */
  readonly _validators: ValidatorRegistry = new ValidatorRegistry();
  /** Public alias for the validator registry. */
  public get validators(): ValidatorRegistry {
    return this._validators;
  }
  private _historyShortcutUnbind: (() => void) | null = null;

  // Composed feature managers — each wraps a slice of behaviour that used
  // to live on `Emap.prototype` via mixin. Lazily constructed on first
  // access so test helpers that bypass the constructor via
  // `Object.create(Emap.prototype)` still get a working namespace.
  private _ops?: MapshaperOps;
  private _editSession?: EditSessions;
  private _attributes?: AttributeOps;

  /** Mapshaper layer ops (clip / dissolve / buffer / project / ...). */
  get ops(): MapshaperOps {
    return this._ops ?? (this._ops = new MapshaperOps(this));
  }
  /** Selection editing (translate / rotate / scale + live drag sessions). */
  get editSession(): EditSessions {
    return this._editSession ?? (this._editSession = new EditSessions(this));
  }
  /** Per-feature property and per-layer field editing. */
  get attributes(): AttributeOps {
    return this._attributes ?? (this._attributes = new AttributeOps(this));
  }

  // Edit mode (mode + vertex overlay + draw overlay) is owned by a single
  // store so the three pieces stay coherent — leaving `'vertex'` mode
  // automatically drops `vertex`, etc. The store calls back into Emap
  // here to (re)render and emit `editmodechange`.
  private _editState: EditStateStore = new EditStateStore((change) => {
    if (change.modeChanged) {
      // Wholesale-disable pan only for modal editors that need full pointer
      // ownership (`vertex`, `draw`) — their handlers don't claim `'exclusive'`
      // on `'down'`, so they rely on this gate to keep `dragPan` from
      // intercepting. `'transform'` is different: `transformFeature` returns
      // `'exclusive'` on `'down'` when (and only when) the hit is an already-
      // selected feature; for every other point the arbiter falls through to
      // `dragPan` and pan should still work.
      const blocksPan = change.current.mode === 'vertex' || change.current.mode === 'draw';
      if (blocksPan) this._dragPan?.disable(); else this._dragPan?.enable();
      this.fire('editmodechange', { mode: change.current.mode });
    }
    this._scheduleRender();
  });

  // Worker pool / mode / threshold are read by `MapshaperOps` via
  // `EmapHostInternal`. null when the option is off (or until the first
  // dataset-replace runs).
  _workerPool: MapshaperWorkerPool | null = null;
  // Resolved `useWorker` mode: false (off), true (always), or 'auto'
  // (per-call decision based on dataset vertex count).
  _workerMode: boolean | 'auto' = false;
  // Vertex-count threshold for the 'auto' mode. Defaults to
  // `DEFAULT_WORKER_THRESHOLD` (50_000). Read by `MapshaperOps`; the `_`
  // prefix still signals internal-only.
  _workerThreshold: number = DEFAULT_WORKER_THRESHOLD;
  /**
   * Optional caller-supplied routing decision. When set, `_runDatasetCommand`
   * forwards every command-info bundle to it and uses the boolean result
   * verbatim. Pass `MapOptions.workerRouting` to install one. Read by
   * `MapshaperOps` via the host.
   */
  _workerRouting?: import('./worker-routing').WorkerRoutingFn;
  // Default to `disabled` so apps don't accidentally execute arbitrary
  // JavaScript from external/untrusted layer config. Apps that load only
  // their own data can opt back in via `expressionPolicy: 'trusted'` in
  // `MapOptions` or `setExpressionPolicy('trusted')` at runtime.
  private _expressionPolicy: ExpressionEvaluationPolicy = 'disabled';

  constructor(options: MapOptions) {
    super();

    if (typeof options.container === 'string') {
      const el = document.getElementById(options.container);
      if (!el) throw new Error(`Container #${options.container} not found`);
      this._container = el;
    } else {
      this._container = options.container;
    }

    this._canvasContainer = this._createCanvasContainer();
    this._container.appendChild(this._canvasContainer);

    this._canvas = document.createElement('canvas');
    this._canvas.style.position = 'absolute';
    this._canvas.style.top = '0';
    this._canvas.style.left = '0';
    this._canvasContainer.appendChild(this._canvas);

    this._painter = new CanvasPainter(this._canvas);
    this._painter.setPixelRatio(window.devicePixelRatio || 1);
    this._editOverlay = new EditOverlayRenderer(this._painter);
    this._scheduler = new RenderScheduler({
      fullRedraw: () => this._renderFull(),
      fastNav: (delta) => this._applyFastTransform(delta),
      getSnapshot: () => this._captureRenderSnapshot(),
    });

    this._updateSize();

    // Viewport callbacks
    this._viewport.onViewChange = () => this.fire('move');
    this._viewport.initZoomTween();

    // Camera (DX P9) — constructed before the gesture handlers so the
    // stop-on-gesture callback can reference `this._camera` without a
    // late-bind guard. Projection/viewport are ready at this point.
    this._camera = new Camera({
      getCameraState: () => this._viewport.getCameraState(),
      applyCameraState: (c, s) => this._viewport.applyCameraState(c, s),
      scaleFromZoom: (z) => this._projection.getScale(z),
      getViewportSize: () => ({ width: this._viewport.width, height: this._viewport.height }),
      fire: (type, e) => this.fire(type, e),
      requestRender: () => this._scheduleRender(),
      cancelZoomAnimation: () => this._viewport.cancelZoomAnimation(),
    });

    // Interactions — both use EventDispatcher pattern
    this._handlers = new HandlerManager();
    this._scrollZoom = new ScrollZoomHandler(this._canvasContainer, () => this.stop());
    this._dragPan = new DragPanHandler(
      undefined,
      () => this.stop(),
      (point) => this.queryFeatures([point.x, point.y]).some((feature) => this.isSelected(feature)),
    );
    this._handlers.register(this._dragPan);
    this._handlers.register(this._scrollZoom);
    this._clickSelect = new ClickSelectHandler(this);
    this._boxSelect = new BoxSelectHandler(this);
    this._lassoSelect = new LassoSelectHandler(this);
    this._handlers.register(this._clickSelect);
    this._handlers.register(this._boxSelect);
    this._handlers.register(this._lassoSelect);
    this._vertexEdit = new VertexEditHandler(this);
    this._handlers.register(this._vertexEdit);
    this._drawFeature = new DrawFeatureHandler(this);
    this._handlers.register(this._drawFeature);
    this._transformFeature = new TransformFeatureHandler(this);
    this._handlers.register(this._transformFeature);
    this._handlers.attach(this._canvasContainer);

    if (options.interactive === false) {
      this._handlers.applyInteractive(false);
    }

    // Feature query (delegated)
    this._featureQuery = new FeatureQuery(
      this._sources,
      () => this._viewport.transform,
      () => ({ width: this._viewport.width, height: this._viewport.height }),
      () => this._viewport.initialMX,
    );
    this.features = new FeatureAccessor(this);
    const _self = this;
    this._featureEvents = new FeatureEventDispatcher({
      queryFeatures: (g, o) => _self.queryFeatures(g, o) as Array<{ source: string; layer: string; id: number }>,
      unproject: (x, y) => _self.unproject(x, y),
      get features() { return _self.features; },
    });
    this._pointerEvents = new PointerEventDispatcher({
      unproject: (x, y) => _self.unproject(x, y),
    });
    this._featureEvents.setOnChange(() => this._syncPointerSink());
    this._pointerEvents.setOnChange(() => this._syncPointerSink());

    this._attachEventListeners();

    this.on('move', () => {
      if (this._navSnapshotTransform) return;
      this._scheduleRender();
    });
    this.on('resize', () => this._scheduleRender());
    this.on('reset', () => this.reset());
    // Validation hook: every committed history step (whether from an op,
    // an edit-session commit, or a transaction commit) reaches us via
    // `historychange`. Asks the registry to fan out every
    // `'after-commit'` validator in parallel and surfaces any failures
    // through the `validationfailed` event. The registry no-ops when
    // empty so the only cost in the common case is one `size` check.
    this.on('historychange', () => this._runAfterCommitValidators());

    // Set up the worker pool eagerly when requested. Construction is cheap;
    // the underlying Worker is lazy-spawned on first run().
    this._expressionPolicy = options.expressionPolicy ?? 'disabled';
    this._workerMode = options.useWorker ?? options.workerMode ?? false;
    if (typeof options.workerThreshold === 'number' && options.workerThreshold >= 0) {
      this._workerThreshold = options.workerThreshold;
    }
    this._workerRouting = options.workerRouting;
    if (this._workerMode !== false || options.workerPool) {
      if (options.workerPool) {
        this._workerPool = options.workerPool;
      } else {
        this._workerPool = new MapshaperWorkerPool({
          workerUrl: options.workerUrl ?? 'emap-worker.js',
          poolSize: options.workerPoolSize,
        });
      }
    }
  }

  /**
   * Hard-cancel any in-flight worker jobs. Safe to call when no worker
   * pool exists (no-op). The pool stays usable — subsequent dataset-replace
   * ops re-spawn a fresh worker.
   *
   * mapshaper isn't interruptible mid-command, so this is the only sound
   * abandonment path: terminate the worker, lose any other queued jobs as
   * collateral, and let the next op start over.
   */
  public cancelWorkerJobs(): void {
    this._workerPool?.cancelAll();
  }

  public setExpressionPolicy(policy: ExpressionEvaluationPolicy): void {
    this._expressionPolicy = policy;
  }

  public getExpressionPolicy(): ExpressionEvaluationPolicy {
    return this._expressionPolicy ?? 'disabled';
  }

  // Called by `MapshaperOps` via `this._emap._allowExpressionEvaluation`.
  _allowExpressionEvaluation(values: Array<string | undefined>, operation: string): boolean {
    const hasExpression = values.some((value) => typeof value === 'string' && value.trim().length > 0);
    // No expression payload → always allowed regardless of policy.
    // Policy is `'trusted'` → opt-in, allowed. Anything else → block.
    if (!hasExpression || this.getExpressionPolicy() === 'trusted') return true;
    this.fire('error', {
      error: new Error(`${operation}: expression evaluation is disabled`),
    });
    return false;
  }


  // Overload 1: typed pointer-move form. The `'mousemove'` literal MUST
  // precede the generic `string` overload — `EventListener<T>` defaults T
  // to `Record<string, unknown>` (an index signature), so the generic form
  // otherwise swallows `map.on('mousemove', e => …)` and `e` loses its
  // `PointerMoveEvent` narrowing.
  on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  // Overload 1b (P10): typed known events — autocomplete + payload inference.
  // MUST sit after the 'mousemove' literal and before the generic string
  // fallback so known names infer and unknown names fall through.
  on<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;
  // Overload 2: generic 2-arg form — preserves the base class API for non-feature events
  // (e.g. `map.on<HistoryStateSnapshot>('historychange', cb)`)
  on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  // Overload 3: typed 2-arg feature-event form (no filter)
  on(type: string, listener: (e: FeatureEvent) => void): this;
  // Overload 4: 3-arg feature-event form with filter
  on(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;
  // Implementation
  on(type: string, filterOrListener: unknown, listener?: unknown): this {
    if (type === 'mousemove') {
      this._pointerEvents.on(type, filterOrListener as (e: PointerMoveEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    if (type.startsWith('feature:')) {
      const cb = (listener ?? filterOrListener) as (e: FeatureEvent) => void;
      const filter = (listener ? filterOrListener : undefined) as FeatureEventFilter | undefined;
      this._featureEvents.on(type, filter, cb);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    return super.on(type, filterOrListener as EventListener);
  }

  // Overload: typed pointer-move form (literal — must precede the generic string overload)
  off(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  // Overload 1b (P10): typed known events
  off<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;
  // Overload: generic 2-arg form for non-feature events
  off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  // Overload: feature-event form
  off(type: string, listener: (e: FeatureEvent) => void): this;
  // Implementation
  off(type: string, listener: unknown): this {
    if (type === 'mousemove') {
      this._pointerEvents.off(type, listener as (e: PointerMoveEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    if (type.startsWith('feature:')) {
      this._featureEvents.off(type, listener as (e: FeatureEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    return super.off(type, listener as EventListener);
  }

  // Overload 1: typed pointer-move form (literal — must precede the generic string overload)
  once(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  // Overload 1b (P10): typed known events
  once<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;
  // Overload 2: generic 2-arg form for non-feature events
  once<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  // Overload 3: typed 2-arg feature-event form (no filter)
  once(type: string, listener: (e: FeatureEvent) => void): this;
  // Overload 4: 3-arg feature-event form with filter
  once(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;
  // Implementation
  once(type: string, filterOrListener: unknown, listener?: unknown): this {
    if (type === 'mousemove') {
      this._pointerEvents.once(type, filterOrListener as (e: PointerMoveEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    if (type.startsWith('feature:')) {
      const cb = (listener ?? filterOrListener) as (e: FeatureEvent) => void;
      const filter = (listener ? filterOrListener : undefined) as FeatureEventFilter | undefined;
      this._featureEvents.once(type, filter, cb);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    return super.once(type, filterOrListener as EventListener);
  }

  /**
   * Install ONE HandlerManager sink while ≥1 feature OR pointer listener
   * exists; it fans out to both dispatchers (feature events first, then
   * pointer-move — independent, order fixed for determinism). Cleared when
   * neither has listeners, so default `new Emap()` pays nothing.
   */
  private _syncPointerSink(): void {
    if (this._featureEvents.hasListeners() || this._pointerEvents.hasListeners()) {
      this._handlers.setPointerSink((ev) => {
        this._featureEvents.dispatch(ev);
        this._pointerEvents.dispatch(ev);
      });
    } else {
      this._handlers.setPointerSink(null);
    }
  }

  public getCanvasContainer(): HTMLElement {
    return this._canvasContainer;
  }

  public getEditMode(): EditMode {
    return this._editState.mode;
  }

  public setEditMode(mode: EditMode): void {
    this._editState.setMode(mode);
  }

  public setEditVertexState(state: EditVertexState): void {
    this._editState.setVertex(state);
  }

  public clearEditVertexState(): void {
    this._editState.clearVertex();
  }

  public setEditDrawState(state: EditDrawState): void {
    this._editState.setDraw(state);
  }

  public clearEditDrawState(): void {
    this._editState.clearDraw();
  }

  private _attachEventListeners(): void {
    this._dragPan.on('pan', (e: { dx: number; dy: number }) => {
      this._ensureNavSnapshot();
      this._viewport.pan(e.dx, e.dy);
      this._scheduleRender('nav', this._computeNavDelta());
      this.fire('move');
    });
    this._dragPan.on('panstart', () => {
      // Cancels the viewport's kinetic wheel/zoomIn-zoomOut tween. The Camera's
      // own easeTo/flyTo animation is stopped separately via the dragPan
      // onGestureStart → map.stop() wiring; these are two independent systems.
      this._viewport.cancelZoomAnimation();
      this._ensureNavSnapshot();
    });
    this._dragPan.on('panend', () => {
      this._endNavGesture();
    });

    this._scrollZoom.on('mousewheel', (e: { direction: number; multiplier: number; x: number; y: number }) => {
      this._ensureNavSnapshot();
      this._viewport.applyWheelZoom(e.direction, e.multiplier, e.x, e.y);
      this._scheduleRender('nav', this._computeNavDelta());
      this.fire('move');
      if (this._wheelSettleTimer !== null) clearTimeout(this._wheelSettleTimer);
      this._wheelSettleTimer = setTimeout(() => {
        this._wheelSettleTimer = null;
        this._endNavGesture();
      }, Emap._WHEEL_SETTLE_MS);
    });
  }

  private _ensureNavSnapshot(): void {
    if (this._navSnapshotTransform) return;
    const t = this._viewport.transform;
    this._navSnapshotTransform = { mx: t.mx, my: t.my, bx: t.bx, by: t.by };
  }

  private _computeNavDelta(): AffineDelta {
    const snap = this._navSnapshotTransform;
    if (!snap) return { tx: 0, ty: 0, sx: 1, sy: 1 };
    const cur = this._viewport.transform;
    const sx = cur.mx / snap.mx;
    const sy = cur.my / snap.my;
    return {
      sx,
      sy,
      tx: cur.bx - sx * snap.bx,
      ty: cur.by - sy * snap.by,
    };
  }

  private _endNavGesture(): void {
    const hasPendingNav = this._pendingAction === 'nav' && this._pendingRender > 0;
    this._navSnapshotTransform = null;
    if (this._wheelSettleTimer !== null) {
      clearTimeout(this._wheelSettleTimer);
      this._wheelSettleTimer = null;
    }
    this._scheduler.notifyInteractionEnd(hasPendingNav);
    this.fire('interactionend');
  }

  private _createCanvasContainer(): HTMLElement {
    const el = document.createElement('div');
    el.style.position = 'relative';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.overflow = 'hidden';
    el.className = 'emap-canvas-container';

    const corners: ControlPosition[] = [
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ];
    for (const pos of corners) {
      const container = document.createElement('div');
      container.className = `emap-ctrl-${pos}`;
      container.style.position = 'absolute';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '10';

      const [v, h] = pos.split('-');
      container.style[v as 'top' | 'bottom'] = '10px';
      container.style[h as 'left' | 'right'] = '10px';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';

      // Stop UI-control events from bubbling onto the canvas. Without this,
      // clicking a control button (Undo, Navigation, …) also fires the
      // canvas's `click` handler — which examples wire to feature
      // selection — and starts the drag-pan on `mousedown`. `pointer-events:
      // none` on the container itself prevents hit-testing on empty space
      // around buttons, but events on the buttons themselves still bubble.
      const swallow = (e: Event) => e.stopPropagation();
      for (const type of ['click', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) {
        container.addEventListener(type, swallow);
      }
      // Wheel events listed separately: register passive so the page can
      // continue scrolling normally when the cursor sits over the control
      // chrome, AND so Chrome doesn't log a "non-passive wheel handler"
      // warning. We still call stopPropagation, which prevents the wheel
      // event from reaching the canvas's zoom handler — that's the part
      // we actually want.
      container.addEventListener('wheel', swallow, { passive: true });

      el.appendChild(container);
      this._controlContainers.set(pos, container);
    }

    return el;
  }

  private _updateSize(): void {
    const width = this._container.clientWidth;
    const height = this._container.clientHeight;
    this._viewport.updateSize(width, height);
    this._painter.resize(width, height);
  }


  public addSource(id: string, source: TopologySource): void {
    this._sources.set(id, source);

    const onData = (e: any) => {
      if (this._sources.size === 1 && source.getCRS) {
        const crs = source.getCRS();
        if (crs && this._projection.crs !== crs) {
          this._projection.setCRS(crs);
          this._viewport.setCRS(crs);
          this.fire('crschange');
        }
      }
      this.fire('data', { sourceId: id, ...e });
      this._defaultLayersDirty = true;
      this._layerArcFlagsCache.clear();
      this._scheduleRender();
    };

    this._sourceListeners.set(id, onData);
    source.on('data', onData);

    // If source already has data, trigger logic once manually
    if (source.getDataset && source.getDataset()) {
      onData({ type: 'data' });
    }
  }

  public removeSource(id: string): void {
    const source = this._sources.get(id);
    if (source) {
      const listener = this._sourceListeners.get(id);
      if (listener) {
        source.off('data', listener);
        this._sourceListeners.delete(id);
      }
      this._sources.delete(id);
      this._defaultLayersDirty = true;
      this._layerArcFlagsCache.delete(id);
      
      // Remove all cached arc flags for this source
      for (const key of this._layerArcFlagsCache.keys()) {
        if (key.startsWith(`${id}:`)) {
          this._layerArcFlagsCache.delete(key);
        }
      }
      this._scheduleRender();
    }
  }

  public getSource(id: string): TopologySource | undefined {
    return this._sources.get(id);
  }

  // ---------------------------------------------------------------------------
  // Multi-source snapshot (.msx) — pack/unpack the whole map
  // ---------------------------------------------------------------------------

  /**
   * Pack every topology source on this map into one `.msx` snapshot Blob via
   * mapshaper's session pack pipeline. Source IDs are preserved in a custom
   * `emap.sources` field on the packed object so {@link loadSnapshot} can
   * re-register sources under their original IDs.
   *
   * Sources that have no dataset yet (load not completed) are skipped.
   *
   * The output file is a valid mapshaper `.msx` — vanilla mapshaper will
   * load it (just dropping the `emap` metadata).
   */
  public async exportSnapshot(opts: ExportSnapshotOptions = {}): Promise<Blob> {
    const compact = opts.compact !== false;
    const ids: string[] = [];
    const datasets: any[] = [];
    for (const [id, source] of this._sources) {
      if (source.type !== 'topology') continue;
      const ds = source.getDataset?.();
      if (!ds) continue;
      ids.push(id);
      datasets.push(ds);
    }

    const adapter = getDefaultMapshaperAdapter();
    const obj = await adapter.exportDatasetsToPack(datasets, { compact });
    (obj as Record<string, unknown>).emap = {
      version: 1,
      sources: ids.map((id) => ({ id })),
    };
    const bytes = adapter.pack(obj);
    return new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  }

  /**
   * Restore one or more topology sources from a `.msx` snapshot via
   * mapshaper's session unpack pipeline. Returns the list of registered
   * source IDs in registration order.
   *
   * ID resolution priority (per restored dataset, in order):
   * 1. `opts.idPrefix` + ID from snapshot's `emap.sources[i].id` (if metadata present)
   * 2. `opts.idPrefix` + `opts.defaultIds[i]` (if supplied)
   * 3. `opts.idPrefix` + `snapshot-<i>` fallback
   *
   * On ID collision: `replace: true` (default) removes the existing source
   * first; `replace: false` rejects without registering anything.
   *
   * Edit history and selection are cleared because feature IDs in the
   * replayed history would point to features that no longer exist after
   * dataset replacement. Same semantics as the dataset-replace family
   * (clip, dissolve, mosaic, ...).
   */
  public async loadSnapshot(
    input: Blob | Uint8Array | ArrayBuffer,
    opts: LoadSnapshotOptions = {},
  ): Promise<string[]> {
    const replace = opts.replace !== false;
    const prefix = opts.idPrefix ?? '';
    const defaults = opts.defaultIds ?? [];

    let bytes: Uint8Array;
    if (input instanceof Uint8Array) {
      bytes = input;
    } else if (input instanceof ArrayBuffer) {
      bytes = new Uint8Array(input);
    } else if (typeof Blob !== 'undefined' && input instanceof Blob) {
      bytes = new Uint8Array(await input.arrayBuffer());
    } else {
      throw new Error('loadSnapshot: input must be Blob, Uint8Array, or ArrayBuffer');
    }

    // Pre-flight sanity check before handing the bytes to mapshaper's
    // msgpack-based unpacker. The unpacker throws opaque errors on garbage
    // input ("Unexpected end of buffer" / "Invalid code 0x..") that aren't
    // useful to surface in a UI. The .msx format is a top-level map; its
    // first byte must therefore be a msgpack map marker:
    //   - fixmap   (0-15 entries):    0x80..0x8F
    //   - map16    (0..2^16 entries): 0xDE
    //   - map32    (0..2^32 entries): 0xDF
    // GeoJSON / TopoJSON / random ZIPs / empty buffers all fail this check.
    if (!_looksLikeMsxBytes(bytes)) {
      throw new Error(
        'loadSnapshot: input does not look like a mapshaper .msx snapshot ' +
        '(expected msgpack map marker as the first byte)',
      );
    }

    const obj = await getDefaultMapshaperAdapter().unpackSessionData(bytes);
    const datasets = obj.datasets ?? [];
    const meta = (obj as Record<string, unknown>).emap as
      | { sources?: Array<{ id?: string }> }
      | undefined;
    const storedIds = meta?.sources?.map((s) => s?.id).filter((s): s is string => typeof s === 'string') ?? [];

    const resolvedIds: string[] = datasets.map((_, i) => {
      const stored = storedIds[i];
      const fallback = defaults[i] ?? `snapshot-${i}`;
      return prefix + (stored ?? fallback);
    });

    // Collision check before any side effects when replace=false
    if (!replace) {
      for (const id of resolvedIds) {
        if (this._sources.has(id)) {
          throw new Error(`loadSnapshot: source "${id}" already exists (pass { replace: true } to overwrite)`);
        }
      }
    }

    // History and selection no longer reference live features.
    this._history.clear();
    this._fireSelectionChange(this._selection.clear());
    this.fire('historychange');

    const registered: string[] = [];
    for (let i = 0; i < datasets.length; i++) {
      const id = resolvedIds[i];
      if (replace && this._sources.has(id)) this.removeSource(id);
      const src = new ConcreteTopologySource(id);
      src.setDataset(datasets[i] as MapshaperDataset);
      this.addSource(id, src);
      registered.push(id);
    }
    return registered;
  }

  // ---------------------------------------------------------------------------
  // Layer management
  // ---------------------------------------------------------------------------

  public addLayer(layer: LayerSpecification, before?: string): void {
    if (!this._sources.has(layer.source)) {
      throw new Error(`Source "${layer.source}" not found`);
    }
    if (this._layers.some((l) => l.id === layer.id)) {
      throw new Error(`Layer "${layer.id}" already exists`);
    }
    if (before) {
      const idx = this._layers.findIndex((l) => l.id === before);
      if (idx === -1) {
        throw new Error(`Layer "${before}" not found`);
      }
      this._layers.splice(idx, 0, { ...layer });
    } else {
      this._layers.push({ ...layer });
    }
    this._defaultLayersDirty = true;
    this._scheduleRender();
  }

  public removeLayer(id: string): void {
    const idx = this._layers.findIndex((l) => l.id === id);
    if (idx !== -1) {
      this._layers.splice(idx, 1);
      this._defaultLayersDirty = true;
      this._scheduleRender();
    }
  }

  public getLayer(id: string): LayerSpecification | undefined {
    return this._layers.find((l) => l.id === id);
  }

  public getLayers(): LayerSpecification[] {
    return [...this._layers];
  }

  public setLayerVisibility(id: string, visibility: 'visible' | 'none'): void {
    const layer = this._layers.find((l) => l.id === id);
    if (layer) {
      if (!layer.layout) layer.layout = {};
      layer.layout.visibility = visibility;
      this._scheduleRender();
    }
  }

  public setPaintProperty(id: string, name: string, value: unknown): void {
    const layer = this._layers.find((l) => l.id === id);
    if (layer) {
      if (!layer.paint) layer.paint = {};
      (layer.paint as Record<string, unknown>)[name] = value;
      this._scheduleRender();
    }
  }

  public moveLayer(id: string, beforeId?: string): void {
    const idx = this._layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const [layer] = this._layers.splice(idx, 1);
    if (beforeId) {
      const beforeIdx = this._layers.findIndex((l) => l.id === beforeId);
      if (beforeIdx === -1) {
        this._layers.push(layer);
      } else {
        this._layers.splice(beforeIdx, 0, layer);
      }
    } else {
      this._layers.push(layer);
    }
    this._defaultLayersDirty = true;
    this._scheduleRender();
  }

  private _getEffectiveLayers(): LayerSpecification[] {
    if (this._layers.length > 0) return this._layers;

    if (!this._defaultLayersDirty) {
      return this._effectiveLayersCache;
    }

    const defaults: LayerSpecification[] = [];
    for (const [sourceId, source] of this._sources) {
      const mapshaperLayers = source.getLayers() as MapshaperLayer[];
      if (mapshaperLayers.length === 0) {
        defaults.push({
          id: `${sourceId}:default`,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#333', 'line-width': 0.8 },
        });
      } else {
        for (let i = 0; i < mapshaperLayers.length; i++) {
          const ml = mapshaperLayers[i];
          const layerId = getLayerId(ml, i);
          const geomType = ml.geometry_type;
          // Default polygon rendering is outline-only (`type: 'line'`) to match
          // mapshaper GUI's behaviour and emap's pre-layer-concept default.
          // Canvas 2D fill is significantly more expensive than stroke for
          // many-polygon datasets (winding-rule rasterization vs straight
          // strokes). Callers who want a filled appearance add an explicit
          // `type: 'fill'` layer via addLayer().
          defaults.push({
            id: `${sourceId}:${layerId}`,
            type: geomType === 'point' ? 'circle' : 'line',
            source: sourceId,
            'source-layer': layerId,
            paint:
              geomType === 'point'
                ? { 'circle-color': '#333', 'circle-radius': 4 }
                : { 'line-color': '#333', 'line-width': 0.8 },
          });
        }
      }
    }
    
    this._effectiveLayersCache = defaults;
    this._defaultLayersDirty = false;
    return defaults;
  }

  private _resolveSourceLayer(
    source: TopologySource,
    sourceLayerName?: string,
  ): MapshaperLayer | null {
    const layers = source.getLayers() as MapshaperLayer[];
    if (!layers.length) return null;
    if (!sourceLayerName) return layers[0];
    for (let i = 0; i < layers.length; i++) {
      const lid = getLayerId(layers[i], i);
      if (lid === sourceLayerName) return layers[i];
    }
    return null;
  }

  /**
   * Generates a boolean flag array for arcs that belong to a specific source layer.
   * Cached to prevent walking shapes on every frame.
   *
   * Only meaningful for path layers (polygon/polyline). Point layers have no
   * arc references, so iterating their shapes contributes nothing — caller
   * should filter by `isPathLayer` before invoking.
   */
  private _getLayerArcFlags(ml: MapshaperLayer, arcs: any, cacheKey: string): Uint8Array | null {
    if (!ml || !ml.shapes || !arcs) return null;

    let flags = this._layerArcFlagsCache.get(cacheKey);
    if (flags) return flags;

    const arcCount = arcs.size();
    flags = new Uint8Array(arcCount);

    // Tag all arcs used by this layer's shapes. Layer is expected to be a
    // path layer; we cast for narrow access since the runtime guard at the
    // call sites ensures correctness.
    const pathShapes = ml.shapes as Array<import('../types/mapshaper-types').PathShape | null>;
    for (const shape of pathShapes) {
      if (!shape) continue;
      for (const part of shape) {
        for (const arcId of part) {
          const absId = arcId >= 0 ? arcId : ~arcId;
          flags[absId] = 1;
        }
      }
    }

    this._layerArcFlagsCache.set(cacheKey, flags);
    return flags;
  }

  private _getVisibleLayerKeys(): Set<string> {
    const keys = new Set<string>();
    const layers = this._getEffectiveLayers();
    for (const layer of layers) {
      if (layer.layout?.visibility === 'none') continue;
      const source = this._sources.get(layer.source);
      if (!source) continue;
      const ml = this._resolveSourceLayer(source, layer['source-layer']);
      if (ml) {
        const mapshaperLayers = source.getLayers() as MapshaperLayer[];
        const idx = mapshaperLayers.indexOf(ml);
        const lid = getLayerId(ml, idx >= 0 ? idx : 0);
        keys.add(`${layer.source}:${lid}`);
      }
    }
    return keys;
  }

  public getPainter(): Painter {
    return this._painter;
  }

  public getCRS(): string {
    return this._projection.crs;
  }

  public setCRS(crs: string): void {
    this._projection.setCRS(crs);
    this._viewport.setCRS(crs);
    this.fire('crschange');
  }

  public async reproject(targetCrs: string): Promise<void> {
    if (targetCrs.trim().length === 0) {
      throw new Error('targetCrs must be a non-empty CRS string');
    }
    const normalizedTarget = await resolveProjectCrs(targetCrs);
    let normalizedCurrent: string;
    try {
      normalizedCurrent = await resolveProjectCrs(this._projection.crs);
    } catch (err) {
      if (!(err instanceof EpsgProjectionError)) throw err;
      normalizedCurrent = normalizeProjectCrs(this._projection.crs);
    }
    if (normalizedCurrent === normalizedTarget) return;

    const newExtent = await this._projection.reproject(normalizedTarget, this._sources);

    this._viewport.setCRS(normalizedTarget);
    this._viewport.clearInitialState();
    this._clearSpatialIndexesForSources(this._sources.keys());

    if (newExtent.hasBounds()) {
      this.setExtent(newExtent);
    }

    this.fire('crschange');
    this.fire('data', { reason: 'reproject' });
  }

  public getCenter(): [number, number] {
    const t = this._viewport.transform;
    const cx = (this._viewport.width / 2 - t.bx) / t.mx;
    const cy = (this._viewport.height / 2 - t.by) / t.my;
    return this._projection.getCenter(cx, cy);
  }

  public getZoom(): number {
    return this._projection.getZoom(Math.abs(this._viewport.transform.mx));
  }

  /** The drag-to-pan interaction handler. */
  get dragPan(): Handler<DragPanOptions> { return this._dragPan; }
  /** The scroll-wheel zoom interaction handler. */
  get scrollZoom(): Handler<ScrollZoomOptions> { return this._scrollZoom; }
  /** The click-to-select interaction handler (disabled by default). */
  get clickSelect(): Handler<SelectHandlerOptions> { return this._clickSelect; }
  /** The box-select interaction handler (disabled by default). */
  get boxSelect(): Handler<BoxSelectHandlerOptions> { return this._boxSelect; }
  /** The lasso-select interaction handler (disabled by default). */
  get lassoSelect(): Handler<LassoSelectHandlerOptions> { return this._lassoSelect; }
  /** The vertex-edit interaction handler (disabled by default). */
  get vertexEdit(): Handler<VertexEditOptions> { return this._vertexEdit; }
  /** The draw-feature interaction handler (disabled by default). */
  get drawFeature(): Handler<DrawFeatureOptions> { return this._drawFeature; }
  /** The transform-feature interaction handler (disabled by default). */
  get transformFeature(): Handler<TransformFeatureOptions> { return this._transformFeature; }

  public getTransform(): AffineTransform {
    return this._viewport.transform;
  }

  public getExtent(): Bounds {
    return this._viewport.extent;
  }

  public setExtent(bounds: Bounds): void {
    this._viewport.setExtent(bounds);
    this.fire('move');
  }

  public reset(): void {
    this._viewport.reset();
  }

  public addControl(
    control: Control,
    position: ControlPosition = 'top-left',
  ): void {
    const el = control.onAdd(this);
    el.style.pointerEvents = 'auto';
    this._controlContainers.get(position)?.appendChild(el);
    this._controls.push(control);
  }

  public removeControl(control: Control): void {
    control.onRemove(this);
    const idx = this._controls.indexOf(control);
    if (idx !== -1) this._controls.splice(idx, 1);
  }

  public zoomIn(): void {
    this._viewport.zoomIn();
  }

  public zoomOut(): void {
    this._viewport.zoomOut();
  }

  // ── Camera (DX P9) ───────────────────────────────────────────────
  /** Instant camera move. Fires movestart/move/moveend (+zoom*). */
  public jumpTo(o: CameraOptions): this { this._camera.jumpTo(o); return this; }
  /** Set centre (projected/data coords) instantly. */
  public setCenter(center: [number, number]): this { this._camera.setCenter(center); return this; }
  /** Set zoom (WebMercator) instantly. */
  public setZoom(zoom: number): this { this._camera.setZoom(zoom); return this; }
  /** Animated move (centre+zoom/scale). */
  public easeTo(o: CameraOptions & AnimationOptions): this { this._camera.easeTo(o); return this; }
  /** Animated pan to a centre. */
  public panTo(center: [number, number], o: AnimationOptions = {}): this { this._camera.panTo(center, o); return this; }
  /** Animated pan by a pixel offset. */
  public panBy(offset: [number, number], o: AnimationOptions = {}): this { this._camera.panBy(offset, o); return this; }
  /** Animated zoom to a level. */
  public zoomTo(zoom: number, o: AnimationOptions = {}): this { this._camera.zoomTo(zoom, o); return this; }
  /** van-Wijk parabolic flight. */
  public flyTo(o: FlyToOptions): this { this._camera.flyTo(o); return this; }
  /** Fit a Bounds into the viewport with optional padding. */
  public fitBounds(b: import('../geo/bounds').Bounds, o: FitBoundsOptions = {}): this { this._camera.fitBounds(b, o); return this; }
  /** Cancel any running camera animation (no-op when idle). */
  public stop(): this { this._camera.stop(); return this; }

  _scheduleRender(action: RenderAction = 'redraw', navDelta?: AffineDelta): void {
    if (this._removed) return;
    this._pendingRender++;
    if (this._pendingAction === 'redraw' || action === 'redraw') {
      this._pendingAction = 'redraw';
      this._pendingNavDelta = null;
    } else {
      this._pendingAction = 'nav';
      if (navDelta) this._pendingNavDelta = { ...navDelta };
    }
    if (this._rafId === 0) {
      this._rafId = requestAnimationFrame(() => this._doRender());
    }
  }

  private _doRender(): void {
    this._rafId = 0;
    if (this._pendingRender > 0) {
      this._pendingRender = 0;
      const req: RenderRequest = { action: this._pendingAction };
      if (this._pendingNavDelta) req.navDelta = this._pendingNavDelta;
      this._pendingAction = 'redraw';
      this._pendingNavDelta = null;
      this.render(req);
    }
  }

  public render(req?: RenderRequest): void {
    this._scheduler.schedule(req ?? { action: 'redraw' });
  }

  private _renderFull(): void {
    this._clearFastTransform();
    const t0 = performance.now();
    this._renderImpl();
    this._scheduler.recordFrame(performance.now() - t0, this._captureRenderSnapshot());
  }

  private _renderImpl(): void {
    const transform = this._viewport.transform;
    this._painter.setTransform(transform);
    this._painter.clear();

    const lineScale = this._viewport.getLineScale();
    const pixelSize = 1 / Math.abs(transform.mx);

    this._renderLayers(pixelSize, lineScale);
    this._renderHighlight(transform, lineScale);
    this._editOverlay.render(
      this._editState.mode,
      this._editState.vertex,
      this._editState.draw,
    );
  }

  private _captureRenderSnapshot(): RenderSnapshot {
    return {
      canvasWidth: this._canvas.width,
      canvasHeight: this._canvas.height,
      pixelRatio: window.devicePixelRatio || 1,
    };
  }

  private _applyFastTransform(delta: AffineDelta): void {
    this._canvas.style.transformOrigin = 'top left';
    this._canvas.style.transform = `translate(${delta.tx}px,${delta.ty}px) scale(${delta.sx},${delta.sy})`;
  }

  private _clearFastTransform(): void {
    if (!this._canvas.style.transform) return;
    this._canvas.style.transform = '';
    this._canvas.style.transformOrigin = '';
  }

  private _renderLayers(pixelSize: number, lineScale: number): void {
    const effectiveLayers = this._getEffectiveLayers();

    for (const layer of effectiveLayers) {
      if (layer.layout?.visibility === 'none') continue;

      const source = this._sources.get(layer.source);
      if (!source) continue;

      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();

      if (arcs && arcs.setRetainedInterval &&
        (typeof arcs.isFlat !== 'function' || !arcs.isFlat())) {
        // User-driven `-simplify` writes a sticky floor on the source.
        // Per-frame zoom-LOD raises that floor on zoom-out (smaller scale,
        // bigger pixel) but never below the user's threshold — otherwise
        // every render would re-introduce detail the user just filtered.
        const userFloor = source.getSimplifyFloor?.() ?? 0;
        arcs.setRetainedInterval(Math.max(userFloor, pixelSize * 0.5));
      }

      const ml = this._resolveSourceLayer(source, layer['source-layer']);
      const cacheKey = `${layer.source}:${layer['source-layer'] || 'default'}`;

      if (layer.type === 'line' && arcs) {
        this._renderLineLayer(layer, ml, arcs, cacheKey, lineScale);
      } else if (layer.type === 'fill' && arcs && ml?.shapes) {
        this._renderFillLayer(layer, ml, arcs, cacheKey, lineScale);
      } else if (layer.type === 'circle' && ml?.shapes) {
        const style = resolvePointStyle(layer.paint as CirclePaint);
        this._painter.drawPoints(ml.shapes, style);
      }
    }
  }

  private _renderLineLayer(
    layer: LayerSpecification,
    ml: MapshaperLayer | null,
    arcs: import('../types/mapshaper-types').ArcCollection,
    cacheKey: string,
    lineScale: number,
  ): void {
    const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
    if (ml?.shapes) {
      // Optimized layer line rendering: use drawArcs with a boolean arc
      // presence filter so each shared topology arc strokes exactly once.
      const flags = this._getLayerArcFlags(ml, arcs, cacheKey);
      const filter = this._combineArcFilters(flags, this._viewport.getArcFilter(arcs));
      this._painter.drawArcs(arcs, style, filter);
    } else {
      // Fallback: draw all arcs
      this._painter.drawArcs(arcs, style, this._viewport.getArcFilter(arcs));
    }
  }

  private _renderFillLayer(
    layer: LayerSpecification,
    ml: MapshaperLayer,
    arcs: import('../types/mapshaper-types').ArcCollection,
    cacheKey: string,
    lineScale: number,
  ): void {
    const fillPaint = layer.paint as FillPaint | undefined;
    const fillColor = fillPaint?.['fill-color'] || 'rgba(200, 200, 200, 0.4)';
    const fillOpacity = fillPaint?.['fill-opacity'];
    const viewportFilter = this._viewport.getArcFilter(arcs);
    this._painter.drawPolygonFill(
      ml.shapes!,
      arcs,
      fillColor,
      viewportFilter,
      fillOpacity,
    );
    // Outline: stroke each topology arc exactly once via the same flag cache
    // the line layer uses. drawPaths(shapes,...) would re-walk every shape
    // and double-stroke shared boundaries — on big polygon datasets that's
    // the dominant cost of fill mode.
    const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
    const flags = this._getLayerArcFlags(ml, arcs, cacheKey);
    this._painter.drawArcs(arcs, style, this._combineArcFilters(flags, viewportFilter));
  }

  private _combineArcFilters(
    flags: Uint8Array | null,
    viewportFilter: ((i: number) => boolean) | undefined,
  ): ((i: number) => boolean) | undefined {
    if (flags && viewportFilter) {
      return (i: number) => flags[i] === 1 && viewportFilter(i);
    }
    if (flags) return (i: number) => flags[i] === 1;
    return viewportFilter;
  }

  private _renderHighlight(transform: AffineTransform, lineScale: number): void {
    const visibleKeys = this._getVisibleLayerKeys();
    this._highlightManager.renderHighlights(
      this._painter,
      this._sources,
      transform,
      lineScale,
      visibleKeys,
    );
  }

  public project(x: number, y: number): [number, number] {
    return this._viewport.project(x, y);
  }

  public unproject(px: number, py: number): [number, number] {
    return this._viewport.unproject(px, py);
  }

  public resize(): void {
    this._updateSize();
    this._viewport.setExtent(this._viewport.extent);
    this.fire('resize');
  }

  public queryFeatures(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryFeaturesOptions,
    options?: QueryFeaturesOptions,
  ): QueriedFeature[] {
    const visibleKeys = this._getVisibleLayerKeys();
    return this._featureQuery.query(geometryOrOptions, options, visibleKeys);
  }

  /**
   * Eagerly build the per-layer Flatbush spatial index for one source (or
   * every registered source when `sourceId` is omitted). Useful for paying
   * the build cost in idle time before the user's first hit-test.
   *
   * Idempotent — already-cached layer indexes are skipped. No-op for
   * sources without a dataset.
   *
   * Subsequent `queryFeatures` calls automatically use whatever's
   * cached, regardless of whether `prebuildSpatialIndex` was called.
   */
  public prebuildSpatialIndex(sourceId?: string): void {
    this._featureQuery.prebuild(sourceId);
  }

  /**
   * Drop cached per-layer spatial indexes for one source (or all sources
   * when `sourceId` is omitted).
   *
   * Required after in-place geometry edits (`translateSelected`,
   * `rotateSelected`, vertex commands) that mutate arc coordinates without
   * changing shape or arc counts — the cache key wouldn't notice and
   * subsequent queries would return prefilter-stale results.
   *
   * Dataset-replace ops (clip / dissolve / etc.) automatically invalidate
   * via shape-count or arc-count change; this method is only needed for
   * in-place edits.
   */
  public clearSpatialIndex(sourceId?: string): void {
    this._featureQuery.clear(sourceId);
  }

  // Called by `EditSessions` via `this._emap._clearSpatialIndexesForSources`.
  _clearSpatialIndexesForSources(sourceIds: Iterable<string>): void {
    for (const sourceId of sourceIds) {
      this._featureQuery?.clear(sourceId);
    }
  }

  public setHighlightedFeatures(
    features: Array<QueriedFeature | HighlightFeatureRef>,
    style?: HighlightStyle,
  ): void {
    this._highlightManager.setHighlightedFeatures(features, style);
    this._scheduleRender();
  }

  public clearHighlightedFeatures(): void {
    if (this._highlightManager.clearHighlightedFeatures()) {
      this._scheduleRender();
    }
  }

  public setHighlightStyle(style: HighlightStyle): void {
    if (this._highlightManager.setHighlightStyle(style)) {
      this._scheduleRender();
    }
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /**
   * Mutate the persistent feature selection.
   *
   * @param features Refs to apply. `QueriedFeature` is structurally
   *   compatible with `FeatureRef`, so results from `queryFeatures` can
   *   be passed directly.
   * @param options.mode `'replace'` (default) wipes prior contents,
   *   `'add'` unions, `'toggle'` flips membership.
   *
   * Fires a `selectionchange` event with `{ selected, added, removed }` only
   * when the set actually changes.
   */
  public select(
    features: ReadonlyArray<FeatureRef>,
    options?: { mode?: SelectMode },
  ): void {
    const mode = options?.mode ?? 'replace';
    const diff = this._selection.apply(features, mode);
    this._fireSelectionChange(diff);
  }

  /** Remove the listed features from the selection. No-op if absent. */
  public deselect(features: ReadonlyArray<FeatureRef>): void {
    const diff = this._selection.remove(features);
    this._fireSelectionChange(diff);
  }

  /** Empty the selection. No-op (and no event) if it was already empty. */
  public clearSelection(): void {
    const diff = this._selection.clear();
    this._fireSelectionChange(diff);
  }

  /** Snapshot of the current selection as a flat list of refs. */
  public getSelection(): FeatureRef[] {
    return this._selection.getAll();
  }

  /** Test whether a single feature is currently selected. */
  public isSelected(feature: FeatureRef): boolean {
    return this._selection.has(feature);
  }

  _fireSelectionChange(diff: SelectionDiff): void {
    if (!diff.changed) return;
    this.fire('selectionchange', {
      selected: this._selection.getAll(),
      added: diff.added,
      removed: diff.removed,
    });
    this._handlers?.refreshCursor();
  }

  /**
   * Delete every currently-selected feature in one undoable history step.
   *
   * Returns `true` when at least one feature was deleted, `false` when the
   * selection was empty (in which case nothing is pushed and no events fire).
   *
   * Implementation matches mapshaper's `deleteFeature` / `insertFeature`
   * pair: shape + data record are spliced out (and back in on undo). Within
   * each layer, deletes proceed in descending-id order so each delete's
   * index stays valid; a single Ctrl+Z reverses the entire batch.
   *
   * The selection is cleared on success — the deleted refs no longer exist.
   */
  public deleteSelected(): boolean {
    const refs = this._selection.getAll();
    if (refs.length === 0) return false;

    // Group ids by (sourceId, layerId) so each (source, layer) pair runs as
    // ONE BulkFeatureDeleteCommand — splicing K features individually on a
    // layer with N shapes is O(K·N), the bulk command compacts in a single
    // O(N) pass.
    const grouped: globalThis.Map<string, globalThis.Map<string, number[]>> = new globalThis.Map();
    for (const ref of refs) {
      let bySource = grouped.get(ref.source);
      if (!bySource) {
        bySource = new globalThis.Map();
        grouped.set(ref.source, bySource);
      }
      const ids = bySource.get(ref.layer) ?? [];
      ids.push(ref.id);
      bySource.set(ref.layer, ids);
    }

    const children: EditCommand[] = [];
    let totalDeleted = 0;

    for (const [sourceId, byLayer] of grouped) {
      const source = this._sources.get(sourceId);
      if (!source) continue;
      const layers = source.getLayers();
      for (const [layerId, ids] of byLayer) {
        let target: MapshaperLayer | null = null;
        for (let i = 0; i < layers.length; i++) {
          if (getLayerId(layers[i], i) === layerId) {
            target = layers[i] as MapshaperLayer;
            break;
          }
        }
        if (!target?.shapes) continue;

        const records = target.data?.getRecords?.();
        const snapshots: BulkFeatureDeleteCommandOptions['snapshots'] = [];
        // De-dup ids — selection theoretically guarantees this but
        // defensive: a duplicate would corrupt the bulk command's
        // del-set / undo path.
        const seen = new Set<number>();
        for (const featureId of ids) {
          if (seen.has(featureId)) continue;
          seen.add(featureId);
          const shape = target.shapes[featureId];
          if (shape === undefined) continue;
          const record = records ? records[featureId] : null;
          snapshots.push({ id: featureId, shape, record: record ?? null });
        }
        if (snapshots.length === 0) continue;

        const bulk = new BulkFeatureDeleteCommand({ layer: target, snapshots });
        bulk.do();
        children.push(bulk);
        totalDeleted += snapshots.length;
      }
    }

    if (children.length === 0) return false;

    const composite = new CompositeCommand(
      children,
      `Delete ${totalDeleted} feature${totalDeleted > 1 ? 's' : ''}`,
    );
    this._history.push(composite);
    this._fireHistoryChange();

    // Invalidate caches keyed off `layer.shapes` for every touched source —
    // the line-layer arc-flag cache and the per-layer Flatbush index both
    // hold references to shapes that no longer exist.
    this._invalidateShapeCachesForSources(grouped.keys());

    // Clear the selection — the refs no longer exist.
    this._fireSelectionChange(this._selection.clear());
    this._scheduleRender();

    return true;
  }

  /**
   * Drop derived caches (line-layer arc flags + spatial index) for the given
   * sources. Call after any edit that mutates `layer.shapes` so subsequent
   * frames and `queryFeatures` calls don't reference stale features.
   */
  _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void {
    for (const sourceId of sourceIds) {
      const prefix = `${sourceId}:`;
      for (const key of this._layerArcFlagsCache.keys()) {
        if (key.startsWith(prefix)) this._layerArcFlagsCache.delete(key);
      }
      this._featureQuery?.clear(sourceId);
    }
  }

  // ---------------------------------------------------------------------------
  // Edit history (undo / redo)
  // ---------------------------------------------------------------------------

  /**
   * Push an executed `EditCommand` onto the undo stack.
   *
   * Per the memento pattern, the caller is expected to have already performed
   * the work; the command captures what changed so the operation can be
   * reversed on undo. `pushCommand` does NOT call `cmd.do()`. It clears any
   * pending redo entries and fires `historychange`.
   */
  public pushCommand(cmd: EditCommand): void {
    this._history.push(cmd);
    this._fireHistoryChange();
  }

  /**
   * Reverse the most recent command. No-op when there is nothing to undo.
   * Fires `historychange` and schedules a re-render after the reversal.
   */
  public undo(): boolean {
    const cmd = this._history.undo();
    if (!cmd) return false;
    this._fireHistoryChange();
    // Any command that touched `layer.shapes` (delete/create/...) will have
    // moved feature ids around; invalidate every shape-derived cache rather
    // than threading per-command source ids through the history.
    this._invalidateAllShapeCaches();
    this._scheduleRender();
    return true;
  }

  /**
   * Re-apply the most recently undone command. No-op when there is nothing
   * to redo. Fires `historychange` and schedules a re-render.
   */
  public redo(): boolean {
    const cmd = this._history.redo();
    if (!cmd) return false;
    this._fireHistoryChange();
    this._invalidateAllShapeCaches();
    this._scheduleRender();
    return true;
  }

  /** Drop every shape-derived cache. Used by undo/redo where per-source
   *  invalidation isn't tracked. */
  private _invalidateAllShapeCaches(): void {
    this._layerArcFlagsCache.clear();
    for (const id of this._sources.keys()) this._featureQuery?.clear(id);
  }

  public canUndo(): boolean {
    return this._history.canUndo();
  }

  public canRedo(): boolean {
    return this._history.canRedo();
  }

  /** Empty both undo and redo stacks. Fires `historychange` if non-empty. */
  public clearHistory(): void {
    const wasNonEmpty = this._history.canUndo() || this._history.canRedo();
    this._history.clear();
    if (wasNonEmpty) this._fireHistoryChange();
  }

  /**
   * Begin an atomic multi-step edit. Every op or edit command pushed
   * during the returned transaction's lifetime is staged; on
   * `commit(label)` they collapse into a single undo entry, on
   * `rollback()` every touched source's dataset is restored to its
   * pre-transaction state and the selection is reverted.
   *
   * Throws if a transaction is already active — nesting isn't supported.
   *
   * @example
   * const tx = engine.beginTransaction();
   * const r1 = await engine.ops.clipLayer({ source, target, mask });
   * if (!r1.ok) { tx.rollback(); return; }
   * const r2 = await engine.ops.dissolveLayer({ source, target, field: 'STATE' });
   * if (!r2.ok) { tx.rollback(); return; }
   * await tx.commit('Process boundaries');
   */
  public beginTransaction(): Transaction {
    return new Transaction(this);
  }

  /**
   * Bind Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z / Ctrl+Y (redo) on the given
   * element (default: the canvas container). Returns an unbind function. Calls
   * to this method are idempotent — subsequent calls unbind the prior binding.
   */
  public bindHistoryShortcuts(target?: HTMLElement): () => void {
    this._historyShortcutUnbind?.();
    const el = target ?? this._canvasContainer;
    // Ensure the element can receive focus so it gets keydown events.
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');

    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';
      if (isZ && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if ((isZ && e.shiftKey) || isY) {
        e.preventDefault();
        this.redo();
      }
    };
    el.addEventListener('keydown', handler);
    const unbind = () => {
      el.removeEventListener('keydown', handler);
      if (this._historyShortcutUnbind === unbind) this._historyShortcutUnbind = null;
    };
    this._historyShortcutUnbind = unbind;
    return unbind;
  }

  _fireHistoryChange(): void {
    const snap: HistoryStateSnapshot = this._history.snapshot();
    this.fire('historychange', snap);
  }

  /**
   * Internal — fan out every `'after-commit'` validator and fire
   * `validationfailed` for the subset whose report is `!ok`. Skipped
   * cheaply when no validators are registered (no microtask, no
   * allocations).
   *
   * Ignored when the host has been removed mid-flight; the validator
   * may have started against a dataset that's no longer the current
   * one but its result is irrelevant once the host is gone.
   */
  private _runAfterCommitValidators(): void {
    if (this._validators.size === 0) return;
    const top = this._history.snapshot();
    const change = { label: top.label ?? '' };
    void this._validators.runFor('after-commit', this, change).then((results) => {
      if (this._removed) return;
      const failed = results.filter((r) => !r.report.ok);
      if (failed.length > 0) {
        this.fire('validationfailed', { results: failed, label: change.label });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Whole-dataset operations (clip / erase / future dissolve, buffer, ...)
  // ---------------------------------------------------------------------------

  /**
   * Clip a layer to the polygons in a mask layer using mapshaper's `-clip`
   * pipeline. Target and mask must live in the same source. Returns `true`
   * on success, `false` for unresolvable source / target / mask.
   *
   * The operation is recorded as a single undoable history entry. Note that
   * dataset-replace operations clear prior fine-grained edit history (see
   * design.md for the rationale).
   */

  /**
   * Translate every selected feature by `(dx, dy)` in source-data coordinates.
   * Returns `false` for an empty selection or zero offset.
   *
   * Lightweight in-place mutation — does not replace the dataset, does not
   * clear the selection, composes freely with other commands in one undo
   * timeline. For multi-source selections, one `FeatureTranslateCommand` is
   * built per source and they are wrapped in a single `CompositeCommand` so
   * one undo reverses the whole nudge.
   *
   * Known limitation: arcs shared with unselected features will be translated
   * along with the selection, distorting the unselected neighbours. Safe for
   * isolated features and contiguous polygon subsets; documented in the spec.
   */

  /**
   * @deprecated Prefer `emap.layers.resolve(sourceId, layerId)`. Kept as a
   * thin shim while the composed managers migrate over.
   */
  _resolveLayer(sourceId: string, layerId: string): MapshaperLayer | null {
    return this.layers.resolve(sourceId, layerId);
  }


  /**
   * Tear the map down: cancel pending renders, detach every `data` listener
   * we attached to sources, release each registered control, kill the worker
   * pool, and unmount the canvas. Idempotent — calling it twice is safe.
   *
   * After `remove()` the instance must not be reused. Public methods that
   * touch DOM / timers are left in place for now (they will fail naturally
   * when the underlying resources are gone), but `_scheduleRender` is
   * guarded so post-teardown event firings don't queue another frame.
   */
  public remove(): void {
    if (this._removed) return;
    this._removed = true;

    // Cancel any in-flight RAF so we don't paint after teardown.
    if (this._rafId !== 0) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    this._pendingRender = 0;
    this._pendingAction = 'redraw';
    this._pendingNavDelta = null;
    this._navSnapshotTransform = null;
    if (this._wheelSettleTimer !== null) {
      clearTimeout(this._wheelSettleTimer);
      this._wheelSettleTimer = null;
    }
    this._scheduler?.dispose();

    // Interaction handlers
    this._handlers?.detach();
    this._scrollZoom?.destroy();
    this._historyShortcutUnbind?.();
    this._historyShortcutUnbind = null;

    // Worker pool — cancelAll first to fail any in-flight ops cleanly,
    // then destroy to terminate the worker.
    if (this._workerPool) {
      this._workerPool.cancelAll();
      this._workerPool.destroy();
      this._workerPool = null;
    }

    // Source `data` listeners installed in `addSource()` — without this
    // the source keeps the Emap instance alive via the closure inside
    // `onData` and (worse) re-fires render scheduling after teardown.
    for (const [id, listener] of this._sourceListeners) {
      const source = this._sources.get(id);
      source?.off('data', listener);
    }
    this._sourceListeners.clear();

    // Per-source feature query + arc-flag caches.
    for (const id of this._sources.keys()) this._featureQuery?.clear(id);
    this._layerArcFlagsCache.clear();
    this._sources.clear();

    // Released registered controls. Each `onRemove` is responsible for its
    // own DOM detach; we just orchestrate. Iterate over a copy because
    // some controls may call `removeControl(self)` from inside `onRemove`.
    // The field initializer normally seeds an empty array; guard for the
    // test path that builds an Emap via `Object.create(Emap.prototype)`.
    const controls = this._controls ?? [];
    for (const control of [...controls]) {
      try {
        control.onRemove(this);
      } catch (err) {
        // A throwing control mustn't block teardown of the rest. Surface
        // via the error event so callers can still observe it.
        this.fire('error', { error: err });
      }
    }
    controls.length = 0;
    this._controlContainers?.clear();

    // Active edit overlay state — clearing through the store fires the
    // change callback, which is harmless after `_removed` because
    // `_scheduleRender` short-circuits.
    this._editState?.setMode('none');

    if (this._container && this._canvasContainer) {
      this._container.removeChild(this._canvasContainer);
    }
  }
  /** Read by composed managers via `EmapHostInternal._removed`. */
  _removed = false;
}

/**
 * Cheap pre-validator for `.msx` (mapshaper-pack) bytes. Looks for any
 * msgpack map marker as the first byte; that's the only structural rule
 * `unpackSessionData` requires (the rest of the format is a content map).
 *
 * Exported for tests that want to assert the boundary.
 */
function _looksLikeMsxBytes(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length === 0) return false;
  const b = bytes[0];
  return (
    (b >= 0x80 && b <= 0x8f) // fixmap
    || b === 0xde // map16
    || b === 0xdf // map32
  );
}

import { EventDispatcher } from '../core/events';
import { Bounds } from '../geo/bounds';
import { AffineTransform } from '../geo/transform';
import { Viewport } from '../geo/viewport';
import {
  Camera,
  type CameraOptions,
  type AnimationOptions,
  type FlyToOptions,
  type FitBoundsOptions,
} from '../geo/camera';
import { Projection } from '../geo/projection';
import {
  ScaleCalculator,
  type GetScaleMetricsOptions,
  type ScaleView,
  type ScaleViewMetrics,
} from '../geo/scale-calculator';
import {
  EpsgProjectionError,
  isWebMercatorCrs,
  normalizeProjectCrs,
  normalizeProjectCrsMetadata,
  resolveDatasetCRSMetadata,
  resolveProjectCrs,
  resolveProjectCrsDefinition,
  setDatasetCrsMetadata,
} from '../geo/crs-resolver';
import { Painter } from '../renderer/painter';
import { CanvasPainter } from '../renderer/canvas-painter';
import { EditOverlayRenderer } from '../renderer/edit-overlay-renderer';
import { RenderScheduler, type RenderSnapshot } from '../renderer/render-scheduler';
import { MapshaperOps } from './mapshaper-ops';
import { EditSessions } from './edit-sessions';
import { AttributeOps } from './attribute-ops';
import { EditStateStore, type EditMode } from './edit-state-store';
import { LayerRegistry } from './layer-registry';
import {
  isMutableTopologySource,
  type MutableTopologySource,
  type TopologySource,
} from '../source/source';
import { TopologySource as ConcreteTopologySource } from '../source/topology-source';
import { ScrollZoomHandler } from '../core/handlers/scroll-zoom';
import type { ScrollZoomOptions } from '../core/handlers/scroll-zoom';
import { DragPanHandler } from '../core/handlers/drag-pan';
import type { DragPanOptions } from '../core/handlers/drag-pan';
import type { EditHandlerHost } from '../core/handlers/edit-handler-host';
import { ClickSelectHandler, type SelectHandlerOptions } from '../core/handlers/click-select';
import { BoxSelectHandler, type BoxSelectHandlerOptions } from '../core/handlers/box-select';
import { LassoSelectHandler, type LassoSelectHandlerOptions } from '../core/handlers/lasso-select';
import { VertexEditHandler, type VertexEditOptions } from '../core/handlers/vertex-edit';
import { DrawFeatureHandler, type DrawFeatureOptions } from '../core/handlers/draw-feature';
import {
  TransformFeatureHandler,
  type TransformFeatureOptions,
} from '../core/handlers/transform-feature';
import type { Handler } from '../core/handler';
import { HandlerManager } from '../core/handler-manager';
import { MapshaperWorkerPool } from '../core/mapshaper-worker-pool';
import {
  FeatureEventDispatcher,
  type FeatureEvent,
  type FeatureEventFilter,
} from '../core/feature-event-dispatcher';
import { PointerEventDispatcher, type PointerMoveEvent } from '../core/pointer-event-dispatcher';
import { type EventListener } from '../core/events';
import type { EmapEventMap, LayerChangeReason } from '../core/event-map';
import { FeatureQuery } from './feature-query';
import { FeatureAccessor } from './feature-accessor';
import { ValidatorRegistry } from '../validation/registry';
import { HighlightManager } from './highlight-manager';
import { Selection, type SelectMode, SelectionDiff } from './selection';
import { EditHistory, HistoryStateSnapshot } from '../edit/edit-history';
import type { EditCommand } from '../edit/edit-command';
import { Transaction, type TransactionInternal } from '../edit/transaction';
import { ReprojectMapCommand } from '../edit/commands/reproject-map';
// `MapshaperOps`, `EditSessions`, `AttributeOps` are composed onto `Emap`
// via the `ops` / `editSession` / `attributes` getters below.
import type { ControlContract, ControlPosition } from '../ui/control-contract';
import { getLayerId } from '../source/layer-utils';
import { cloneLayerSpecification, DEFAULT_LAYER_COLOR, type LayerSpecification } from './layer';
import type {
  ArcCollection,
  MapshaperDataset,
  MapshaperLayer,
  PathShape,
} from '../types/mapshaper-types';
import { exportSnapshotFromSources, unpackSnapshot } from './snapshot';
import { deleteSelectedFeatures } from './delete-selected';
import { renderLayers } from './layer-renderer';
import {
  addLayerKey,
  getLayerValue,
  setLayerValue,
  type MutableLayerKeyIndex,
  type MutableLayerValueIndex,
} from './structured-keys';
// All public type/option surfaces moved to `./types`. Re-export here so
// existing `import { MapOptions, ... } from './map'` paths keep working.
export * from './types';
export type * from './source-loading';
import {
  createReadySourceLoadPlan,
  createSourceLoadDraft,
  consumeReadySourceLoadPlan,
  getSourceLoadDraftState,
  SourceLoadError,
  type PreparedDatasetCommit,
  type ReadySourceLoadPlan,
  type ReadySourceLoadState,
  type SourceLoadAnswers,
  type SourceLoadDiagnostic,
  type SourceLoadDraft,
  type SourceLoadRequest,
  type SourceLoadState,
  type SourcePreflightResult,
} from './source-loading';
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
import type { MapLibreIntegrationOptions, MapLibreServiceManager } from './maplibre-service';
import { createMapLibreServiceManager } from './maplibre-service-manager';

interface PreparedSourceRegistration {
  readonly token: symbol;
  readonly state: ReadySourceLoadState;
  readonly dataset: MapshaperDataset;
  readonly targetCrs: string;
  readonly expectedMapCrs?: string;
}

function sourceLoadError(code: SourceLoadDiagnostic['code'], message: string): SourceLoadError {
  return new SourceLoadError(code, [{ code, severity: 'error', message }]);
}

function renderedLayersEqual(
  left: readonly LayerSpecification[],
  right: readonly LayerSpecification[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((layer, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      layer.id === candidate.id &&
      layer.type === candidate.type &&
      layer.source === candidate.source &&
      layer['source-layer'] === candidate['source-layer'] &&
      (layer.layout?.visibility ?? 'visible') === (candidate.layout?.visibility ?? 'visible')
    );
  });
}

interface ScaleViewSample {
  px: number;
  py: number;
  coordinate: [number, number];
}

interface ScaleViewSnapshot {
  view: ScaleView;
  samples: ScaleViewSample[];
}

function captureScaleView(viewport: Viewport, crs: string): ScaleViewSnapshot | null {
  const width = viewport.width;
  const height = viewport.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const x = width / 2;
  const samples: ScaleViewSample[] = [];
  try {
    for (const py of [0, height / 2, height]) {
      for (const px of [x, x + 1]) {
        samples.push({ px, py, coordinate: viewport.unproject(px, py) });
      }
    }
  } catch {
    return null;
  }

  return {
    samples,
    view: {
      crs,
      width,
      height,
      unproject(px, py): [number, number] {
        const sample = samples.find((candidate) => candidate.px === px && candidate.py === py);
        if (!sample) throw new Error('Scale view requested a coordinate outside its snapshot');
        return [...sample.coordinate];
      },
    },
  };
}

function isScaleViewCurrent(viewport: Viewport, crs: string, snapshot: ScaleViewSnapshot): boolean {
  if (
    crs !== snapshot.view.crs ||
    viewport.width !== snapshot.view.width ||
    viewport.height !== snapshot.view.height
  ) {
    return false;
  }

  try {
    return snapshot.samples.every((sample) => {
      const current = viewport.unproject(sample.px, sample.py);
      return current[0] === sample.coordinate[0] && current[1] === sample.coordinate[1];
    });
  } catch {
    return false;
  }
}

/**
 * Canvas map engine that owns sources, layers, camera state, controls, and edit history.
 *
 * @example
 * const map = new Emap({ container: 'map' });
 * await map.addSource('example', source);
 * map.addLayer({ id: 'points', type: 'circle', source: 'example' });
 */
export class Emap extends EventDispatcher {
  private _container: HTMLElement;
  private _canvasContainer: HTMLElement;
  private _canvas: HTMLCanvasElement;
  private _painter: Painter;
  private _editOverlay: EditOverlayRenderer;
  private _scheduler!: RenderScheduler;
  private _viewport: Viewport = new Viewport();
  private _scaleCalculator?: ScaleCalculator;
  private _projection: Projection = new Projection();
  private _camera!: Camera;
  // Accessed by composed managers via `EmapHostInternal`. Treat as
  // read-only outside this class.
  _sources: globalThis.Map<string, MutableTopologySource> = new globalThis.Map();
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
  private _sourceListeners = new globalThis.Map<
    string,
    EventListener<{ reason?: 'load' | 'replace' | 'reproject' }>
  >();
  private _pendingSourceCommits = new globalThis.Map<string, symbol>();
  private _crsEstablished = false;
  private _layers: LayerSpecification[] = [];
  private _effectiveLayersCache: LayerSpecification[] = [];
  private _defaultLayersDirty = true;
  private _layerArcIdsCache: globalThis.Map<string, globalThis.Map<MapshaperLayer, Uint32Array>> =
    new globalThis.Map();

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
  private _dragPanSuspendedByEdit = false;
  private _dragPanEnabledBeforeEditSuspend = false;

  // Rendering
  private _pendingRender = 0;
  private _rafId = 0;
  private _pendingAction: RenderAction = 'redraw';
  private _pendingNavDelta: AffineDelta | null = null;
  private _pendingRedrawIsSettle = false;
  private _navSnapshotTransform: { mx: number; my: number; bx: number; by: number } | null = null;
  private _wheelSettleTimer: number | NodeJS.Timeout | null = null;
  private static readonly _WHEEL_SETTLE_MS = 250;

  // UI controls
  private _controlContainers: globalThis.Map<ControlPosition, HTMLElement> = new globalThis.Map();
  // Track every `addControl()` instance so `remove()` can call
  // `onRemove()` on each. We intentionally don't drop entries on
  // `removeControl()` — that would require both an Array and a Set —
  // and the array is short-lived so the duplicate is harmless.
  private _controls: ControlContract<Emap>[] = [];

  private _mapLibreOptions?: MapLibreIntegrationOptions;
  private _mapLibreServices?: ReturnType<typeof createMapLibreServiceManager>;

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
      this._syncEditModeDragPan(change.current.mode);
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

  /**
   * Create a map inside an existing container element.
   *
   * @param options Container, interaction, worker, and rendering options for the map.
   */
  /**
   * Create a map engine in an existing DOM container.
   *
   * @param options Required {@link MapOptions} object; must include a valid
   * container id string or `HTMLElement`. Optional fields may be omitted:
   * interaction defaults to enabled, expression evaluation defaults to
   * `'disabled'`, worker routing defaults to main-thread execution, and
   * `workerThreshold` defaults to `50000` vertices.
   * @example
   * ```ts
   * const map = new Emap({ container: 'map' });
   * ```
   */
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
      requestRedraw: () => this._scheduleRender('redraw', undefined, true),
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
      (point) => this._isHoveringSelectedAt(point),
    );
    this._handlers.register(this._dragPan);
    this._handlers.register(this._scrollZoom);
    const handlerHost = this as unknown as EditHandlerHost;
    this._clickSelect = new ClickSelectHandler(handlerHost);
    this._boxSelect = new BoxSelectHandler(handlerHost);
    this._lassoSelect = new LassoSelectHandler(handlerHost);
    this._handlers.register(this._clickSelect);
    this._handlers.register(this._boxSelect);
    this._handlers.register(this._lassoSelect);
    this._vertexEdit = new VertexEditHandler(handlerHost);
    this._handlers.register(this._vertexEdit);
    this._drawFeature = new DrawFeatureHandler(handlerHost);
    this._handlers.register(this._drawFeature);
    this._transformFeature = new TransformFeatureHandler(handlerHost);
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
      queryFeatures: (g, o) =>
        _self.queryFeatures(g, o) as Array<{ source: string; layer: string; id: number }>,
      unproject: (x, y) => _self.unproject(x, y),
      get features() {
        return _self.features;
      },
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

    // Set up the worker pool when worker mode is enabled. Construction is
    // cheap; the underlying Worker is lazy-spawned on first run(). A supplied
    // pool is adopted exclusively and follows this map's remove() lifecycle.
    // When worker mode is disabled, worker options are ignored and ownership
    // remains with the caller.
    this._expressionPolicy = options.expressionPolicy ?? 'disabled';
    this._workerMode = options.useWorker ?? options.workerMode ?? false;
    if (typeof options.workerThreshold === 'number' && options.workerThreshold >= 0) {
      this._workerThreshold = options.workerThreshold;
    }
    this._workerRouting = options.workerRouting;
    if (this._workerMode !== false) {
      if (options.workerPool) {
        this._workerPool = options.workerPool;
      } else {
        this._workerPool = new MapshaperWorkerPool({
          workerUrl: options.workerUrl ?? 'emap-worker.js',
          poolSize: options.workerPoolSize,
        });
      }
    }

    this._mapLibreOptions = options.mapLibre;
    if (this._mapLibreOptions) {
      try {
        this._mapLibreServices = createMapLibreServiceManager(this, this._mapLibreOptions);
      } catch (error) {
        try {
          this.remove();
        } catch {
          // Preserve the original synchronous configuration error.
        }
        throw error;
      }
      void this._mapLibreServices.initialize().catch(() => undefined);
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
    const hasExpression = values.some(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
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

  public get mapLibreServices(): MapLibreServiceManager {
    return (this._mapLibreServices ??= createMapLibreServiceManager(this, this._mapLibreOptions));
  }

  public getEditMode(): EditMode {
    return this._editState.mode;
  }

  public setEditMode(mode: EditMode): void {
    this._editState.setMode(mode);
  }

  private _syncEditModeDragPan(mode: EditMode): void {
    const blocksPan = mode === 'vertex' || mode === 'draw';

    if (blocksPan) {
      if (!this._dragPanSuspendedByEdit) {
        this._dragPanEnabledBeforeEditSuspend = this._dragPan.isEnabled();
        this._dragPan.disable();
        this._dragPanSuspendedByEdit = true;
      }
      return;
    }

    if (!this._dragPanSuspendedByEdit) return;

    if (this._dragPanEnabledBeforeEditSuspend) {
      this._dragPan.enable();
    }
    this._dragPanSuspendedByEdit = false;
    this._dragPanEnabledBeforeEditSuspend = false;
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

    this._scrollZoom.on(
      'mousewheel',
      (e: { direction: number; multiplier: number; x: number; y: number }) => {
        this._ensureNavSnapshot();
        this._viewport.applyWheelZoom(e.direction, e.multiplier, e.x, e.y);
        this._scheduleRender('nav', this._computeNavDelta());
        this.fire('move');
        if (this._wheelSettleTimer !== null) clearTimeout(this._wheelSettleTimer);
        this._wheelSettleTimer = setTimeout(() => {
          this._wheelSettleTimer = null;
          this._endNavGesture();
        }, Emap._WHEEL_SETTLE_MS);
      },
    );
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

    const corners: ControlPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
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

  /**
   * Parse and validate a detached source without changing map or source state.
   * A ready plan is map-bound and can be consumed once by {@link confirmSource}.
   */
  public async preflightSource(request: SourceLoadRequest): Promise<SourcePreflightResult>;
  public async preflightSource(
    draft: SourceLoadDraft,
    answers: SourceLoadAnswers,
  ): Promise<SourcePreflightResult>;
  public async preflightSource(
    requestOrDraft: SourceLoadRequest | SourceLoadDraft,
    answers: SourceLoadAnswers = {},
  ): Promise<SourcePreflightResult> {
    if (this._removed) {
      return {
        status: 'rejected',
        diagnostics: [
          {
            code: 'source-load-cancelled',
            severity: 'error',
            message: 'Cannot preflight a source after the map has been removed',
          },
        ],
      };
    }
    let state: SourceLoadState;
    let draft: SourceLoadDraft;
    let suppliedCrs: string | undefined;

    if ('kind' in requestOrDraft) {
      const draftState = getSourceLoadDraftState(this, requestOrDraft);
      if (!draftState) {
        return {
          status: 'rejected',
          diagnostics: [
            {
              code: 'source-plan-invalid',
              severity: 'error',
              message: 'Source load draft is invalid or belongs to another map',
            },
          ],
        };
      }
      state = draftState;
      draft = requestOrDraft;
      suppliedCrs = answers.sourceCrs;
    } else {
      const id = requestOrDraft.id;
      if (this._sources.has(id)) {
        return {
          status: 'rejected',
          diagnostics: [
            {
              code: 'source-id-conflict',
              severity: 'error',
              message: `Source "${id}" already exists`,
            },
          ],
        };
      }

      let source: TopologySource;
      if ('source' in requestOrDraft) {
        source = requestOrDraft.source;
      } else {
        const parsedSource = new ConcreteTopologySource(id, requestOrDraft.sourceOptions);
        try {
          await parsedSource.setData(requestOrDraft.input);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Source parsing failed';
          return {
            status: 'rejected',
            diagnostics: [{ code: 'source-load-rejected', severity: 'error', message }],
          };
        }
        source = parsedSource;
      }

      if (!isMutableTopologySource(source)) {
        return {
          status: 'rejected',
          diagnostics: [
            {
              code: 'source-load-rejected',
              severity: 'error',
              message: `Source "${id}" does not implement the mutable topology contract`,
            },
          ],
        };
      }
      const dataset = source.getDataset();
      if (!dataset) {
        return {
          status: 'rejected',
          diagnostics: [
            {
              code: 'source-load-rejected',
              severity: 'error',
              message: `Source "${id}" has no parsed dataset`,
            },
          ],
        };
      }
      state = {
        owner: this,
        id,
        source,
        dataset,
        editVersion: dataset.editVersion ?? 0,
        metadataCrs: resolveDatasetCRSMetadata(dataset),
        mapCrs: this._crsEstablished ? this._projection.crs : undefined,
      };
      draft = createSourceLoadDraft(state);
      suppliedCrs = requestOrDraft.sourceCrs;
    }

    const summaryBase = {
      id: state.id,
      layerCount: state.dataset.layers.length,
      metadataCrs: state.metadataCrs,
    };
    const hasSuppliedCrs = suppliedCrs !== undefined;
    const trimmedCrs = suppliedCrs?.trim();
    if (hasSuppliedCrs && !trimmedCrs) {
      return {
        status: 'needs-input',
        draft,
        requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'invalid' }],
        summary: summaryBase,
        diagnostics: [
          {
            code: 'source-crs-invalid',
            severity: 'error',
            message: 'Source CRS cannot be empty',
            suppliedCrs: trimmedCrs,
            metadataCrs: state.metadataCrs,
          },
        ],
      };
    }
    const candidateCrs = trimmedCrs ?? state.metadataCrs;
    if (!candidateCrs) {
      return {
        status: 'needs-input',
        draft,
        requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'missing' }],
        summary: summaryBase,
        diagnostics: [],
      };
    }

    let resolvedCandidate;
    try {
      resolvedCandidate = await resolveProjectCrsDefinition(candidateCrs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Source CRS is invalid';
      return {
        status: 'needs-input',
        draft,
        requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'invalid' }],
        summary: summaryBase,
        diagnostics: [
          {
            code: 'source-crs-invalid',
            severity: 'error',
            message,
            suppliedCrs: trimmedCrs,
            metadataCrs: state.metadataCrs,
          },
        ],
      };
    }

    const effectiveCrs = normalizeProjectCrsMetadata(candidateCrs) ?? candidateCrs;
    const diagnostics: SourceLoadDiagnostic[] = [];
    if (trimmedCrs && state.metadataCrs) {
      try {
        const resolvedMetadata = await resolveProjectCrsDefinition(state.metadataCrs);
        if (resolvedMetadata.signature !== resolvedCandidate.signature) {
          diagnostics.push({
            code: 'source-crs-overrides-metadata',
            severity: 'warning',
            suppliedCrs: trimmedCrs,
            metadataCrs: state.metadataCrs,
            effectiveCrs,
          });
        }
      } catch {
        diagnostics.push({
          code: 'source-crs-overrides-metadata',
          severity: 'warning',
          suppliedCrs: trimmedCrs,
          metadataCrs: state.metadataCrs,
          effectiveCrs,
        });
      }
    }

    return {
      status: 'ready',
      plan: createReadySourceLoadPlan(state, effectiveCrs),
      summary: { ...summaryBase, sourceCrs: effectiveCrs },
      diagnostics,
    };
  }

  /**
   * Register a source through preflight and confirmation.
   * Independent maps, including maps in separate browser tabs, must receive
   * separate mutable source instances.
   */
  public async addSource(
    id: string,
    source: TopologySource,
    answers: SourceLoadAnswers = {},
  ): Promise<void> {
    const result = await this.preflightSource({ id, source, sourceCrs: answers.sourceCrs });
    if (result.status === 'ready') {
      await this.confirmSource(result.plan);
      return;
    }

    const diagnostics =
      result.diagnostics.length > 0
        ? result.diagnostics
        : [
            {
              code: 'source-crs-required' as const,
              severity: 'error' as const,
              message: `Source "${id}" requires an explicit CRS`,
            },
          ];
    throw new SourceLoadError(diagnostics[0].code, diagnostics);
  }

  /** Atomically normalize and register a source from a ready preflight plan. */
  public async confirmSource(plan: ReadySourceLoadPlan): Promise<void> {
    const state = consumeReadySourceLoadPlan(this, plan);
    if (this._removed) {
      throw sourceLoadError('source-load-cancelled', 'Cannot confirm a source after map removal');
    }
    const pending = (this._pendingSourceCommits ??= new globalThis.Map());
    if (this._sources.has(state.id) || pending.has(state.id)) {
      throw sourceLoadError(
        'source-id-conflict',
        `Source "${state.id}" already exists or is loading`,
      );
    }
    if (
      state.mapCrs !== undefined &&
      (!this._crsEstablished || this._projection.crs !== state.mapCrs)
    ) {
      throw sourceLoadError(
        'source-plan-stale',
        `Map CRS changed after source "${state.id}" was preflighted`,
      );
    }

    const token = Symbol(state.id);
    pending.set(state.id, token);
    try {
      for (;;) {
        this._assertSourceLoadState(state, token);
        const expectedMapCrs = this._crsEstablished ? this._projection.crs : undefined;
        const targetCrs = expectedMapCrs ?? state.sourceCrs;
        let prepared: MapshaperDataset = {
          ...state.dataset,
          info: { ...state.dataset.info },
        };
        setDatasetCrsMetadata(prepared, state.sourceCrs);

        const [resolvedSource, resolvedTarget] = await Promise.all([
          resolveProjectCrsDefinition(state.sourceCrs),
          resolveProjectCrsDefinition(targetCrs),
        ]);
        if (resolvedSource.signature !== resolvedTarget.signature) {
          const targetMetadata = normalizeProjectCrsMetadata(targetCrs) ?? targetCrs;
          prepared = await state.source.prepareReprojectDataset(
            prepared,
            targetCrs,
            targetMetadata,
          );
        }

        this._assertSourceLoadState(state, token);
        const preparedCrs = resolveDatasetCRSMetadata(prepared);
        if (
          !preparedCrs ||
          (await resolveProjectCrsDefinition(preparedCrs)).signature !== resolvedTarget.signature
        ) {
          throw sourceLoadError(
            'source-load-rejected',
            `Prepared dataset for source "${state.id}" does not match map CRS`,
          );
        }
        if (
          this._commitPreparedSource({
            token,
            state,
            dataset: prepared,
            targetCrs,
            expectedMapCrs,
          })
        ) {
          return;
        }
      }
    } finally {
      if (pending.get(state.id) === token) pending.delete(state.id);
    }
  }

  private _commitPreparedSource(registration: PreparedSourceRegistration): boolean {
    const { token, state, dataset, targetCrs, expectedMapCrs } = registration;
    this._assertSourceLoadState(state, token);
    const currentMapCrs = this._crsEstablished ? this._projection.crs : undefined;
    if (currentMapCrs !== expectedMapCrs) {
      if (state.mapCrs === undefined) return false;
      throw sourceLoadError(
        'source-plan-stale',
        `Map CRS changed while source "${state.id}" was being prepared`,
      );
    }
    if ((expectedMapCrs ?? state.sourceCrs) !== targetCrs) {
      throw sourceLoadError(
        'source-plan-stale',
        `Source "${state.id}" was prepared for a stale map CRS`,
      );
    }

    const { id, source } = state;
    const previousMapCrs = this._projection.crs;
    const previousCrsEstablished = this._crsEstablished;
    const previousDefaultLayersDirty = this._defaultLayersDirty;
    const renderedLayersBefore = this.getRenderedLayers();
    const adoptedMapCrs = expectedMapCrs === undefined;
    const onData: EventListener<{ reason?: 'load' | 'replace' | 'reproject' }> = (event) => {
      this._handleSourceData(id, source, event);
    };

    try {
      source.setDatasetNormalizer((nextDataset) =>
        this._normalizeSourceDataset(id, source, nextDataset),
      );
      source.setManagedCRS(() => this._projection.crs);
      source.setDataset(dataset, false);
      if (adoptedMapCrs) {
        this._projection.setCRS(targetCrs);
        this._viewport.setCRS(targetCrs);
        this._crsEstablished = true;
      }
      this._sources.set(id, source);
      this._sourceListeners.set(id, onData);
      source.on('data', onData);

      this._pendingSourceCommits.delete(id);
      this._handleSourceData(id, source, { reason: 'load' }, renderedLayersBefore, adoptedMapCrs);
      return true;
    } catch (error: unknown) {
      source.off('data', onData);
      this._sourceListeners.delete(id);
      if (this._sources.get(id) === source) this._sources.delete(id);
      source.setDatasetNormalizer(null);
      source.setManagedCRS(null);
      source.setDataset(state.dataset, false);
      if (adoptedMapCrs) {
        this._projection.setCRS(previousMapCrs);
        this._viewport.setCRS(previousMapCrs);
      }
      this._crsEstablished = previousCrsEstablished;
      this._defaultLayersDirty = previousDefaultLayersDirty;
      throw error;
    }
  }

  private _assertSourceLoadState(state: ReadySourceLoadState, token: symbol): void {
    if (this._pendingSourceCommits.get(state.id) !== token) {
      throw sourceLoadError('source-load-cancelled', `Source load for "${state.id}" was cancelled`);
    }
    const dataset = state.source.getDataset();
    if (dataset !== state.dataset || (dataset.editVersion ?? 0) !== state.editVersion) {
      throw sourceLoadError(
        'source-plan-stale',
        `Source "${state.id}" changed after it was preflighted`,
      );
    }
    if (this._sources.has(state.id)) {
      throw sourceLoadError('source-id-conflict', `Source "${state.id}" already exists`);
    }
  }

  private _handleSourceData(
    id: string,
    source: MutableTopologySource,
    event: { reason?: 'load' | 'replace' | 'reproject' },
    renderedLayersBefore = this.getRenderedLayers(),
    crsChanged = false,
  ): void {
    if (this._sources.get(id) !== source) return;
    this._defaultLayersDirty = true;
    this._invalidateShapeCachesForSources([id]);
    const renderedLayersAfter = this.getRenderedLayers();
    if (!renderedLayersEqual(renderedLayersBefore, renderedLayersAfter)) {
      this._fireLayerChange('effective', undefined, renderedLayersAfter);
    }
    if (event.reason === 'load') {
      this._clearHistory();
    }
    if (crsChanged) this.fire('crschange');
    this.fire('data', { sourceId: id, reason: event.reason });
    this._scheduleRender();
  }

  /**
   * Drop undo/redo entries when the live source set or datasets no longer
   * match the state those commands captured. No-op on an empty history.
   */
  private _clearHistory(): void {
    const history = this._history.snapshot();
    if (history.canUndo || history.canRedo) {
      this._history.clear();
      this._fireHistoryChange();
    }
  }

  private async _normalizeSourceDataset(
    id: string,
    source: MutableTopologySource,
    dataset: MapshaperDataset,
  ): Promise<MapshaperDataset | PreparedDatasetCommit> {
    if (this._sources.get(id) !== source) {
      throw new Error(`Source "${id}" is no longer registered`);
    }
    const sourceCrs = resolveDatasetCRSMetadata(dataset);
    if (!sourceCrs) {
      throw new Error(`Dataset for source "${id}" has no explicit CRS metadata`);
    }

    const targetCrs = this._projection.crs;
    const [resolvedSource, resolvedTarget] = await Promise.all([
      resolveProjectCrsDefinition(sourceCrs),
      resolveProjectCrsDefinition(targetCrs),
    ]);
    this._assertNormalizationCommit(id, source, targetCrs);
    if (resolvedSource.signature === resolvedTarget.signature) {
      return {
        dataset,
        intendedMapCrs: targetCrs,
        assertCommittable: () => this._assertNormalizationCommit(id, source, targetCrs),
      };
    }

    const targetMetadata = normalizeProjectCrsMetadata(targetCrs) ?? targetCrs;
    const projected = await source.prepareReprojectDataset(dataset, targetCrs, targetMetadata);
    this._assertNormalizationCommit(id, source, targetCrs);
    return {
      dataset: projected,
      intendedMapCrs: targetCrs,
      assertCommittable: () => this._assertNormalizationCommit(id, source, targetCrs),
    };
  }

  /**
   * Last-moment validation run both inside normalization and by the source
   * immediately before a normalized dataset becomes observable: the owning
   * registration and the map CRS that authorized it must both still hold.
   */
  private _assertNormalizationCommit(id: string, source: MutableTopologySource, crs: string): void {
    if (this._sources.get(id) !== source) {
      throw new Error(`Source "${id}" is no longer registered`);
    }
    if (this._projection.crs !== crs) {
      throw new Error(`Map CRS changed during source normalization for "${id}"`);
    }
  }

  public removeSource(id: string): void {
    if (this._activeTransaction) {
      throw new Error('Cannot remove a source during an active transaction');
    }
    this._pendingSourceCommits?.delete(id);
    const source = this._sources.get(id);
    if (!source) return;
    const renderedLayersBefore = this.getRenderedLayers();

    const listener = this._sourceListeners.get(id);
    if (listener) source.off('data', listener);
    source.setDatasetNormalizer(null);
    source.setManagedCRS(null);
    this._sourceListeners.delete(id);
    this._sources.delete(id);

    this._layers = this._layers.filter((layer) => layer.source !== id);
    this._defaultLayersDirty = true;
    this._featureQuery.clear(id);
    this._invalidateShapeCachesForSources([id]);
    this._highlightManager.removeSource(id);
    const renderedLayersAfter = this.getRenderedLayers();
    if (!renderedLayersEqual(renderedLayersBefore, renderedLayersAfter)) {
      this._fireLayerChange('effective', undefined, renderedLayersAfter);
    }

    const selected = this._selection.getAll().filter((ref) => ref.source === id);
    if (selected.length > 0) {
      this._fireSelectionChange(this._selection.remove(selected));
    }

    this._clearHistory();
    this._scheduleRender();
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
    return exportSnapshotFromSources(this._sources, opts);
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
    const { datasets, resolvedIds } = await unpackSnapshot(input, opts);

    // Collision check before any side effects when replace=false
    if (!replace) {
      for (const id of resolvedIds) {
        if (this._sources.has(id)) {
          throw new Error(
            `loadSnapshot: source "${id}" already exists (pass { replace: true } to overwrite)`,
          );
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
      src.setDataset(datasets[i]);
      await this.addSource(id, src);
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
      this._layers.splice(idx, 0, cloneLayerSpecification(layer));
    } else {
      this._layers.push(cloneLayerSpecification(layer));
    }
    this._defaultLayersDirty = true;
    this._scheduleRender();
    this._fireLayerChange('add', layer.id);
  }

  public removeLayer(id: string): void {
    const idx = this._layers.findIndex((l) => l.id === id);
    if (idx !== -1) {
      this._layers.splice(idx, 1);
      this._defaultLayersDirty = true;
      this._scheduleRender();
      this._fireLayerChange('remove', id);
    }
  }

  public getLayer(id: string): LayerSpecification | undefined {
    const layer = this._layers.find((candidate) => candidate.id === id);
    return layer ? cloneLayerSpecification(layer) : undefined;
  }

  public getLayers(): readonly LayerSpecification[] {
    return this._layers.map(cloneLayerSpecification);
  }

  public getRenderedLayers(): readonly LayerSpecification[] {
    return this._getEffectiveLayers().map(cloneLayerSpecification);
  }

  public setLayerVisibility(id: string, visibility: 'visible' | 'none'): void {
    let layer = this._layers.find((candidate) => candidate.id === id);
    if (!layer && this._layers.length === 0) {
      const effectiveLayers = this._getEffectiveLayers();
      const index = effectiveLayers.findIndex((candidate) => candidate.id === id);
      if (index === -1) return;
      if ((effectiveLayers[index].layout?.visibility ?? 'visible') === visibility) return;
      this._layers = effectiveLayers.map(cloneLayerSpecification);
      layer = this._layers[index];
    }
    if (!layer || (layer.layout?.visibility ?? 'visible') === visibility) return;
    if (!layer.layout) layer.layout = {};
    layer.layout.visibility = visibility;
    this._scheduleRender();
    this._fireLayerChange('visibility', id);
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
    this._fireLayerChange('effective', id);
  }

  private _fireLayerChange(
    reason: LayerChangeReason,
    layerId?: string,
    renderedLayers?: readonly LayerSpecification[],
  ): void {
    const layers = renderedLayers
      ? renderedLayers.map(cloneLayerSpecification)
      : this.getRenderedLayers();
    this.fire('layerchange', { reason, layerId, layers });
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
          paint: { 'line-color': DEFAULT_LAYER_COLOR, 'line-width': 0.8 },
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
          if (geomType === 'point') {
            defaults.push({
              id: `${sourceId}:${layerId}`,
              type: 'circle',
              source: sourceId,
              'source-layer': layerId,
              paint: { 'circle-color': DEFAULT_LAYER_COLOR, 'circle-radius': 4 },
            });
          } else {
            defaults.push({
              id: `${sourceId}:${layerId}`,
              type: 'line',
              source: sourceId,
              'source-layer': layerId,
              paint: { 'line-color': DEFAULT_LAYER_COLOR, 'line-width': 0.8 },
            });
          }
        }
      }
    }

    this._effectiveLayersCache = defaults;
    this._defaultLayersDirty = false;
    return defaults;
  }

  /**
   * Generates a boolean flag array for arcs that belong to a specific source layer.
   * Cached to prevent walking shapes on every frame.
   *
   * Only meaningful for path layers (polygon/polyline). Point layers have no
   * arc references, so iterating their shapes contributes nothing — caller
   * should filter by `isPathLayer` before invoking.
   */
  private _getLayerArcIds(
    sourceId: string,
    ml: MapshaperLayer,
    arcs: ArcCollection,
  ): Uint32Array | null {
    if (!ml.shapes) return null;

    const sourceCache = this._layerArcIdsCache.get(sourceId);
    const cached = sourceCache?.get(ml);
    if (cached) return cached;

    const seen = new Uint8Array(arcs.size());
    const ids: number[] = [];
    for (const shape of ml.shapes as Array<PathShape | null>) {
      if (!shape) continue;
      for (const part of shape) {
        for (const signedArcId of part) {
          const arcId = signedArcId >= 0 ? signedArcId : ~signedArcId;
          if (seen[arcId] === 1) continue;
          seen[arcId] = 1;
          ids.push(arcId);
        }
      }
    }

    const arcIds = Uint32Array.from(ids);
    const layerCache = sourceCache ?? new globalThis.Map<MapshaperLayer, Uint32Array>();
    layerCache.set(ml, arcIds);
    this._layerArcIdsCache.set(sourceId, layerCache);
    return arcIds;
  }

  private _getVisibleLayerKeys(): MutableLayerKeyIndex {
    const keys: MutableLayerKeyIndex = new globalThis.Map();
    const layers = this._getEffectiveLayers();
    for (const layer of layers) {
      if (layer.layout?.visibility === 'none') continue;
      const source = this._sources.get(layer.source);
      if (!source) continue;
      const ml = this.layers.resolve(layer.source, layer['source-layer']);
      if (ml) {
        const mapshaperLayers = source.getLayers() as MapshaperLayer[];
        const idx = mapshaperLayers.indexOf(ml);
        const lid = getLayerId(ml, idx >= 0 ? idx : 0);
        addLayerKey(keys, layer.source, lid);
      }
    }
    return keys;
  }

  public getCRS(): string {
    return this._projection.crs;
  }

  /**
   * Set the CRS used by an empty map.
   *
   * Once a source is registered, use {@link reproject} so dataset coordinates,
   * source metadata, projection, and viewport remain synchronized.
   */
  public setCRS(crs: string): void {
    if (this._sources.size > 0) {
      throw new Error(
        'Cannot change the map CRS while sources are registered; use map.reproject()',
      );
    }
    this._projection.setCRS(crs);
    this._viewport.setCRS(crs);
    this._crsEstablished = true;
    this.fire('crschange');
  }

  public async reproject(targetCrs: string): Promise<void> {
    if (this._activeTransaction) {
      throw new Error('Cannot reproject during an active transaction');
    }
    if (targetCrs.trim().length === 0) {
      throw new Error('targetCrs must be a non-empty CRS string');
    }
    const targetCrsMetadata = normalizeProjectCrsMetadata(targetCrs);
    const normalizedTarget = await resolveProjectCrs(targetCrs);
    let normalizedCurrent: string;
    try {
      normalizedCurrent = await resolveProjectCrs(this._projection.crs);
    } catch (err) {
      if (!(err instanceof EpsgProjectionError)) throw err;
      normalizedCurrent = normalizeProjectCrs(this._projection.crs);
    }
    if (normalizedCurrent === normalizedTarget) return;

    const beforeView = {
      crs: this._projection.crs,
      extent: this._viewport.extent.clone(),
    };
    // Snapshot every registered source with its current dataset identity.
    // prepareReproject skips sources that have not loaded yet; if one of them
    // commits (or the registry changes) while preparation is in flight, the
    // command must abort instead of switching the CRS around it.
    const sourceDatasets = new Map(
      Array.from(this._sources, ([sourceId, source]) => [sourceId, source.getDataset()]),
    );
    const prepared = await this._projection.prepareReproject(
      normalizedTarget,
      this._sources,
      targetCrsMetadata,
    );
    for (const replacement of prepared.replacements) {
      if (
        this._sources.get(replacement.sourceId) !== replacement.source ||
        replacement.source.getDataset() !== replacement.before ||
        (replacement.before.editVersion ?? 0) !== replacement.beforeEditVersion
      ) {
        throw new Error(`Source "${replacement.sourceId}" changed during reprojection`);
      }
    }
    for (const [sourceId, dataset] of sourceDatasets) {
      const current = this._sources.get(sourceId);
      if (!current || current.getDataset() !== dataset) {
        throw new Error(`Source "${sourceId}" changed during reprojection`);
      }
    }
    if (this._sources.size !== sourceDatasets.size) {
      throw new Error('Map sources changed during reprojection');
    }

    const afterExtent = prepared.extent.hasBounds()
      ? prepared.extent
      : this._viewport.extent.clone();
    const command = new ReprojectMapCommand({
      replacements: prepared.replacements,
      before: beforeView,
      after: { crs: normalizedTarget, extent: afterExtent },
      applyViewState: (state) => this._applyReprojectedView(state.crs, state.extent),
      publishViewState: () => {
        this.fire('crschange');
        this.fire('move');
      },
    });
    command.do();
    this._history.push(command);
    this._invalidateAllShapeCaches();
    this._scheduleRender();
    command.publish();
    this._fireHistoryChange();
  }

  private _applyReprojectedView(crs: string, extent: Bounds): void {
    this._projection.setCRS(crs);
    this._viewport.setCRS(crs);
    this._crsEstablished = true;
    this._viewport.clearInitialState();
    this._clearSpatialIndexesForSources(this._sources.keys());
    if (extent.hasBounds()) this._viewport.setExtent(extent);
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

  /**
   * Measure ground scale for the current view.
   *
   * Converts the center-row pixel step through the CRS ellipsoid geodesic
   * inverse, returning meters-per-pixel and the nominal 1:N denominator at
   * the requested DPI. The Web Mercator zoom level is attached only when
   * the map CRS is Web Mercator. Resolves `null` for unsupported or
   * non-Earth CRSs, empty views, or when the view changed while the
   * measurement was in flight.
   */
  public async getScaleMetrics(
    options: GetScaleMetricsOptions = {},
  ): Promise<ScaleViewMetrics | null> {
    const crs = this.getCRS();
    const snapshot = captureScaleView(this._viewport, crs);
    if (!snapshot) return null;
    const zoom = isWebMercatorCrs(crs) ? this.getZoom() : undefined;
    const metrics = await this._scaleCalculatorInstance().getMetrics(snapshot.view, options);
    if (!metrics || !isScaleViewCurrent(this._viewport, this.getCRS(), snapshot)) return null;
    return zoom === undefined ? metrics : { ...metrics, zoom };
  }

  private _scaleCalculatorInstance(): ScaleCalculator {
    return this._scaleCalculator ?? (this._scaleCalculator = new ScaleCalculator());
  }

  /** The drag-to-pan interaction handler. */
  get dragPan(): Handler<DragPanOptions> {
    return this._dragPan;
  }
  /** The scroll-wheel zoom interaction handler. */
  get scrollZoom(): Handler<ScrollZoomOptions> {
    return this._scrollZoom;
  }
  /** The click-to-select interaction handler (disabled by default). */
  get clickSelect(): Handler<SelectHandlerOptions> {
    return this._clickSelect;
  }
  /** The box-select interaction handler (disabled by default). */
  get boxSelect(): Handler<BoxSelectHandlerOptions> {
    return this._boxSelect;
  }
  /** The lasso-select interaction handler (disabled by default). */
  get lassoSelect(): Handler<LassoSelectHandlerOptions> {
    return this._lassoSelect;
  }
  /** The vertex-edit interaction handler (disabled by default). */
  get vertexEdit(): Handler<VertexEditOptions> {
    return this._vertexEdit;
  }
  /** The draw-feature interaction handler (disabled by default). */
  get drawFeature(): Handler<DrawFeatureOptions> {
    return this._drawFeature;
  }
  /** The transform-feature interaction handler (disabled by default). */
  get transformFeature(): Handler<TransformFeatureOptions> {
    return this._transformFeature;
  }

  public getTransform(): AffineTransform {
    return this._viewport.transform.clone();
  }

  public getExtent(): Bounds {
    return this._viewport.extent.clone();
  }

  public setExtent(bounds: Bounds): void {
    this._viewport.setExtent(bounds);
    this.fire('move');
  }

  public reset(): void {
    const dataExtent = new Bounds();
    for (const source of this._sources?.values() ?? []) {
      dataExtent.merge(source.getExtent());
    }
    if (dataExtent.hasBounds()) {
      this._viewport.clearInitialState();
      this._viewport.setExtent(dataExtent);
    } else {
      this._viewport.reset();
    }
    this._scheduleRender();
    this.fire('move');
  }

  public addControl(control: ControlContract<Emap>, position: ControlPosition = 'top-left'): void {
    const el = control.onAdd(this);
    el.style.pointerEvents = 'auto';
    this._controlContainers.get(position)?.appendChild(el);
    this._controls.push(control);
  }

  public removeControl(control: ControlContract<Emap>): void {
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
  public jumpTo(o: CameraOptions): this {
    this._camera.jumpTo(o);
    return this;
  }
  /** Set centre (projected/data coords) instantly. */
  public setCenter(center: [number, number]): this {
    this._camera.setCenter(center);
    return this;
  }
  /** Set zoom (WebMercator) instantly. */
  public setZoom(zoom: number): this {
    this._camera.setZoom(zoom);
    return this;
  }
  /** Animated move (centre+zoom/scale). */
  public easeTo(o: CameraOptions & AnimationOptions): this {
    this._camera.easeTo(o);
    return this;
  }
  /** Animated pan to a centre. */
  public panTo(center: [number, number], o: AnimationOptions = {}): this {
    this._camera.panTo(center, o);
    return this;
  }
  /** Animated pan by a pixel offset. */
  public panBy(offset: [number, number], o: AnimationOptions = {}): this {
    this._camera.panBy(offset, o);
    return this;
  }
  /** Animated zoom to a level. */
  public zoomTo(zoom: number, o: AnimationOptions = {}): this {
    this._camera.zoomTo(zoom, o);
    return this;
  }
  /** van-Wijk parabolic flight. */
  public flyTo(o: FlyToOptions): this {
    this._camera.flyTo(o);
    return this;
  }
  /** Fit a Bounds into the viewport with optional padding. */
  public fitBounds(b: import('../geo/bounds').Bounds, o: FitBoundsOptions = {}): this {
    this._camera.fitBounds(b, o);
    return this;
  }
  /** Cancel any running camera animation (no-op when idle). */
  public stop(): this {
    this._camera.stop();
    return this;
  }

  _scheduleRender(
    action: RenderAction = 'redraw',
    navDelta?: AffineDelta,
    settleRedraw = false,
  ): void {
    if (this._removed) return;
    const hadPendingRender = this._pendingRender > 0;
    this._pendingRender++;
    if (!hadPendingRender) {
      this._pendingAction = action;
      this._pendingNavDelta = navDelta ? { ...navDelta } : null;
      this._pendingRedrawIsSettle = action === 'redraw' && settleRedraw;
    } else if (
      this._pendingAction === 'redraw' &&
      action === 'nav' &&
      navDelta &&
      this._pendingRedrawIsSettle &&
      this._scheduler.fastActive
    ) {
      this._pendingAction = 'nav';
      this._pendingNavDelta = { ...navDelta };
      this._pendingRedrawIsSettle = false;
    } else if (this._pendingAction === 'redraw' || action === 'redraw') {
      this._pendingAction = 'redraw';
      this._pendingNavDelta = null;
      this._pendingRedrawIsSettle = action === 'redraw' && settleRedraw;
    } else {
      this._pendingAction = 'nav';
      if (navDelta) this._pendingNavDelta = { ...navDelta };
      this._pendingRedrawIsSettle = false;
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
      this._pendingRedrawIsSettle = false;
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
    const vertexState = this._editState.vertex;
    const vertexArcFilter =
      this._editState.mode === 'vertex' && vertexState
        ? this._viewport.getArcFilter(vertexState.arcs as unknown as ArcCollection)
        : undefined;
    this._editOverlay.render(
      this._editState.mode,
      vertexState,
      this._editState.draw,
      this._editState.measurement,
      vertexArcFilter,
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
    renderLayers(
      {
        layers: this._getEffectiveLayers(),
        sources: this._sources,
        viewport: this._viewport,
        painter: this._painter,
        resolveSourceLayer: (sourceId, sourceLayerName) =>
          this.layers.resolve(sourceId, sourceLayerName),
        getLayerArcIds: (sourceId, ml, arcs) => this._getLayerArcIds(sourceId, ml, arcs),
      },
      pixelSize,
      lineScale,
    );
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

  /**
   * Cursor-affordance hit test: is the pointer over a selected feature?
   * Runs on every non-drag pointer event via `DragPanHandler.getCursor`,
   * so it must short-circuit when nothing is selected — otherwise plain
   * hovering (and the mouseup that ends a pan) pays a full spatial hit
   * test on every event, which stutters badly on large datasets.
   */
  private _isHoveringSelectedAt(point: { x: number; y: number }): boolean {
    if (this._selection.size === 0) return false;
    return this.queryFeatures([point.x, point.y]).some((feature) => this.isSelected(feature));
  }

  public queryFeatures(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryFeaturesOptions,
    options?: QueryFeaturesOptions,
  ): QueriedFeature[] {
    const visibleKeys = this._getVisibleLayerKeys();
    const results = this._featureQuery.query(geometryOrOptions, options, visibleKeys);
    const renderRanks: MutableLayerValueIndex<number> = new globalThis.Map();
    const effectiveLayers = this._getEffectiveLayers();
    for (let rank = 0; rank < effectiveLayers.length; rank++) {
      const styleLayer = effectiveLayers[rank];
      if (styleLayer.layout?.visibility === 'none') continue;
      const source = this._sources.get(styleLayer.source);
      if (!source) continue;
      const sourceLayer = styleLayer['source-layer']
        ? this.layers.resolve(styleLayer.source, styleLayer['source-layer'])
        : source.getLayers()[0];
      if (!sourceLayer) continue;
      const sourceLayerIndex = source.getLayers().indexOf(sourceLayer);
      if (sourceLayerIndex === -1) continue;
      const layerId = getLayerId(sourceLayer, sourceLayerIndex);
      setLayerValue(renderRanks, styleLayer.source, layerId, rank);
    }
    results.sort(
      (a, b) =>
        (getLayerValue(renderRanks, b.source, b.layer) ?? -1) -
        (getLayerValue(renderRanks, a.source, a.layer) ?? -1),
    );
    return results;
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
  public select(features: ReadonlyArray<FeatureRef>, options?: { mode?: SelectMode }): void {
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
    const deletion = deleteSelectedFeatures(refs, this._sources);
    if (!deletion) return false;

    this._history.push(deletion.command);
    this._fireHistoryChange();

    // Invalidate caches keyed off `layer.shapes` for every touched source.
    this._invalidateShapeCachesForSources(deletion.sourceIds);

    // Clear the selection; the refs no longer exist.
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
      this._layerArcIdsCache.delete(sourceId);
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
    // Any command that touched `layer.shapes` (delete/create/...) will have
    // moved feature ids around; invalidate every shape-derived cache rather
    // than threading per-command source ids through the history.
    this._invalidateAllShapeCaches();
    this._scheduleRender();
    this._publishCommand(cmd);
    this._fireHistoryChange();
    return true;
  }

  /**
   * Re-apply the most recently undone command. No-op when there is nothing
   * to redo. Fires `historychange` and schedules a re-render.
   */
  public redo(): boolean {
    const cmd = this._history.redo();
    if (!cmd) return false;
    this._invalidateAllShapeCaches();
    this._scheduleRender();
    this._publishCommand(cmd);
    this._fireHistoryChange();
    return true;
  }

  private _publishCommand(command: EditCommand): void {
    if ('publish' in command && typeof command.publish === 'function') {
      command.publish();
    }
  }

  /** Drop every shape-derived cache. Used by undo/redo where per-source
   *  invalidation isn't tracked. */
  private _invalidateAllShapeCaches(): void {
    this._layerArcIdsCache.clear();
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
    for (const [id, source] of this._sources) {
      const listener = this._sourceListeners.get(id);
      if (listener) source.off('data', listener);
      if (isMutableTopologySource(source)) {
        source.setDatasetNormalizer(null);
        source.setManagedCRS(null);
      }
    }
    this._sourceListeners.clear();
    this._pendingSourceCommits?.clear();

    // Per-source feature query + arc-flag caches.
    for (const id of this._sources.keys()) this._featureQuery?.clear(id);
    this._layerArcIdsCache.clear();
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

    let mapLibreDestroyFailure: { error: unknown } | undefined;
    try {
      this._mapLibreServices?.destroy();
    } catch (error) {
      mapLibreDestroyFailure = { error };
    } finally {
      this._mapLibreServices = undefined;
    }

    // Active edit overlay state — clearing through the store fires the
    // change callback, which is harmless after `_removed` because
    // `_scheduleRender` short-circuits.
    this._editState?.setMode('none');

    if (this._container && this._canvasContainer) {
      this._container.removeChild(this._canvasContainer);
    }

    if (mapLibreDestroyFailure) throw mapLibreDestroyFailure.error;
  }
  /** Read by composed managers via `EmapHostInternal._removed`. */
  _removed = false;
}

import { EventDispatcher } from '../core/events';
import { Bounds } from '../geo/bounds';
import { AffineTransform } from '../geo/transform';
import { Viewport } from '../geo/viewport';
import { Projection } from '../geo/projection';
import { Painter } from '../renderer/painter';
import { CanvasPainter } from '../renderer/canvas-painter';
import { CanvasKitPainter } from '../renderer/canvaskit-painter';
import { TopologySource } from '../source/source';
import { TopologySource as ConcreteTopologySource } from '../source/topology-source';
import { MouseWheel } from '../core/interactions';
import { DragPanHandler } from '../core/drag-pan-handler';
import { MapshaperWorkerPool } from '../core/mapshaper-worker-pool';
import { FeatureQuery } from './feature-query';
import { HighlightManager } from './highlight-manager';
import { Selection, SelectMode, SelectionDiff } from './selection';
import { EditHistory, HistoryStateSnapshot } from '../edit/edit-history';
import type { EditCommand } from '../edit/edit-command';
import { CompositeCommand } from '../edit/commands/composite';
import { BulkFeatureDeleteCommand, type BulkFeatureDeleteCommandOptions } from '../edit/commands/feature-delete';
import { FeatureTranslateCommand, TranslatedPointFeature } from '../edit/commands/feature-translate';
import {
  SplitSharedArcsCommand,
  planSharedArcSplit,
} from '../edit/commands/split-shared-arcs';
import {
  FeatureAffineCommand,
  AffineMatrix,
  rotateMatrix,
  scaleMatrix,
  composeMatrix,
  invertMatrix,
  IDENTITY_MATRIX,
} from '../edit/commands/feature-affine';
import { FeaturePropertyChangeCommand } from '../edit/commands/feature-property-change';
import { FieldAddCommand } from '../edit/commands/field-add';
import { FieldRemoveCommand } from '../edit/commands/field-remove';
import { FieldRenameCommand } from '../edit/commands/field-rename';
import mapshaper from 'mapshaper';
import { Control, ControlPosition } from '../ui/control';
import { getLayerId } from '../source/layer-utils';
import { resolveStrokeStyle, resolvePointStyle } from './layer';
import type { LayerSpecification, FillPaint, LinePaint, CirclePaint } from './layer';
import type { MapshaperLayer } from '../types/mapshaper-types';
// All public type/option surfaces moved to `./types`. Re-export here so
// existing `import { MapOptions, ... } from './map'` paths keep working.
export * from './types';
import {
  DEFAULT_WORKER_THRESHOLD,
  type ExpressionEvaluationPolicy,
  type MapOptions,
  type QueryRenderedFeaturesOptions,
  type RenderedFeatureAttributes,
  type DragSessionOptions,
  type FeatureTranslateSession,
  type FeatureAffineSession,
  type FeatureRef,
  type HighlightFeatureRef,
  type ExportSnapshotOptions,
  type LoadSnapshotOptions,
  type HighlightStyle,
  type EditVertexState,
  type EditDrawState,
} from './types';

export class Emap extends EventDispatcher {
  private _container: HTMLElement;
  private _canvasContainer: HTMLElement;
  private _canvas: HTMLCanvasElement;
  private _painter: Painter;
  private _viewport: Viewport = new Viewport();
  private _projection: Projection = new Projection();
  private _sources: globalThis.Map<string, TopologySource> =
    new globalThis.Map();
  private _sourceListeners: globalThis.Map<string, (e: any) => void> =
    new globalThis.Map();
  private _layers: LayerSpecification[] = [];
  private _effectiveLayersCache: LayerSpecification[] = [];
  private _defaultLayersDirty = true;
  private _layerArcFlagsCache: globalThis.Map<string, Uint8Array> = new globalThis.Map();

  // Interactions (delegated)
  private _mouseWheel: MouseWheel;
  private _dragPan: DragPanHandler;

  // Rendering
  private _pendingRender = 0;
  private _rafId = 0;

  // UI controls
  private _controlContainers: globalThis.Map<ControlPosition, HTMLElement> =
    new globalThis.Map();

  // Delegated managers
  private _highlightManager: HighlightManager = new HighlightManager();
  private _featureQuery: FeatureQuery;
  private _selection: Selection = new Selection();
  private _history: EditHistory = new EditHistory();
  private _historyShortcutUnbind: (() => void) | null = null;

  // Edit mode
  private _editMode: 'none' | 'vertex' | 'draw' = 'none';
  private _editVertexState: EditVertexState | null = null;
  private _editDrawState: EditDrawState | null = null;

  // Worker pool — lazily constructed when `useWorker !== false` was passed.
  // null when the option is off (or until the first dataset-replace runs).
  private _workerPool: MapshaperWorkerPool | null = null;
  // Resolved `useWorker` mode: false (off), true (always), or 'auto'
  // (per-call decision based on dataset vertex count).
  private _workerMode: boolean | 'auto' = false;
  // Vertex-count threshold for the 'auto' mode. Defaults to
  // `DEFAULT_WORKER_THRESHOLD` (50_000).
  // Read by the mapshaper-ops mixin via `(this as any)._workerThreshold`; the
  // `_` prefix still signals internal-only.
  _workerThreshold: number = DEFAULT_WORKER_THRESHOLD;
  private _expressionPolicy: ExpressionEvaluationPolicy = 'trusted';

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

    // Select renderer based on options (default: 'canvas')
    if (options.renderer === 'canvaskit' && options.canvasKit) {
      this._painter = new CanvasKitPainter(options.canvasKit, this._canvas);
    } else {
      this._painter = new CanvasPainter(this._canvas);
    }
    this._painter.setPixelRatio(window.devicePixelRatio || 1);

    this._updateSize();

    // Viewport callbacks
    this._viewport.onViewChange = () => this.fire('move');
    this._viewport.initZoomTween();

    // Interactions — both use EventDispatcher pattern
    this._mouseWheel = new MouseWheel(this._canvasContainer);
    this._dragPan = new DragPanHandler(this._canvasContainer);

    // Feature query (delegated)
    this._featureQuery = new FeatureQuery(
      this._sources,
      () => this._viewport.transform,
      () => ({ width: this._viewport.width, height: this._viewport.height }),
      () => this._viewport.initialMX,
    );

    this._attachEventListeners();

    this.on('move', () => this._scheduleRender());
    this.on('resize', () => this._scheduleRender());
    this.on('reset', () => this.reset());

    // Set up the worker pool eagerly when requested. Construction is cheap;
    // the underlying Worker is lazy-spawned on first run().
    this._expressionPolicy = options.expressionPolicy ?? 'trusted';
    this._workerMode = options.useWorker ?? false;
    if (typeof options.workerThreshold === 'number' && options.workerThreshold >= 0) {
      this._workerThreshold = options.workerThreshold;
    }
    if (this._workerMode !== false || options.workerPool) {
      if (options.workerPool) {
        this._workerPool = options.workerPool;
      } else {
        this._workerPool = new MapshaperWorkerPool({
          workerUrl: options.workerUrl ?? 'emap-worker.js',
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
    return this._expressionPolicy ?? 'trusted';
  }

  // Called by mapshaper-ops mixin via `(this as any)._allowExpressionEvaluation`.
  _allowExpressionEvaluation(values: Array<string | undefined>, operation: string): boolean {
    const hasExpression = values.some((value) => typeof value === 'string' && value.trim().length > 0);
    if (!hasExpression || this.getExpressionPolicy() === 'trusted') return true;
    this.fire('error', {
      error: new Error(`${operation}: expression evaluation is disabled`),
    });
    return false;
  }


  public getCanvasContainer(): HTMLElement {
    return this._canvasContainer;
  }

  public getEditMode(): 'none' | 'vertex' | 'draw' {
    return this._editMode;
  }

  public setEditMode(mode: 'none' | 'vertex' | 'draw'): void {
    this._editMode = mode;
    this._dragPan.setEnabled(mode === 'none');
    this.fire('editmodechange', { mode });
  }

  public setEditVertexState(state: EditVertexState): void {
    this._editVertexState = state;
  }

  public clearEditVertexState(): void {
    this._editVertexState = null;
  }

  public setEditDrawState(state: EditDrawState): void {
    this._editDrawState = state;
  }

  public clearEditDrawState(): void {
    this._editDrawState = null;
  }

  private _attachEventListeners(): void {
    this._dragPan.on('pan', (e: { dx: number; dy: number }) => {
      this._viewport.pan(e.dx, e.dy);
      this.fire('move');
    });
    this._dragPan.on('panstart', () => {
      this._viewport.cancelZoomAnimation();
    });

    this._mouseWheel.on('mousewheel', (e: { direction: number; multiplier: number; x: number; y: number }) => {
      this._viewport.applyWheelZoom(e.direction, e.multiplier, e.x, e.y);
      this.fire('move');
    });
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
      for (const type of ['click', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'wheel']) {
        container.addEventListener(type, swallow);
      }

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

    const obj = await mapshaper.internal.exportDatasetsToPack(datasets, { compact });
    (obj as Record<string, unknown>).emap = {
      version: 1,
      sources: ids.map((id) => ({ id })),
    };
    const bytes = mapshaper.internal.pack(obj);
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

    const obj = await mapshaper.internal.unpackSessionData(bytes);
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
      src.setDataset(datasets[i]);
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
   */
  private _getLayerArcFlags(ml: MapshaperLayer, arcs: any, cacheKey: string): Uint8Array | null {
    if (!ml || !ml.shapes || !arcs) return null;
    
    let flags = this._layerArcFlagsCache.get(cacheKey);
    if (flags) return flags;

    const arcCount = arcs.size();
    flags = new Uint8Array(arcCount);
    
    // Tag all arcs used by this layer's shapes
    for (const shape of ml.shapes) {
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
    if (this._projection.crs === targetCrs) return;

    const newExtent = await this._projection.reproject(targetCrs, this._sources);

    this._viewport.setCRS(targetCrs);
    this._viewport.clearInitialState();

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
  }

  public removeControl(control: Control): void {
    control.onRemove(this);
  }

  public zoomIn(): void {
    this._viewport.zoomIn();
  }

  public zoomOut(): void {
    this._viewport.zoomOut();
  }

  private _scheduleRender(): void {
    this._pendingRender++;
    if (this._rafId === 0) {
      this._rafId = requestAnimationFrame(() => this._doRender());
    }
  }

  private _doRender(): void {
    this._rafId = 0;
    if (this._pendingRender > 0) {
      this._pendingRender = 0;
      this.render();
    }
  }

  public render(): void {
    const transform = this._viewport.transform;
    this._painter.setTransform(transform);
    this._painter.clear();

    const lineScale = this._viewport.getLineScale();
    const pixelSize = 1 / Math.abs(transform.mx);
    const effectiveLayers = this._getEffectiveLayers();

    for (const layer of effectiveLayers) {
      if (layer.layout?.visibility === 'none') continue;

      const source = this._sources.get(layer.source);
      if (!source) continue;

      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();

      if (arcs) {
        if (
          arcs.setRetainedInterval &&
          (typeof arcs.isFlat !== 'function' || !arcs.isFlat())
        ) {
          // User-driven `-simplify` writes a sticky floor on the source.
          // Per-frame zoom-LOD raises that floor on zoom-out (smaller scale,
          // bigger pixel) but never below the user's threshold — otherwise
          // every render would re-introduce detail the user just filtered.
          const userFloor = source.getSimplifyFloor?.() ?? 0;
          arcs.setRetainedInterval(Math.max(userFloor, pixelSize * 0.5));
        }
      }

      const ml = this._resolveSourceLayer(source, layer['source-layer']);
      const cacheKey = `${layer.source}:${layer['source-layer'] || 'default'}`;

      if (layer.type === 'line') {
        const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
        
        if (ml?.shapes && arcs) {
          // Optimized layer line rendering: use drawArcs with a boolean arc presence filter
          const flags = this._getLayerArcFlags(ml, arcs, cacheKey);
          const viewportFilter = this._viewport.getArcFilter(arcs);
          
          let combinedFilter;
          if (flags && viewportFilter) {
            combinedFilter = (i: number) => flags[i] === 1 && viewportFilter(i);
          } else if (flags) {
            combinedFilter = (i: number) => flags[i] === 1;
          } else {
            combinedFilter = viewportFilter;
          }
          
          this._painter.drawArcs(arcs, style, combinedFilter);
        } else if (arcs) {
          // Fallback: draw all arcs
          const filter = this._viewport.getArcFilter(arcs);
          this._painter.drawArcs(arcs, style, filter);
        }
      } else if (layer.type === 'fill') {
        if (ml?.shapes && arcs) {
          // Draw fill
          const fillPaint = layer.paint as FillPaint | undefined;
          const fillColor = fillPaint?.['fill-color'] || 'rgba(200, 200, 200, 0.4)';
          const fillOpacity = fillPaint?.['fill-opacity'];
          const painter = this._painter as CanvasPainter;
          if (painter.drawPolygonFill) {
            const filter = this._viewport.getArcFilter(arcs);
            painter.drawPolygonFill(
              ml.shapes,
              arcs,
              fillColor,
              filter,
              fillOpacity,
            );
          }
          // Outline: stroke each topology arc exactly once via the same flag
          // cache the line layer uses. drawPaths(shapes,...) would re-walk
          // every shape and double-stroke shared boundaries — on big polygon
          // datasets that's the dominant cost of fill mode.
          const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
          const flags = this._getLayerArcFlags(ml, arcs, cacheKey);
          const viewportFilter = this._viewport.getArcFilter(arcs);
          let combinedFilter;
          if (flags && viewportFilter) {
            combinedFilter = (i: number) => flags[i] === 1 && viewportFilter(i);
          } else if (flags) {
            combinedFilter = (i: number) => flags[i] === 1;
          } else {
            combinedFilter = viewportFilter;
          }
          this._painter.drawArcs(arcs, style, combinedFilter);
        }
      } else if (layer.type === 'circle') {
        if (ml?.shapes) {
          const style = resolvePointStyle(layer.paint as CirclePaint);
          this._painter.drawPoints(ml.shapes, style);
        }
      }
    }

    // Delegated highlight rendering
    const visibleKeys = this._getVisibleLayerKeys();
    this._highlightManager.renderHighlights(
      this._painter,
      this._sources,
      transform,
      lineScale,
      visibleKeys,
    );

    // Polygon fill in vertex edit mode (drawn before dots so dots appear on top)
    if (
      this._editMode === 'vertex' &&
      this._editVertexState &&
      this._editVertexState.geometryType === 'polygon' &&
      this._editVertexState.polygonFill
    ) {
      const painter = this._painter as CanvasPainter;
      if (painter.drawPolygonFill) {
        painter.drawPolygonFill(
          this._editVertexState.shapes,
          this._editVertexState.arcs as unknown as import('../types/mapshaper-types').ArcCollection,
          this._editVertexState.polygonFill,
        );
      }
    }

    // Vertex dots via Painter interface
    if (
      this._editMode === 'vertex' &&
      this._editVertexState &&
      this._painter.drawVertexDots
    ) {
      this._painter.drawVertexDots(
        this._editVertexState.shapes,
        this._editVertexState.arcs as unknown as import('../types/mapshaper-types').ArcCollection,
        {
          dotColor: '#333',
          dotRadius: 3,
          hoverVertex: this._editVertexState.hoverVertex,
          hoverType: this._editVertexState.hoverType ?? 'vertex',
          hoverColor: '#cc6acc',
          hoverRadius: 6,
        },
      );
    }

    // Drawing overlay (feature creation in progress)
    if (this._editMode === 'draw' && this._editDrawState) {
      const painter = this._painter as CanvasPainter;
      if (painter.drawDrawingOverlay) {
        painter.drawDrawingOverlay(this._editDrawState);
      }
    }

    // Flush GPU commands for CanvasKit
    if (this._painter.flush) {
      this._painter.flush();
    }
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

  public queryRenderedFeatures(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryRenderedFeaturesOptions,
    options?: QueryRenderedFeaturesOptions,
  ): RenderedFeatureAttributes[] {
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
   * Subsequent `queryRenderedFeatures` calls automatically use whatever's
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

  private _clearSpatialIndexesForSources(sourceIds: Iterable<string>): void {
    for (const sourceId of sourceIds) {
      this._featureQuery?.clear(sourceId);
    }
  }

  public setHighlightedFeatures(
    features: Array<RenderedFeatureAttributes | HighlightFeatureRef>,
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
   * @param features Refs to apply. `RenderedFeatureAttributes` is structurally
   *   compatible with `FeatureRef`, so results from `queryRenderedFeatures` can
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

  private _fireSelectionChange(diff: SelectionDiff): void {
    if (!diff.changed) return;
    this.fire('selectionchange', {
      selected: this._selection.getAll(),
      added: diff.added,
      removed: diff.removed,
    });
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
   * frames and `queryRenderedFeatures` calls don't reference stale features.
   */
  private _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void {
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
    this._layerArcFlagsCache.clear();
    for (const id of this._sources.keys()) this._featureQuery?.clear(id);
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
    this._layerArcFlagsCache.clear();
    for (const id of this._sources.keys()) this._featureQuery?.clear(id);
    this._scheduleRender();
    return true;
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

  private _fireHistoryChange(): void {
    const snap: HistoryStateSnapshot = this._history.snapshot();
    this.fire('historychange', snap);
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
  public translateSelected(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return false;
    const refs = this._selection.getAll();
    if (refs.length === 0) return false;

    // Group selection by source, collecting unique abs-arc-ids (for path
    // features) and (layer, featureId) pairs (for point features).
    const bySource = new globalThis.Map<
      string,
      {
        arcIdSet: Set<number>;
        pointFeatures: TranslatedPointFeature[];
      }
    >();

    for (const ref of refs) {
      const layer = this._resolveLayer(ref.source, ref.layer);
      if (!layer?.shapes) continue;
      const shape = layer.shapes[ref.id];
      if (!shape) continue;

      let bucket = bySource.get(ref.source);
      if (!bucket) {
        bucket = { arcIdSet: new Set<number>(), pointFeatures: [] };
        bySource.set(ref.source, bucket);
      }

      if (layer.geometry_type === 'point') {
        bucket.pointFeatures.push({ layer, featureId: ref.id });
      } else {
        // Path feature: shape is a list of parts, each part is a list of
        // signed arc ids. Negative ids encode reversed direction; abs them.
        for (const part of shape) {
          if (!Array.isArray(part)) continue;
          for (const rawArcId of part) {
            if (typeof rawArcId !== 'number') continue;
            bucket.arcIdSet.add(rawArcId >= 0 ? rawArcId : ~rawArcId);
          }
        }
      }
    }

    if (bySource.size === 0) return false;

    const children: EditCommand[] = [];
    const editedSourceIds: string[] = [];
    for (const [sourceId, bucket] of bySource) {
      const source = this._sources.get(sourceId);
      if (!source) continue;
      if (bucket.arcIdSet.size === 0 && bucket.pointFeatures.length === 0) continue;

      const cmd = new FeatureTranslateCommand({
        source,
        arcs: source.getArcs(),
        dx,
        dy,
        arcIds: Array.from(bucket.arcIdSet),
        pointFeatures: bucket.pointFeatures,
      });
      cmd.do();
      children.push(cmd);
      editedSourceIds.push(sourceId);
    }

    if (children.length === 0) return false;

    const pushed: EditCommand =
      children.length === 1
        ? children[0]
        : new CompositeCommand(children, `Translate ${refs.length} features`);
    this._history.push(pushed);
    this._fireHistoryChange();
    this._clearSpatialIndexesForSources(editedSourceIds);
    this._scheduleRender();
    return true;
  }

  /**
   * Begin a translate "drag session" against the current selection.
   *
   * The session lets a UI animate a translate (e.g. follow the cursor)
   * without spamming the undo stack with one entry per mousemove. Geometry
   * mutates on every `move(dx, dy)`; only `commit()` pushes a single
   * cumulative `FeatureTranslateCommand` (or `CompositeCommand`) to history.
   * `cancel()` rolls the geometry back to the pre-session state and
   * pushes nothing.
   *
   * Returns `null` when the selection is empty. The session captures the
   * selection at start time — concurrent edits to the selection during
   * a drag are intentionally ignored.
   */
  /**
   * Shared scaffolding for translate/affine sessions: groups the active
   * selection by source into buckets of `(arcIds, pointFeatures)`, and
   * (when `splitShared` is true) duplicates any arc shared with an
   * unselected feature so the drag doesn't drag the neighbour along.
   *
   * Returns `null` for an empty / fully-resolved-empty selection. The
   * returned `splitCmds` have already been `do()`-applied; the caller
   * must push them onto a composite at commit and call `undo()` on
   * cancel.
   */
  private _buildSelectionBuckets(splitShared: boolean): {
    buckets: Array<{
      sourceId: string;
      source: TopologySource;
      arcIds: number[];
      pointFeatures: TranslatedPointFeature[];
    }>;
    splitCmds: SplitSharedArcsCommand[];
  } | null {
    type Bucket = {
      sourceId: string;
      source: TopologySource;
      arcIds: number[];
      pointFeatures: TranslatedPointFeature[];
      pathFeatures: Array<{ layer: MapshaperLayer; featureId: number }>;
    };

    const refs = this._selection.getAll();
    if (refs.length === 0) return null;

    // First pass: classify selected refs into path / point per source.
    // We DON'T compute arcIds yet — those need to wait until after the
    // optional shared-arc split rewrites the shapes.
    const bySource = new globalThis.Map<string, Bucket>();
    for (const ref of refs) {
      const layer = this._resolveLayer(ref.source, ref.layer);
      if (!layer?.shapes) continue;
      const shape = layer.shapes[ref.id];
      if (!shape) continue;
      const source = this._sources.get(ref.source);
      if (!source) continue;

      let bucket = bySource.get(ref.source);
      if (!bucket) {
        bucket = {
          sourceId: ref.source,
          source,
          arcIds: [],
          pointFeatures: [],
          pathFeatures: [],
        };
        bySource.set(ref.source, bucket);
      }

      if (layer.geometry_type === 'point') {
        bucket.pointFeatures.push({ layer, featureId: ref.id });
      } else {
        bucket.pathFeatures.push({ layer, featureId: ref.id });
      }
    }

    if (bySource.size === 0) return null;

    // Optional shared-arc split per source. Plan reads the dataset's
    // layers, the command's `do()` appends new arcs and rewrites the
    // selected features' shape arrays in place.
    const splitCmds: SplitSharedArcsCommand[] = [];
    if (splitShared) {
      for (const bucket of bySource.values()) {
        if (bucket.pathFeatures.length === 0) continue;
        const plan = planSharedArcSplit(
          bucket.source,
          bucket.pathFeatures,
          bucket.source.getLayers() as MapshaperLayer[],
        );
        if (!plan) continue;
        const cmd = new SplitSharedArcsCommand(plan);
        cmd.do();
        splitCmds.push(cmd);
        // Splitting appended new arcs onto the ArcCollection — the
        // line-layer arc-flag cache is sized for the OLD arc count and
        // will mis-treat the new ids as "not in this layer", silently
        // dropping the duplicated boundaries from the line render.
        this._invalidateShapeCachesForSources([bucket.sourceId]);
      }
    }

    // Second pass: now compute arcIds from the (possibly rewritten) shapes.
    for (const bucket of bySource.values()) {
      const seen = new Set<number>();
      for (const pf of bucket.pathFeatures) {
        const shape = pf.layer.shapes![pf.featureId];
        if (!shape) continue;
        for (const part of shape as number[][]) {
          if (!Array.isArray(part)) continue;
          for (const raw of part) {
            if (typeof raw !== 'number') continue;
            const abs = raw >= 0 ? raw : ~raw;
            if (!seen.has(abs)) {
              seen.add(abs);
              bucket.arcIds.push(abs);
            }
          }
        }
      }
    }

    const buckets = Array.from(bySource.values()).map((b) => ({
      sourceId: b.sourceId,
      source: b.source,
      arcIds: b.arcIds,
      pointFeatures: b.pointFeatures,
    }));
    return { buckets, splitCmds };
  }

  public beginTranslateSession(opts?: DragSessionOptions): FeatureTranslateSession | null {
    const built = this._buildSelectionBuckets(opts?.splitSharedArcs !== false);
    if (!built) return null;
    const { buckets, splitCmds } = built;
    let accumDx = 0;
    let accumDy = 0;
    let closed = false;

    const applyStep = (dx: number, dy: number) => {
      for (const b of buckets) {
        if (b.arcIds.length === 0 && b.pointFeatures.length === 0) continue;
        new FeatureTranslateCommand({
          source: b.source,
          arcs: b.source.getArcs(),
          dx,
          dy,
          arcIds: b.arcIds,
          pointFeatures: b.pointFeatures,
        }).do();
      }
    };

    return {
      move: (dx: number, dy: number) => {
        if (closed) return;
        if (dx === 0 && dy === 0) return;
        applyStep(dx, dy);
        accumDx += dx;
        accumDy += dy;
        this._scheduleRender();
      },
      commit: (): boolean => {
        if (closed) return false;
        closed = true;
        const moved = !(accumDx === 0 && accumDy === 0);
        // If the user opened a session, didn't drag, and committed: roll
        // any split-shared-arcs work back. Splitting alone with no visible
        // movement isn't worth a history entry.
        if (!moved) {
          for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
          if (splitCmds.length > 0) this._scheduleRender();
          return false;
        }
        // Geometry already moved by `move()` calls; build one cumulative
        // command and push it WITHOUT calling `.do()` — the post-do state
        // is already live. `undo` will subtract the cumulative offset,
        // `redo` re-applies it.
        const translateChildren: EditCommand[] = buckets.map((b) =>
          new FeatureTranslateCommand({
            source: b.source,
            arcs: b.source.getArcs(),
            dx: accumDx,
            dy: accumDy,
            arcIds: b.arcIds,
            pointFeatures: b.pointFeatures,
          }),
        );
        const total = buckets.reduce(
          (n, b) => n + b.arcIds.length + b.pointFeatures.length,
          0,
        );
        // Splits go FIRST in the composite so undo runs translate.undo()
        // (subtract offset on the duplicated arcs) before split.undo()
        // (truncate duplicates + restore original shape refs).
        const children: EditCommand[] = [...splitCmds, ...translateChildren];
        const pushed: EditCommand =
          children.length === 1
            ? children[0]
            : new CompositeCommand(children, `Translate ${total} features`);
        this._history.push(pushed);
        this._fireHistoryChange();
        // `_invalidateShapeCachesForSources` covers both the arc-flag cache
        // (relevant when a split appended new arcs) and the spatial index.
        this._invalidateShapeCachesForSources(buckets.map((b) => b.sourceId));
        this._scheduleRender();
        return true;
      },
      cancel: () => {
        if (closed) return;
        closed = true;
        // Reverse the translate first (on duplicated arcs), then reverse
        // the splits in LIFO order — each undo sees the state its do() left.
        if (accumDx !== 0 || accumDy !== 0) applyStep(-accumDx, -accumDy);
        for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
        accumDx = 0;
        accumDy = 0;
        if (splitCmds.length > 0) {
          this._invalidateShapeCachesForSources(buckets.map((b) => b.sourceId));
        }
        this._scheduleRender();
      },
      getAccumulated: (): [number, number] => [accumDx, accumDy],
    };
  }

  /**
   * Begin a rotate / scale / arbitrary-affine "drag session" against the
   * current selection. Same one-history-entry-per-drag semantics as
   * {@link beginTranslateSession}, but the per-frame delta is an arbitrary
   * affine matrix (typically `rotateMatrix(theta, ox, oy)` or
   * `scaleMatrix(sx, sy, ox, oy)` with the session's `origin`).
   *
   * The pivot is captured at session start: pass `origin` explicitly or let
   * it default to the selection bbox centroid. Subsequent matrices should
   * use the same pivot; otherwise the cumulative composed matrix on commit
   * won't match the visually applied sequence.
   */
  public beginAffineSession(
    origin?: [number, number],
    opts?: DragSessionOptions,
  ): FeatureAffineSession | null {
    const built = this._buildSelectionBuckets(opts?.splitSharedArcs !== false);
    if (!built) return null;
    const { buckets, splitCmds } = built;

    // Pivot. Same default as `_applyAffineToSelection`: bbox centroid of
    // every vertex the transform will touch.
    let ox: number;
    let oy: number;
    if (origin) {
      [ox, oy] = origin;
    } else {
      const centroidInput = new globalThis.Map<
        string,
        { arcIdSet: Set<number>; pointFeatures: TranslatedPointFeature[] }
      >();
      for (const b of buckets) {
        centroidInput.set(b.sourceId, {
          arcIdSet: new Set(b.arcIds),
          pointFeatures: b.pointFeatures,
        });
      }
      const centroid = this._computeSelectionCentroid(centroidInput);
      if (!centroid) {
        // Roll back any speculative split before bailing out.
        for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
        return null;
      }
      [ox, oy] = centroid;
    }
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
      for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
      return null;
    }
    const pivot: [number, number] = [ox, oy];

    let cumulative: AffineMatrix = { ...IDENTITY_MATRIX };
    let closed = false;

    const isIdentity = (m: AffineMatrix): boolean =>
      m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0;

    const applyMatrix = (matrix: AffineMatrix) => {
      for (const b of buckets) {
        if (b.arcIds.length === 0 && b.pointFeatures.length === 0) continue;
        new FeatureAffineCommand({
          source: b.source,
          arcs: b.source.getArcs(),
          matrix,
          arcIds: b.arcIds,
          pointFeatures: b.pointFeatures,
        }).do();
      }
    };

    return {
      origin: pivot,
      applyDelta: (matrix: AffineMatrix) => {
        if (closed) return;
        if (isIdentity(matrix)) return;
        applyMatrix(matrix);
        // Cumulative is "delta · cumulative" — newer transforms apply
        // after older ones, matching the visual sequence above.
        cumulative = composeMatrix(matrix, cumulative);
        this._scheduleRender();
      },
      commit: (label?: string): boolean => {
        if (closed) return false;
        closed = true;
        if (isIdentity(cumulative)) {
          // No movement — undo any speculative split so we don't pollute
          // the dataset with orphan duplicated arcs and a pointless entry.
          for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
          if (splitCmds.length > 0) this._scheduleRender();
          return false;
        }
        const totalFeatures = buckets.reduce(
          (n, b) => n + b.arcIds.length + b.pointFeatures.length,
          0,
        );
        const affineChildren: EditCommand[] = buckets.map((b) =>
          new FeatureAffineCommand({
            source: b.source,
            arcs: b.source.getArcs(),
            matrix: cumulative,
            arcIds: b.arcIds,
            pointFeatures: b.pointFeatures,
            label,
          }),
        );
        // Splits FIRST so undo runs affine.undo() (apply matrix^-1 on the
        // duplicated arcs) before split.undo() (truncate + restore shapes).
        const children: EditCommand[] = [...splitCmds, ...affineChildren];
        const pushed: EditCommand =
          children.length === 1
            ? children[0]
            : new CompositeCommand(
                children,
                label ?? `Transform ${totalFeatures} feature${totalFeatures === 1 ? '' : 's'}`,
              );
        this._history.push(pushed);
        this._fireHistoryChange();
        // `_invalidateShapeCachesForSources` covers both the arc-flag cache
        // (relevant when a split appended new arcs) and the spatial index.
        this._invalidateShapeCachesForSources(buckets.map((b) => b.sourceId));
        this._scheduleRender();
        return true;
      },
      cancel: () => {
        if (closed) return;
        closed = true;
        // Reverse the affine first, then the splits in LIFO order.
        if (!isIdentity(cumulative)) applyMatrix(invertMatrix(cumulative));
        for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
        cumulative = { ...IDENTITY_MATRIX };
        if (splitCmds.length > 0) {
          this._invalidateShapeCachesForSources(buckets.map((b) => b.sourceId));
        }
        this._scheduleRender();
      },
      getCumulative: (): AffineMatrix => ({ ...cumulative }),
    };
  }

  /**
   * Rotate every selected feature around `origin` by `angleDegrees`.
   * Default `origin` is the bbox centroid of the affected vertices.
   *
   * Lightweight in-place transform on the same path as `translateSelected`:
   * not a history barrier, selection survives, multi-source selections wrap
   * in a `CompositeCommand`. Returns `false` for empty selection or zero
   * angle.
   */
  public rotateSelected(angleDegrees: number, origin?: [number, number]): boolean {
    if (angleDegrees === 0) return false;
    const angleRad = (angleDegrees * Math.PI) / 180;
    return this._applyAffineToSelection(
      (ox, oy) => rotateMatrix(angleRad, ox, oy),
      origin,
      (n) => `Rotate ${n} feature${n === 1 ? '' : 's'}`,
    );
  }

  /**
   * Scale every selected feature by `(sx, sy)` around `origin`.
   * `sy` defaults to `sx` (uniform scale). Default `origin` is the bbox
   * centroid of the affected vertices. Returns `false` for empty selection
   * or no-op scale (`sx === 1 && sy === 1`).
   */
  public scaleSelected(sx: number, sy?: number, origin?: [number, number]): boolean {
    const sX = sx;
    const sY = sy ?? sx;
    if (sX === 1 && sY === 1) return false;
    return this._applyAffineToSelection(
      (ox, oy) => scaleMatrix(sX, sY, ox, oy),
      origin,
      (n) => `Scale ${n} feature${n === 1 ? '' : 's'}`,
    );
  }

  /**
   * Shared scaffolding for rotate / scale: walks the current selection,
   * groups by source, computes the bbox centroid (when no origin supplied),
   * builds one `FeatureAffineCommand` per source, and pushes either the
   * single command or a `CompositeCommand` wrapping all sources.
   */
  private _applyAffineToSelection(
    matrixForOrigin: (ox: number, oy: number) => AffineMatrix,
    origin: [number, number] | undefined,
    labelFor: (totalFeatures: number) => string,
  ): boolean {
    const refs = this._selection.getAll();
    if (refs.length === 0) return false;

    const bySource = new globalThis.Map<
      string,
      {
        arcIdSet: Set<number>;
        pointFeatures: TranslatedPointFeature[];
      }
    >();

    for (const ref of refs) {
      const layer = this._resolveLayer(ref.source, ref.layer);
      if (!layer?.shapes) continue;
      const shape = layer.shapes[ref.id];
      if (!shape) continue;

      let bucket = bySource.get(ref.source);
      if (!bucket) {
        bucket = { arcIdSet: new Set<number>(), pointFeatures: [] };
        bySource.set(ref.source, bucket);
      }

      if (layer.geometry_type === 'point') {
        bucket.pointFeatures.push({ layer, featureId: ref.id });
      } else {
        for (const part of shape) {
          if (!Array.isArray(part)) continue;
          for (const rawArcId of part) {
            if (typeof rawArcId !== 'number') continue;
            bucket.arcIdSet.add(rawArcId >= 0 ? rawArcId : ~rawArcId);
          }
        }
      }
    }

    if (bySource.size === 0) return false;

    // Default origin = bbox centroid of every vertex the transform will
    // touch. Picked once and reused across all per-source commands so
    // multi-source selections rotate / scale around a single shared pivot.
    let ox: number;
    let oy: number;
    if (origin) {
      ox = origin[0];
      oy = origin[1];
    } else {
      const centroid = this._computeSelectionCentroid(bySource);
      if (!centroid) return false;
      [ox, oy] = centroid;
    }

    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return false;

    const matrix = matrixForOrigin(ox, oy);

    const children: EditCommand[] = [];
    const editedSourceIds: string[] = [];
    for (const [sourceId, bucket] of bySource) {
      const source = this._sources.get(sourceId);
      if (!source) continue;
      if (bucket.arcIdSet.size === 0 && bucket.pointFeatures.length === 0) continue;

      const cmd = new FeatureAffineCommand({
        source,
        arcs: source.getArcs(),
        matrix,
        arcIds: Array.from(bucket.arcIdSet),
        pointFeatures: bucket.pointFeatures,
      });
      cmd.do();
      children.push(cmd);
      editedSourceIds.push(sourceId);
    }

    if (children.length === 0) return false;

    const pushed: EditCommand =
      children.length === 1
        ? children[0]
        : new CompositeCommand(children, labelFor(refs.length));
    this._history.push(pushed);
    this._fireHistoryChange();
    this._clearSpatialIndexesForSources(editedSourceIds);
    this._scheduleRender();
    return true;
  }

  /**
   * Compute the bbox centroid of every vertex the bySource buckets reference
   * (across path-feature arcs and point-feature shapes). Returns `null` when
   * no vertex was found (e.g., empty arcs).
   */
  private _computeSelectionCentroid(
    bySource: globalThis.Map<string, { arcIdSet: Set<number>; pointFeatures: TranslatedPointFeature[] }>,
  ): [number, number] | null {
    let xmin = Infinity, ymin = Infinity;
    let xmax = -Infinity, ymax = -Infinity;
    let any = false;

    for (const [sourceId, bucket] of bySource) {
      const source = this._sources.get(sourceId);
      if (!source) continue;

      // Path features: walk the affected arcs' xx/yy slices.
      const arcs = source.getArcs();
      const data = arcs?.getVertexData?.();
      if (data && bucket.arcIdSet.size > 0) {
        const { xx, yy, ii, nn } = data;
        for (const arcId of bucket.arcIdSet) {
          const start = ii[arcId];
          const len = nn[arcId];
          for (let i = start; i < start + len; i++) {
            const x = xx[i];
            const y = yy[i];
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
            any = true;
          }
        }
      }

      // Point features: walk each shape's coords.
      for (const pf of bucket.pointFeatures) {
        const shape = pf.layer.shapes?.[pf.featureId] as number[][] | undefined;
        if (!shape) continue;
        for (const coord of shape) {
          if (!coord || coord.length < 2) continue;
          const x = coord[0];
          const y = coord[1];
          if (x < xmin) xmin = x;
          if (x > xmax) xmax = x;
          if (y < ymin) ymin = y;
          if (y > ymax) ymax = y;
          any = true;
        }
      }
    }

    if (!any) return null;
    return [(xmin + xmax) / 2, (ymin + ymax) / 2];
  }

  // ---------------------------------------------------------------------------
  // Attribute / data-table editing
  // ---------------------------------------------------------------------------

  /**
   * Set or overwrite a single property on a single feature. Setting `value` to
   * `undefined` deletes the key. Returns `false` for unresolvable refs or when
   * the call is a no-op (existing value already matches).
   */
  public setFeatureProperty(ref: FeatureRef, key: string, value: unknown): boolean {
    return this.setFeatureProperties(ref, { [key]: value });
  }

  /**
   * Set multiple properties on one feature in a single undo entry.
   *
   * Per-key semantics:
   * - `props[key] === undefined` → delete the key from the record
   * - any other value → set / overwrite the key
   *
   * Returns `false` for unresolvable refs or when every key already has the
   * requested value (no-op call); no command is pushed and no events fire.
   */
  public setFeatureProperties(
    ref: FeatureRef,
    props: Record<string, unknown>,
  ): boolean {
    const layer = this._resolveLayer(ref.source, ref.layer);
    if (!layer) return false;
    const records = layer.data?.getRecords?.();
    const record = records?.[ref.id];
    if (!record) return false;

    const prev: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};

    for (const key of Object.keys(props)) {
      const had = key in record;
      const prevValue = had ? record[key] : undefined;
      const nextValue = props[key];

      // Detect no-ops at the key level so the diff stays minimal.
      if (nextValue === undefined && !had) continue;
      if (nextValue !== undefined && had && record[key] === nextValue) continue;

      if (had) prev[key] = prevValue;
      if (nextValue !== undefined) next[key] = nextValue;
    }

    if (Object.keys(prev).length === 0 && Object.keys(next).length === 0) {
      return false;
    }

    const cmd = new FeaturePropertyChangeCommand({
      layer,
      featureId: ref.id,
      prev,
      next,
    });
    cmd.do();
    this._history.push(cmd);
    this._fireHistoryChange();
    this._scheduleRender();
    return true;
  }

  /**
   * Add a new column to a layer's data table. Records that already carry the
   * key are skipped (and not rolled back by undo). `defaultValue` defaults to
   * `null`. Returns `false` if the source / target / data table cannot be
   * resolved.
   */
  public addField(opts: {
    source: string;
    target: string;
    field: string;
    defaultValue?: unknown;
  }): boolean {
    const layer = this._resolveLayer(opts.source, opts.target);
    if (!layer?.data) return false;
    const cmd = new FieldAddCommand({
      layer,
      field: opts.field,
      defaultValue: opts.defaultValue,
    });
    cmd.do();
    this._history.push(cmd);
    this._fireHistoryChange();
    this._scheduleRender();
    return true;
  }

  /**
   * Drop a column from a layer's data table. Per-record values are
   * snapshotted for undo so removing the field is fully reversible.
   * Returns `false` if the source / target / data table cannot be resolved.
   */
  public removeField(opts: {
    source: string;
    target: string;
    field: string;
  }): boolean {
    const layer = this._resolveLayer(opts.source, opts.target);
    if (!layer?.data) return false;
    const cmd = new FieldRemoveCommand({ layer, field: opts.field });
    cmd.do();
    this._history.push(cmd);
    this._fireHistoryChange();
    this._scheduleRender();
    return true;
  }

  /**
   * Rename a column on every record in a layer. Refuses (returns `false`) when
   * any record already carries both `from` and `to` so silent overwrites are
   * impossible. Use `removeField(to)` first if that is the intent.
   */
  public renameField(opts: {
    source: string;
    target: string;
    from: string;
    to: string;
  }): boolean {
    const layer = this._resolveLayer(opts.source, opts.target);
    if (!layer?.data) return false;
    const records = layer.data.getRecords?.();
    if (!records) return false;
    if (opts.from === opts.to) return false;
    for (const r of records) {
      if (r && opts.from in r && opts.to in r) {
        return false;
      }
    }
    const cmd = new FieldRenameCommand({ layer, from: opts.from, to: opts.to });
    cmd.do();
    this._history.push(cmd);
    this._fireHistoryChange();
    this._scheduleRender();
    return true;
  }

  /** Resolve a (sourceId, layerId) pair to the actual MapshaperLayer object. */
  private _resolveLayer(sourceId: string, layerId: string): MapshaperLayer | null {
    const source = this._sources.get(sourceId);
    if (!source) return null;
    const layers = source.getLayers();
    for (let i = 0; i < layers.length; i++) {
      if (getLayerId(layers[i], i) === layerId) {
        return layers[i] as MapshaperLayer;
      }
    }
    return null;
  }


  public remove(): void {
    this._dragPan.destroy();
    this._mouseWheel.destroy();
    this._historyShortcutUnbind?.();
    this._historyShortcutUnbind = null;
    if (this._workerPool) {
      this._workerPool.destroy();
      this._workerPool = null;
    }
    if (this._container && this._canvasContainer) {
      this._container.removeChild(this._canvasContainer);
    }
  }
}

// Mapshaper command wrappers (clip / dissolve / buffer / ... — 28 methods)
// live in `./mapshaper-ops` and are mixed onto `Emap.prototype` here. The
// interface declaration teaches TypeScript about the methods that
// `Object.assign` adds at runtime.
import { mapshaperOpsMixin, type MapshaperOpsApi } from './mapshaper-ops';
// `Object.assign` would skip the methods because class prototype members
// are non-enumerable; copy the property descriptors instead.
Object.defineProperties(
  Emap.prototype,
  Object.getOwnPropertyDescriptors(mapshaperOpsMixin),
);
export interface Emap extends MapshaperOpsApi {}

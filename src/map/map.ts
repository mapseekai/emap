import { EventDispatcher } from '../core/events';
import { Bounds } from '../geo/bounds';
import { AffineTransform } from '../geo/transform';
import { Viewport } from '../geo/viewport';
import { Projection } from '../geo/projection';
import { Painter } from '../renderer/painter';
import { CanvasPainter } from '../renderer/canvas-painter';
import { CanvasKitPainter } from '../renderer/canvaskit-painter';
import { TopologySource } from '../source/source';
import { MouseWheel } from '../core/interactions';
import { DragPanHandler } from '../core/drag-pan-handler';
import { FeatureQuery } from './feature-query';
import { HighlightManager } from './highlight-manager';
import { Selection, SelectMode, SelectionDiff } from './selection';
import { EditHistory, HistoryStateSnapshot } from '../edit/edit-history';
import type { EditCommand } from '../edit/edit-command';
import { CompositeCommand } from '../edit/commands/composite';
import { FeatureDeleteCommand } from '../edit/commands/feature-delete';
import { DatasetReplaceCommand } from '../edit/commands/dataset-replace';
import mapshaper from 'mapshaper';
import { Control, ControlPosition } from '../ui/control';
import { getLayerId } from '../source/layer-utils';
import { resolveStrokeStyle, resolvePointStyle } from './layer';
import type { LayerSpecification, FillPaint, LinePaint, CirclePaint } from './layer';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import type { DrawGeometryType } from '../ui/draw-feature-control';
import type { CanvasKit } from 'canvaskit-wasm';

export interface MapOptions {
  container: string | HTMLElement;
  interactive?: boolean;
  /**
   * Renderer backend to use.
   * - 'canvas': Canvas 2D API (default, recommended for large datasets)
   * - 'canvaskit': CanvasKit/Skia WASM (experimental)
   */
  renderer?: 'canvas' | 'canvaskit';
  /**
   * CanvasKit instance (required when renderer is 'canvaskit').
   * @experimental This feature is experimental and may have performance issues with large datasets.
   */
  canvasKit?: CanvasKit;
}

export interface QueryRenderedFeaturesOptions {
  layers?: string[];
}

export interface RenderedFeatureAttributes {
  id: number;
  source: string;
  layer: string;
  geometryType: string;
  properties: Record<string, unknown>;
}

/**
 * Canonical reference to a single feature within a source/layer.
 * Used by selection, highlight, and downstream geometry operations.
 */
export interface FeatureRef {
  id: number;
  source: string;
  layer: string;
}

/** @deprecated Use {@link FeatureRef}. Kept as an alias for back-compat. */
export type HighlightFeatureRef = FeatureRef;

/**
 * Options for the {@link Emap.clipLayer} / {@link Emap.eraseLayer} polygon
 * operations. Both target and mask must reside in the same emap source —
 * cross-source masks require a future explicit merge step.
 */
export interface ClipEraseOptions {
  /** Source ID containing both layers. */
  source: string;
  /** Layer name (or id) of the target to be clipped/erased. */
  target: string;
  /** Layer name (or id) of the polygon mask. */
  mask: string;
}

/**
 * Options for {@link Emap.dissolveLayer}. With no `field`, mapshaper merges
 * every feature in the target layer into one. With a `field`, features
 * sharing that field's value are merged.
 */
export interface DissolveOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer to dissolve. */
  target: string;
  /**
   * Optional attribute field to group features by. When omitted, the entire
   * target layer is dissolved into a single feature.
   */
  field?: string;
}

export interface HighlightStyle {
  color?: string;
  width?: number;
  radius?: number;
  fill?: boolean;
}

export type EditVertexShapePart = number[];
export type EditVertexShape = EditVertexShapePart[];

export interface EditVertexArcs {
  getArcIter(arcId: number): {
    x: number;
    y: number;
    hasNext(): boolean;
  };
  getShapeIter?(part: number[]): {
    x: number;
    y: number;
    hasNext(): boolean;
  };
}

export interface EditVertexState {
  shapes: EditVertexShape[];
  arcs: EditVertexArcs;
  hoverVertex: [number, number] | null;
  /** CSS color string for polygon fill in vertex edit mode. Null = no fill. */
  polygonFill?: string | null;
  geometryType?: string;
  /** Neighbor shapes sharing the hovered arc (different polygon fill) */
  neighborShapes?: EditVertexShape[];
}

export interface EditDrawState {
  vertices: [number, number][];
  cursorCoord: [number, number] | null;
  snapCoord: [number, number] | null;
  geometryType: DrawGeometryType;
  drawColor: string;
}

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
      this._scheduleRender();
    }
  }

  public getSource(id: string): TopologySource | undefined {
    return this._sources.get(id);
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
    this._scheduleRender();
  }

  public removeLayer(id: string): void {
    const idx = this._layers.findIndex((l) => l.id === id);
    if (idx !== -1) {
      this._layers.splice(idx, 1);
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
    this._scheduleRender();
  }

  private _getEffectiveLayers(): LayerSpecification[] {
    if (this._layers.length > 0) return this._layers;

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
          defaults.push({
            id: `${sourceId}:${layerId}`,
            type:
              geomType === 'point'
                ? 'circle'
                : geomType === 'polygon'
                  ? 'fill'
                  : 'line',
            source: sourceId,
            'source-layer': layerId,
            paint:
              geomType === 'point'
                ? { 'circle-color': '#333', 'circle-radius': 4 }
                : geomType === 'polygon'
                  ? { 'fill-color': '#333', 'line-width': 0.8 } as FillPaint
                  : { 'line-color': '#333', 'line-width': 0.8 },
          });
        }
      }
    }
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
    this.fire('data');
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
          arcs.setRetainedInterval(pixelSize * 0.5);
        }
      }

      const ml = this._resolveSourceLayer(source, layer['source-layer']);

      if (layer.type === 'line') {
        if (ml?.shapes && arcs) {
          const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
          this._painter.drawPaths(ml.shapes, style, arcs);
        } else if (arcs) {
          // Fallback: draw all arcs (default layer for source with no resolved layer)
          const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
          const filter = this._viewport.getArcFilter(arcs);
          this._painter.drawArcs(arcs, style, filter);
        }
      } else if (layer.type === 'fill') {
        if (ml?.shapes && arcs) {
          // Draw fill
          const fillColor = (layer.paint as FillPaint)?.['fill-color'] || '#333';
          const painter = this._painter as CanvasPainter;
          if (painter.drawPolygonFill) {
            painter.drawPolygonFill(
              ml.shapes,
              arcs,
              fillColor,
            );
          }
          // Draw outline
          const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
          this._painter.drawPaths(ml.shapes, style, arcs);
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
        // Draw neighbor shapes first (slightly lighter)
        if (this._editVertexState.neighborShapes?.length) {
          painter.drawPolygonFill(
            this._editVertexState.neighborShapes,
            this._editVertexState.arcs as unknown as import('../types/mapshaper-types').ArcCollection,
            this._editVertexState.polygonFill,
          );
        }
        // Draw primary hovered shape
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

    // Group ids by (sourceId, layerId) so we can sort within each layer
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

    for (const [sourceId, byLayer] of grouped) {
      const source = this._sources.get(sourceId);
      if (!source) continue;
      const layers = source.getLayers();
      for (const [layerId, ids] of byLayer) {
        // Resolve the actual layer object by matching layerId to getLayerId(layer, idx)
        let target: MapshaperLayer | null = null;
        for (let i = 0; i < layers.length; i++) {
          if (getLayerId(layers[i], i) === layerId) {
            target = layers[i] as MapshaperLayer;
            break;
          }
        }
        if (!target?.shapes) continue;

        // Sort descending so each splice does not invalidate later ids
        const sortedIds = [...ids].sort((a, b) => b - a);
        for (const featureId of sortedIds) {
          const shape = target.shapes[featureId];
          if (shape === undefined) continue;
          const records = target.data?.getRecords?.();
          const record = records ? records[featureId] : null;
          // Build the command, then execute it now (the caller-already-did-the-work
          // contract). The command captures pre-delete snapshots in opts.
          const cmd = new FeatureDeleteCommand({
            layer: target,
            featureId,
            shape,
            record: record ?? null,
            source,
          });
          cmd.do();
          children.push(cmd);
        }
      }
    }

    if (children.length === 0) return false;

    const composite = new CompositeCommand(children, `Delete ${children.length} feature${children.length > 1 ? 's' : ''}`);
    this._history.push(composite);
    this._fireHistoryChange();

    // Clear the selection — the refs no longer exist.
    this._fireSelectionChange(this._selection.clear());
    this._scheduleRender();

    return true;
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
  public async clipLayer(opts: ClipEraseOptions): Promise<boolean> {
    return this._runClipErase(opts, 'clip');
  }

  /**
   * Erase (cut holes from) a layer using a polygon mask layer via mapshaper's
   * `-erase` pipeline. Same semantics as {@link clipLayer}.
   */
  public async eraseLayer(opts: ClipEraseOptions): Promise<boolean> {
    return this._runClipErase(opts, 'erase');
  }

  private async _runClipErase(opts: ClipEraseOptions, op: 'clip' | 'erase'): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    // Validate that both target and mask resolve to layers in this source's
    // dataset. mapshaper would throw an opaque error otherwise.
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!findLayerByName(dataset.layers, opts.mask)) return false;

    const verb = op === 'clip' ? 'Clip' : 'Erase';
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -${op} source=${quoteMapshaperArg(opts.mask)}`;
    return this._runDatasetCommand(opts.source, cmd, `${verb} ${opts.target}`);
  }

  /**
   * Merge polygon (or point / polyline) features in the target layer using
   * mapshaper's `-dissolve` pipeline. Without `field`, all features in the
   * layer collapse into one; with `field`, features sharing the same field
   * value are merged. Returns `true` on success, `false` for unresolvable
   * source / target. Recorded as a single undoable history entry.
   */
  public async dissolveLayer(opts: DissolveOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;

    const fieldArg = opts.field ? ` ${quoteMapshaperArg(opts.field)}` : '';
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -dissolve${fieldArg}`;
    return this._runDatasetCommand(opts.source, cmd, `Dissolve ${opts.target}`);
  }

  /**
   * Generic runner for whole-dataset mapshaper commands.
   *
   * Snapshots the dataset (`internal.copyDataset`), runs the command which
   * mutates the original in place, clears the undo history (dataset replace
   * is a history barrier), pushes one `DatasetReplaceCommand`, clears the
   * selection, and fires `historychange` once. Future ops (`dissolve`,
   * `buffer`, ...) reuse this helper.
   */
  private async _runDatasetCommand(
    sourceId: string,
    cmd: string,
    label: string,
  ): Promise<boolean> {
    const source = this._sources.get(sourceId);
    if (!source) return false;
    const original = source.getDataset();
    if (!original) return false;

    // Deep snapshot for undo. mapshaper's clip / erase / dissolve mutate the
    // input dataset in place; without this snapshot there is nothing to
    // restore on undo.
    const before: MapshaperDataset = mapshaper.internal.copyDataset(original);

    let after: MapshaperDataset;
    try {
      after = await runMapshaperCommandOnDataset(cmd, original);
    } catch (err) {
      // Surface as a fire-and-forget error event; do not throw from a public
      // edit op so that one bad command doesn't tear down the calling page.
      this.fire('error', { error: err });
      return false;
    }

    // Apply: swap the source's active dataset.
    source.setDataset(after);

    // History barrier: prior commands closed over the OLD dataset's layers /
    // arcs. Clearing keeps undo predictable; the dataset-replace itself is
    // the single new undoable step.
    this._history.clear();
    this._history.push(new DatasetReplaceCommand({ source, before, after, label }));
    this._fireHistoryChange();

    // Selection refs are by feature id and may now point at different
    // features. Clear conservatively.
    this._fireSelectionChange(this._selection.clear());

    this._scheduleRender();
    return true;
  }

  public remove(): void {
    this._dragPan.destroy();
    if (this._container && this._canvasContainer) {
      this._container.removeChild(this._canvasContainer);
    }
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers for whole-dataset mapshaper command execution
// ---------------------------------------------------------------------------

/**
 * Resolve a mapshaper layer by its name or id (matches what `mapshaper -clip
 * source=NAME` would resolve internally). Returns null when no layer
 * matches.
 */
function findLayerByName(layers: MapshaperLayer[], nameOrId: string): MapshaperLayer | null {
  for (const layer of layers) {
    if (layer.name === nameOrId || layer.id === nameOrId) return layer;
  }
  return null;
}

/**
 * Quote a layer name so it can be embedded in a mapshaper command string.
 * mapshaper accepts double-quoted arguments; we escape any embedded quotes.
 */
function quoteMapshaperArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Run a mapshaper command string against a single dataset and resolve with
 * the resulting (post-mutation) dataset. Wraps the parseCommands +
 * runParsedCommands + Job dance in a Promise.
 */
function runMapshaperCommandOnDataset(
  cmd: string,
  dataset: MapshaperDataset,
): Promise<MapshaperDataset> {
  return new Promise((resolve, reject) => {
    const job = new mapshaper.internal.Job();
    job.catalog.addDataset(dataset);
    const commands = mapshaper.internal.parseCommands(cmd);
    mapshaper.internal.runParsedCommands(commands, job, (err: any, finished) => {
      if (err) {
        reject(err);
        return;
      }
      const targets = finished.catalog.getDefaultTargets();
      if (targets.length > 0) {
        resolve(targets[0].dataset);
      } else {
        // mapshaper sometimes leaves the input dataset untouched if no target
        // applied — treat as success and return the original ref.
        resolve(dataset);
      }
    });
  });
}

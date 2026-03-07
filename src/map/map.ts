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
import { Control, ControlPosition } from '../ui/control';
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

export interface HighlightFeatureRef {
  id: number;
  source: string;
  layer: string;
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
}

export interface EditVertexState {
  shapes: EditVertexShape[];
  arcs: EditVertexArcs;
  hoverVertex: [number, number] | null;
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

  // Edit mode
  private _editMode: 'none' | 'vertex' = 'none';
  private _editVertexState: EditVertexState | null = null;

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

  public getEditMode(): 'none' | 'vertex' {
    return this._editMode;
  }

  public setEditMode(mode: 'none' | 'vertex'): void {
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
    if (this._sources.size === 1 && source.getCRS) {
      const crs = source.getCRS();
      this._projection.setCRS(crs);
      this._viewport.setCRS(crs);
      this.fire('crschange');
    }
  }

  public getSource(id: string): TopologySource | undefined {
    return this._sources.get(id);
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
    const defaultWidth = 0.8;
    const strokeWidth = defaultWidth * lineScale;

    for (const source of this._sources.values()) {
      const displayArcs = source.getDisplayArcs();
      const pixelSize = 1 / Math.abs(transform.mx);

      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();
      if (!arcs) continue;

      if (
        arcs.setRetainedInterval &&
        (typeof arcs.isFlat !== 'function' || !arcs.isFlat())
      ) {
        arcs.setRetainedInterval(pixelSize * 0.5);
      }

      const filter = this._viewport.getArcFilter(arcs);

      this._painter.drawArcs(
        arcs,
        { color: '#333', width: strokeWidth },
        filter,
      );
    }

    // Delegated highlight rendering
    this._highlightManager.renderHighlights(
      this._painter,
      this._sources,
      transform,
      lineScale,
    );

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
    return this._featureQuery.query(geometryOrOptions, options);
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

  public remove(): void {
    this._dragPan.destroy();
    if (this._container && this._canvasContainer) {
      this._container.removeChild(this._canvasContainer);
    }
  }
}

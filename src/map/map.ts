import mapshaper from 'mapshaper';
import { EventDispatcher } from '../core/events';
import { Bounds } from '../geo/bounds';
import { Transform } from '../geo/transform';
import { Painter } from '../renderer/painter';
import { CanvasPainter } from '../renderer/canvas-painter';
import { CanvasKitPainter } from '../renderer/canvaskit-painter';
import { TopologySource } from '../source/topology-source';
import { Tween } from '../core/tween';
import { MouseWheel } from '../core/interactions';
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

export class Emap extends EventDispatcher {
  private _container: HTMLElement;
  private _canvasContainer: HTMLElement;
  private _canvas: HTMLCanvasElement;
  private _painter: Painter;
  private _transform: Transform = new Transform();
  private _extent: Bounds = new Bounds();
  private _width: number = 0;
  private _height: number = 0;
  private _sources: globalThis.Map<string, TopologySource> = new globalThis.Map();
  private _initialMX: number = 0;

  private _zoomTween: Tween = new Tween(Tween.sineInOut);
  private _zoomFocus: [number, number] = [0, 0];
  private _mouseWheel: MouseWheel;

  private _pendingRender: number = 0;
  private _rafId: number = 0;
  private _initialExtent: Bounds | null = null;
  private _controlContainers: globalThis.Map<ControlPosition, HTMLElement> = new globalThis.Map();
  private _crs: string = 'EPSG:4326';

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
    this._mouseWheel = new MouseWheel(this._canvasContainer);
    this._attachEventListeners();

    this._zoomTween.on('change', (e: any) => {
      if (!this._animatingTransform) return;
      const scale = e.value;
      const k = scale / this._animatingTransform.mx;
      const t = this._animatingTransform.clone();
      t.scale(k, this._zoomFocus[0], this._zoomFocus[1]);
      this._transform = t;
      this.fire('move');
      if (e.done) {
        this._animatingTransform = null;
      }
    });

    this._mouseWheel.on('mousewheel', (e: any) => this._onMouseWheel(e));

    this.on('move', () => this._scheduleRender());
    this.on('resize', () => this._scheduleRender());
    this.on('reset', () => this.reset());
  }

  public getCanvasContainer(): HTMLElement {
    return this._canvasContainer;
  }

  private _animatingTransform: Transform | null = null;

  private _attachEventListeners(): void {
    const el = this._canvasContainer;
    el.addEventListener('mousedown', this._onMouseDown.bind(this));
    window.addEventListener('mousemove', this._onMouseMove.bind(this));
    window.addEventListener('mouseup', this._onMouseUp.bind(this));
    // Remove raw wheel listener, now handled by MouseWheel class
  }

  private _isDragging: boolean = false;
  private _lastMousePos: [number, number] = [0, 0];

  private _onMouseDown(e: MouseEvent): void {
    this._isDragging = true;
    this._lastMousePos = [e.clientX, e.clientY];
    this._zoomTween.stop();
    this._animatingTransform = null;
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._isDragging) return;
    const dx = e.clientX - this._lastMousePos[0];
    const dy = e.clientY - this._lastMousePos[1];
    this._lastMousePos = [e.clientX, e.clientY];

    this._transform.translate(dx, dy);
    this._applyConstraints();
    this.fire('move');
  }

  private _onMouseUp(): void {
    this._isDragging = false;
  }

  private _onMouseWheel(e: any): void {
    const tickFraction = 0.12; // Adjusted for better feel
    const k = 1 + (tickFraction * e.multiplier);
    const delta = e.direction > 0 ? k : 1 / k;

    this._transform.scale(delta, e.x, e.y);
    this._applyConstraints();
    this.fire('move');
  }

  private _createCanvasContainer(): HTMLElement {
    const el = document.createElement('div');
    el.style.position = 'relative';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.overflow = 'hidden';
    el.className = 'emap-canvas-container';

    // Create control corners
    const corners: ControlPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    corners.forEach(pos => {
      const container = document.createElement('div');
      container.className = `emap-ctrl-${pos}`;
      container.style.position = 'absolute';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '10';

      const [v, h] = pos.split('-');
      container.style[v as any] = '10px';
      container.style[h as any] = '10px';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';

      el.appendChild(container);
      this._controlContainers.set(pos, container);
    });

    return el;
  }

  private _updateSize(): void {
    this._width = this._container.clientWidth;
    this._height = this._container.clientHeight;
    this._painter.resize(this._width, this._height);
  }

  public addSource(id: string, source: TopologySource): void {
    this._sources.set(id, source);
    // Set CRS from first loaded source
    if (this._sources.size === 1 && source.getCRS) {
      this._crs = source.getCRS();
      this.fire('crschange');
    }
  }

  public getCRS(): string {
    return this._crs;
  }

  public setCRS(crs: string): void {
    this._crs = crs;
    this.fire('crschange');
  }

  public async reproject(targetCrs: string): Promise<void> {
    if (this._crs === targetCrs) return;

    // Reproject all sources
    for (const source of this._sources.values()) {
      if (source.reproject) {
        await source.reproject(targetCrs);
      }
    }

    // Update Map CRS
    this._crs = targetCrs;

    // Recalculate extent based on new source data
    // We need to re-read extent from sources. 
    // Assuming sources have updated their data, we need to ask them for new bounds.
    // But TopologySource currently doesn't expose getBounds() explicitly, 
    // we might need to rely on the fact that we can get dataset from source.

    // For now, let's just trigger a full refresh/resize which might recalculate bounds if we had a way.
    // Ideally, Painter should get the new data.

    // We need to update the Painter's data reference or just trigger a redraw?
    // Painter holds reference to TopologySource? 
    // Yes, Map calls painter.paint() which likely iterates sources.
    // But we need to update the Map's extent (_extent) to fit the new coordinates.

    // Let's find the new extent from all sources
    let newExtent = new Bounds();
    for (const source of this._sources.values()) {
      const dataset = source.getDataset();
      if (dataset && dataset.layers) {
        dataset.layers.forEach((layer: any) => {
          if ((mapshaper as any).internal.layerHasGeometry(layer)) {
            const bb = (mapshaper as any).internal.getLayerBounds(layer, dataset.arcs);
            if (bb) {
              newExtent.merge(new Bounds(bb.xmin, bb.ymin, bb.xmax, bb.ymax));
            }
          }
        });
      }
    }

    // Reset scale baselines before setting the new extent in the target CRS
    this._initialExtent = null;
    this._initialMX = 0;

    if (newExtent.hasBounds()) {
      // Add 3.5% margin matching Mapshaper's calcFullBounds()
      newExtent.scale(1.07);
      this.setExtent(newExtent);
    }

    this.fire('crschange');
    this.fire('data'); // Signal that data has changed (coordinates)
  }

  public getCenter(): [number, number] {
    const t = this._transform;
    const cx = (this._width / 2 - t.bx) / t.mx;
    const cy = (this._height / 2 - t.by) / t.my;

    const crs = this._crs.toLowerCase();
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      return this._webMercatorToLatLng(cx, cy);
    }
    return [cx, cy];
  }

  public getZoom(): number {
    const t = this._transform;
    const mx = Math.abs(t.mx);
    const crs = this._crs.toLowerCase();
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      // Mapshaper formula: Math.log2(mx * 40075016.6855 / 512)
      return Math.log2(mx * 40075016.6855 / 512);
    }
    return 0;
  }

  private _webMercatorToLatLng(x: number, y: number): [number, number] {
    const R = 6378137;
    const R2D = 180 / Math.PI;
    const lon = x / R * R2D;
    const lat = R2D * (Math.PI * 0.5 - 2 * Math.atan(Math.exp(-y / R)));
    return [lon, lat];
  }

  public getTransform(): Transform {
    return this._transform;
  }

  public getExtent(): Bounds {
    return this._extent;
  }

  public setExtent(bounds: Bounds): void {
    this._extent = bounds.clone();
    if (!this._initialExtent) {
      this._initialExtent = bounds.clone();
    }
    this._updateTransform();
    this.fire('move');
  }

  public reset(): void {
    if (this._initialExtent) {
      this.setExtent(this._initialExtent);
    }
  }

  public addControl(control: Control, position: ControlPosition = 'top-left'): void {
    const el = control.onAdd(this);
    el.style.pointerEvents = 'auto';
    this._controlContainers.get(position)?.appendChild(el);
  }

  public removeControl(control: Control): void {
    control.onRemove(this);
  }

  private _updateTransform(): void {
    if (!this._extent.hasBounds()) return;
    const viewAspect = this._width / this._height;
    const paddedExtent = this._extent.clone().fillOut(viewAspect);
    const viewBounds = new Bounds(0, 0, this._width, this._height);
    this._transform = Transform.getTransform(paddedExtent, viewBounds, true);

    if (this._initialMX === 0) {
      this._initialMX = Math.abs(this._transform.mx);
      // Parity with Mapshaper: Store the padded extent as the baseline for constraint logic
      this._initialExtent = paddedExtent;
    }
  }

  public zoomIn(): void {
    this._zoomTo(1.15);
  }

  public zoomOut(): void {
    this._zoomTo(1 / 1.15); // Slightly smaller steps for buttons
  }

  private _zoomTo(delta: number): void {
    const center: [number, number] = [this._width / 2, this._height / 2];
    const startScale = Math.abs(this._transform.mx);
    const endScale = startScale * delta;

    this._zoomFocus = center;
    this._animatingTransform = this._transform.clone();
    this._zoomTween.start(startScale, endScale, 200);
  }

  private _applyConstraints(): void {
    const t = this._transform;
    let mx = Math.abs(t.mx);
    let my = t.my;

    const minMX = this._getMinMX();
    const maxMX = this._getMaxMX();

    const isWebMercator = this._crs.toLowerCase().includes('3857') || this._crs.toLowerCase().includes('webmercator');
    if (isWebMercator && mx < minMX) mx = minMX;
    if (mx > maxMX) mx = maxMX;
    my = t.my > 0 ? mx : -mx;

    const strictBounds = this._getStrictBounds();
    const cx = (this._width / 2 - t.bx) / t.mx;
    let cy = (this._height / 2 - t.by) / t.my;

    if (strictBounds) {
      const dist = this._height / (2 * mx);
      const ymax = strictBounds.ymax - dist;
      const ymin = strictBounds.ymin + dist;

      if (ymin > ymax) {
        cy = (strictBounds.ymin + strictBounds.ymax) / 2;
      } else if (cy > ymax) {
        cy = ymax;
      } else if (cy < ymin) {
        cy = ymin;
      }
    }

    const bx = this._width / 2 - cx * mx;
    const by = this._height / 2 - cy * my;
    this._transform = new Transform(mx, my, bx, by);
  }

  private _getMaxMX(): number {
    if (!this._initialExtent) return Infinity;
    const minPixelScale = 1e-16;
    const f = this._initialExtent;
    const maxAbs = (...args: number[]) => Math.max(...args.map(Math.abs));
    const xmax = maxAbs(f.xmin, f.xmax, f.centerX);
    const ymax = maxAbs(f.ymin, f.ymax, f.centerY);
    const xscale = (f.width / this._width) / (xmax * minPixelScale);
    const yscale = (f.height / this._height) / (ymax * minPixelScale);
    return Math.max(xscale, yscale);
  }

  private _getStrictBounds(): Bounds | null {
    const crs = this._crs.toLowerCase();
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      const yLimit = 18485274.7; // Mapshaper's toWebMercator(0, 84)[1]
      return new Bounds(-Infinity, -yLimit, Infinity, yLimit);
    }
    return null;
  }

  private _getMinMX(): number {
    const crs = this._crs.toLowerCase();
    let worldHeight: number;
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      worldHeight = 18485274.7 * 2;
    } else if (crs === 'epsg:4326' || crs === 'wgs84') {
      worldHeight = 180;
    } else {
      return this._initialMX * 0.01;
    }
    return this._height / worldHeight;
  }

  private _getLineScale(): number {
    if (this._initialMX === 0) return 1;
    const mapScale = Math.abs(this._transform.mx) / this._initialMX;
    let s = 1;
    if (mapScale < 0.5) {
      s *= Math.pow(mapScale + 0.5, 0.35);
    } else if (mapScale > 30) {
      s *= Math.pow(mapScale - 29, 0.065);
    }
    return s;
  }

  private _getArcFilter(arcs: any): (i: number) => boolean {
    const MIN_PATH_LEN = 0.1;
    const pixelSize = 1 / Math.abs(this._transform.mx);
    const minPathLen = pixelSize * MIN_PATH_LEN;
    const mapScale = this._initialMX > 0 ? Math.abs(this._transform.mx) / this._initialMX : 1;
    const adjustedMinLen = mapScale < 1 ? minPathLen * mapScale : minPathLen;

    // Get current view bounds in geo coordinates
    const viewBBox = this._getViewBounds();

    return (i: number): boolean => {
      // Skip tiny arcs
      if (arcs.arcIsSmaller && arcs.arcIsSmaller(i, adjustedMinLen)) {
        return false;
      }
      // Skip arcs outside viewport
      if (viewBBox && arcs.arcIntersectsBBox && !arcs.arcIntersectsBBox(i, viewBBox)) {
        return false;
      }
      return true;
    };
  }

  private _getViewBounds(): number[] | null {
    if (!this._transform || this._width === 0) return null;
    const t = this._transform;
    const x1 = -t.bx / t.mx;
    const x2 = (this._width - t.bx) / t.mx;
    const y1 = -t.by / t.my;
    const y2 = (this._height - t.by) / t.my;
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }

  // RAF-based render throttling - coalesces multiple events into one frame
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
    this._painter.setTransform(this._transform);
    this._painter.clear();

    const lineScale = this._getLineScale();
    const defaultWidth = 0.8;
    const strokeWidth = defaultWidth * lineScale;

    this._sources.forEach((source: TopologySource) => {
      const displayArcs = source.getDisplayArcs();
      const pixelSize = 1 / Math.abs(this._transform.mx);

      // Get arcs with LOD switching - uses low-detail copy when zoomed out
      const arcs = displayArcs ? displayArcs.getScaledArcs(pixelSize) : source.getArcs();

      // Set dynamic simplification threshold based on pixel size
      // This causes getArcIter() to skip vertices below this threshold
      // Only set if we have simplification thresholds (isFlat() is false)
      if (arcs && arcs.setRetainedInterval && (typeof arcs.isFlat !== 'function' || !arcs.isFlat())) {
        arcs.setRetainedInterval(pixelSize * 0.5);
      }

      const filter = this._getArcFilter(arcs);

      // Use direct arc rendering for better performance
      this._painter.drawArcs(arcs, { color: '#333', width: strokeWidth }, filter);
    });

    // Flush GPU commands for CanvasKit
    if (this._painter.flush) {
      this._painter.flush();
    }
  }

  public project(x: number, y: number): [number, number] {
    return this._transform.project(x, y);
  }

  public unproject(px: number, py: number): [number, number] {
    return this._transform.unproject(px, py);
  }

  public resize(): void {
    this._updateSize();
    this._updateTransform();
    this.fire('resize');
  }

  public remove(): void {
    if (this._container && this._canvasContainer) {
      this._container.removeChild(this._canvasContainer);
    }
  }
}


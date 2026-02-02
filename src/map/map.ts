import { EventDispatcher } from '../core/events';
import { Bounds } from '../geo/bounds';
import { Transform } from '../geo/transform';
import { Painter } from '../renderer/painter';
import { CanvasPainter } from '../renderer/canvas-painter';
import { TopologySource } from '../source/topology-source';
import { Tween } from '../core/tween';
import { MouseWheel } from '../core/interactions';

export interface MapOptions {
  container: string | HTMLElement;
  interactive?: boolean;
}

export class Map extends EventDispatcher {
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

  // RAF-based render throttling (like Mapshaper's skipCounts)
  private _pendingRender: number = 0;
  private _rafId: number = 0;

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
    this.fire('move');
  }

  private _onMouseUp(): void {
    this._isDragging = false;
  }

  private _onMouseWheel(e: any): void {
    const tickFraction = 0.12; // Adjusted for better feel
    const k = 1 + (tickFraction * e.multiplier);
    const delta = e.direction > 0 ? k : 1 / k;

    // Direct incremental zoom for the smoothest "streaming" feel
    this._transform.scale(delta, e.x, e.y);
    this.fire('move');
  }

  private _createCanvasContainer(): HTMLElement {
    const el = document.createElement('div');
    el.style.position = 'relative';
    el.style.width = '100%';
    el.style.height = '100%';
    el.className = 'mapseek-canvas-container';
    return el;
  }

  private _updateSize(): void {
    this._width = this._container.clientWidth;
    this._height = this._container.clientHeight;
    this._painter.resize(this._width, this._height);
  }

  public addSource(id: string, source: TopologySource): void {
    this._sources.set(id, source);
  }

  public getTransform(): Transform {
    return this._transform;
  }

  public setExtent(bounds: Bounds): void {
    this._extent = bounds.clone();
    this._updateTransform();
    this.fire('move');
  }

  private _updateTransform(): void {
    if (!this._extent.hasBounds()) return;
    const viewAspect = this._width / this._height;
    const paddedExtent = this._extent.clone().fillOut(viewAspect);
    const viewBounds = new Bounds(0, 0, this._width, this._height);
    this._transform = Transform.getTransform(paddedExtent, viewBounds, true);

    if (this._initialMX === 0) {
      this._initialMX = Math.abs(this._transform.mx);
    }
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
      const arcs = source.getArcs();

      // Set dynamic simplification threshold based on pixel size
      // This causes getArcIter() to skip vertices below this threshold
      const pixelSize = 1 / Math.abs(this._transform.mx);
      if (arcs && arcs.setRetainedInterval) {
        arcs.setRetainedInterval(pixelSize * 0.5);
      }

      const filter = this._getArcFilter(arcs);

      // Use direct arc rendering for better performance
      this._painter.drawArcs(arcs, { color: '#000000ff', width: strokeWidth }, filter);
    });
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

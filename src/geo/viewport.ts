import { AffineTransform } from './transform';
import { Bounds } from './bounds';
import { Tween } from '../core/tween';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fraction of zoom per wheel tick */
const ZOOM_TICK_FRACTION = 0.12;

/** Animated zoom step factor for zoomIn / zoomOut */
const ZOOM_STEP_FACTOR = 1.15;

/** Web Mercator y-axis limit (approx ±85.06° lat) */
const WEB_MERCATOR_Y_LIMIT = 18485274.7;

/** Minimum floating point scale to prevent overflow */
const MIN_PIXEL_SCALE = 1e-16;

/** Minimum arc path length in pixels for filtering */
const MIN_PATH_LEN = 0.35;

// ---------------------------------------------------------------------------
// Viewport — manages view transform, zoom, and constraints
// ---------------------------------------------------------------------------

/**
 * Viewport owns the affine transform that maps data coordinates to screen
 * pixels.  It handles zoom animation, pan constraints, and LOD parameters.
 */
export class Viewport {
  private _transform: AffineTransform = new AffineTransform();
  private _extent: Bounds = new Bounds();
  private _width = 0;
  private _height = 0;
  private _initialMX = 0;
  private _initialExtent: Bounds | null = null;

  // Zoom animation
  private _zoomTween: Tween = new Tween(Tween.sineInOut);
  private _zoomFocus: [number, number] = [0, 0];
  private _animatingTransform: AffineTransform | null = null;

  /** Callback fired whenever the view changes (move / zoom) */
  onViewChange: (() => void) | null = null;

  // -- CRS hint (used only for view constraints, not for reprojection) --
  private _crs = 'EPSG:4326';

  setCRS(crs: string): void {
    this._crs = crs;
  }

  get transform(): AffineTransform {
    return this._transform;
  }

  get extent(): Bounds {
    return this._extent;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get initialMX(): number {
    return this._initialMX;
  }

  updateSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
  }

  setExtent(bounds: Bounds): void {
    this._extent = bounds.clone();
    if (!this._initialExtent) {
      this._initialExtent = bounds.clone();
    }
    this._updateTransform();
  }

  reset(): void {
    if (this._initialExtent) {
      this.setExtent(this._initialExtent);
    }
  }

  /**
   * Current camera state in projected/data coordinates. `center` is the
   * data point at the viewport centre (same space as `unproject` and
   * `getExtent`, before any CRS/geographic mapping). `scale` is `|mx|`.
   */
  getCameraState(): { center: [number, number]; scale: number } {
    const t = this._transform;
    const cx = (this._width / 2 - t.bx) / t.mx;
    const cy = (this._height / 2 - t.by) / t.my;
    return { center: [cx, cy], scale: Math.abs(t.mx) };
  }

  /**
   * Set the transform so `center` (data coords) sits at the viewport
   * centre at `scale` (= |mx|), preserving the existing flipY (my<0)
   * convention, then re-apply pan/zoom constraints. Additive primitive
   * for the Camera; does not touch `setExtent`/`reset` state. Callers own
   * the render / `onViewChange` trigger after this call (the Camera fires
   * the move/zoom lifecycle itself).
   */
  applyCameraState(center: [number, number], scale: number): void {
    const mx = scale;
    const my = -scale; // flipY convention (Viewport builds transforms with flipY=true)
    const bx = this._width / 2 - mx * center[0];
    const by = this._height / 2 - my * center[1];
    this._transform = new AffineTransform(mx, my, bx, by);
    this._applyConstraints();
  }

  clearInitialState(): void {
    this._initialExtent = null;
    this._initialMX = 0;
  }

  private _updateTransform(): void {
    if (!this._extent.hasBounds()) return;
    const viewAspect = this._width / this._height;
    const paddedExtent = this._extent.clone().fillOut(viewAspect);
    const viewBounds = new Bounds(0, 0, this._width, this._height);
    this._transform = AffineTransform.fromBounds(paddedExtent, viewBounds, true);

    if (this._initialMX === 0) {
      this._initialMX = Math.abs(this._transform.mx);
      this._initialExtent = paddedExtent;
    }
  }

  pan(dx: number, dy: number): void {
    this._transform.translate(dx, dy);
    this._applyConstraints();
  }

  cancelZoomAnimation(): void {
    this._zoomTween.stop();
    this._animatingTransform = null;
  }

  applyWheelZoom(direction: number, multiplier: number, x: number, y: number): void {
    const k = 1 + ZOOM_TICK_FRACTION * multiplier;
    const delta = direction > 0 ? k : 1 / k;
    this._transform.scale(delta, x, y);
    this._applyConstraints();
  }

  zoomIn(): void {
    this._zoomTo(ZOOM_STEP_FACTOR);
  }

  zoomOut(): void {
    this._zoomTo(1 / ZOOM_STEP_FACTOR);
  }

  private _zoomTo(delta: number): void {
    const center: [number, number] = [this._width / 2, this._height / 2];
    const startScale = Math.abs(this._transform.mx);
    const endScale = startScale * delta;
    this._zoomFocus = center;
    this._animatingTransform = this._transform.clone();
    this._zoomTween.start(startScale, endScale, 200);
  }

  /** Connect the zoom tween – call once during init */
  initZoomTween(): void {
    this._zoomTween.on('change', (e: { value: number; done?: boolean }) => {
      if (!this._animatingTransform) return;
      const scale = e.value;
      const k = scale / this._animatingTransform.mx;
      const t = this._animatingTransform.clone();
      t.scale(k, this._zoomFocus[0], this._zoomFocus[1]);
      this._transform = t;
      this.onViewChange?.();
      if (e.done) {
        this._animatingTransform = null;
      }
    });
  }

  project(x: number, y: number): [number, number] {
    return this._transform.project(x, y);
  }

  unproject(px: number, py: number): [number, number] {
    return this._transform.unproject(px, py);
  }

  getLineScale(): number {
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

  getArcFilter(arcs: { arcIsSmaller?(i: number, minLen: number): boolean; arcIntersectsBBox?(i: number, bbox: number[]): boolean }): (i: number) => boolean {
    const mapScale = this._initialMX > 0 ? Math.abs(this._transform.mx) / this._initialMX : 1;

    if (mapScale < 1.1) {
      return (_i: number) => true;
    }

    const pixelSize = 1 / Math.abs(this._transform.mx);
    const minPathLen = pixelSize * MIN_PATH_LEN;
    const adjustedMinLen = mapScale < 1 ? minPathLen * mapScale : minPathLen;
    const viewBBox = this._getViewBounds();

    return (i: number): boolean => {
      if (arcs.arcIsSmaller?.(i, adjustedMinLen)) return false;
      if (viewBBox && arcs.arcIntersectsBBox && !arcs.arcIntersectsBBox(i, viewBBox)) return false;
      return true;
    };
  }

  getViewBounds(): number[] | null {
    return this._getViewBounds();
  }

  private _getViewBounds(): number[] | null {
    if (!this._transform || this._width === 0) return null;
    const t = this._transform;
    const x1 = -t.bx / t.mx;
    const x2 = (this._width - t.bx) / t.mx;
    const y1 = -t.by / t.my;
    const y2 = (this._height - t.by) / t.my;
    return [
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.max(x1, x2),
      Math.max(y1, y2),
    ];
  }

  private _applyConstraints(): void {
    const t = this._transform;
    let mx = Math.abs(t.mx);

    const minMX = this._getMinMX();
    const maxMX = this._getMaxMX();

    const isWebMercator =
      this._crs.toLowerCase().includes('3857') ||
      this._crs.toLowerCase().includes('webmercator');
    if (isWebMercator && mx < minMX) mx = minMX;
    if (mx > maxMX) mx = maxMX;
    const my = t.my > 0 ? mx : -mx;

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
    this._transform = new AffineTransform(mx, my, bx, by);
  }

  private _getMaxMX(): number {
    if (!this._initialExtent) return Infinity;
    const f = this._initialExtent;
    const maxAbs = (...args: number[]) => Math.max(...args.map(Math.abs));
    const xmax = maxAbs(f.xmin, f.xmax, f.centerX);
    const ymax = maxAbs(f.ymin, f.ymax, f.centerY);
    const xscale = f.width / this._width / (xmax * MIN_PIXEL_SCALE);
    const yscale = f.height / this._height / (ymax * MIN_PIXEL_SCALE);
    return Math.max(xscale, yscale);
  }

  private _getStrictBounds(): Bounds | null {
    const crs = this._crs.toLowerCase();
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      return new Bounds(-Infinity, -WEB_MERCATOR_Y_LIMIT, Infinity, WEB_MERCATOR_Y_LIMIT);
    }
    return null;
  }

  private _getMinMX(): number {
    const crs = this._crs.toLowerCase();
    let worldHeight: number;
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      worldHeight = WEB_MERCATOR_Y_LIMIT * 2;
    } else if (crs === 'epsg:4326' || crs === 'wgs84') {
      worldHeight = 180;
    } else {
      return this._initialMX * 0.01;
    }
    return this._height / worldHeight;
  }
}

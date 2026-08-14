import { Tween } from '../core/tween';

export interface CameraOptions {
  /** Target centre in projected/data coords (= P8 `mapCoord` space). */
  center?: [number, number];
  /** Target zoom (WebMercator convenience; converted via host.scaleFromZoom). */
  zoom?: number;
  /** Target scale (= |mx|); CRS-agnostic. Takes precedence over `zoom`. */
  scale?: number;
}

export interface AnimationOptions {
  /** ms. Default 1000 for ease/fly. Ignored when animate:false. */
  duration?: number;
  /** t∈[0,1] → eased t. Default Tween.sineInOut. */
  easing?: (t: number) => number;
  /** false (or duration:0) ⇒ jump (no animation). Default true. */
  animate?: boolean;
}

export interface FlyToOptions extends CameraOptions, AnimationOptions {
  /** van-Wijk curvature. Default 1.42. */
  curve?: number;
  /** Average flight speed (screenfuls/sec). Overrides duration if set. */
  speed?: number;
}

export interface FitBoundsOptions extends AnimationOptions {
  /** Pixels of inset on every side. Default 0. */
  padding?: number;
  /** Clamp the fitted scale to <= scale(maxZoom-equivalent). */
  maxScale?: number;
}

export interface CameraState {
  center: [number, number];
  scale: number;
}

/** Minimal surface Camera needs (keeps it unit-testable, no Emap import). */
export interface CameraHost {
  getCameraState(): CameraState;
  applyCameraState(center: [number, number], scale: number): void;
  /** zoom→scale (NaN if not meaningful for the CRS). */
  scaleFromZoom(zoom: number): number;
  getViewportSize(): { width: number; height: number };
  fire(type: string, e: { center: [number, number]; zoom: number; originalEvent: null }): void;
  requestRender(): void;
  /**
   * Stop the viewport's kinetic zoomIn/zoomOut tween, if any. Optional so
   * host stubs (and CRS-agnostic tests) need not implement it; the real
   * Emap host wires it to `Viewport.cancelZoomAnimation`. Without this a
   * `zoomIn()` tween still running when a camera method fires would keep
   * overwriting the transform and fight the camera destination.
   */
  cancelZoomAnimation?(): void;
}

const DEFAULT_DURATION = 1000;
const RHO_DEFAULT = 1.42; // van-Wijk recommended ≈ √2
const FLY_DEGENERATE_U = 1e-6; // sub-pixel travel ⇒ treat as pure zoom

function isFinitePair(p: [number, number]): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * Camera — animated view controller (DX P9). Drives the host viewport via
 * the existing `Tween`. State is `{center (data coords), scale}`; `zoom`
 * is an optional WebMercator convenience. 2D only (no bearing/pitch).
 * One active animation at a time (last-call-wins; see `easeTo`/`stop`).
 */
export class Camera {
  private _tween: Tween | null = null;
  private _activeEnd: (() => void) | null = null;

  constructor(private _host: CameraHost) {}

  /** Resolve a CameraOptions to a concrete target {center,scale}. */
  private _resolve(o: CameraOptions): CameraState {
    const cur = this._host.getCameraState();
    const center = o.center ?? cur.center;
    if (!isFinitePair(center)) throw new Error('camera: center must be finite');
    let scale = cur.scale;
    if (o.scale !== undefined) {
      scale = o.scale;
    } else if (o.zoom !== undefined) {
      if (!Number.isFinite(o.zoom)) throw new Error('camera: zoom must be finite');
      const s = this._host.scaleFromZoom(o.zoom);
      if (!Number.isFinite(s)) {
        throw new Error('camera: zoom is not meaningful for this CRS — pass { scale } instead');
      }
      scale = s;
    }
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error('camera: scale must be a finite positive number');
    }
    return { center: [center[0], center[1]], scale };
  }

  private _payload(s: CameraState): {
    center: [number, number];
    zoom: number;
    originalEvent: null;
  } {
    // zoom field is best-effort (NaN-safe): consumers that care about a
    // CRS-meaningful zoom can recompute; the camera contract is center+scale.
    return { center: [s.center[0], s.center[1]], zoom: Math.log2(s.scale), originalEvent: null };
  }

  /** True while an animation is running. */
  isMoving(): boolean {
    return this._tween !== null;
  }

  /** Instant move. Fires the movestart/move/moveend (+zoom*) lifecycle synchronously. */
  jumpTo(o: CameraOptions): void {
    const target = this._resolve(o);
    const from = this._host.getCameraState();
    const zoomChanged = target.scale !== from.scale;
    this._cancel(); // a jump supersedes any running animation (fires its terminal events)
    // p.zoom is log2(scale) — CRS-agnostic, non-authoritative; see _payload.
    const p = this._payload(target);
    this._host.fire('movestart', p);
    if (zoomChanged) this._host.fire('zoomstart', p);
    this._host.applyCameraState(target.center, target.scale);
    this._host.requestRender();
    this._host.fire('move', p);
    if (zoomChanged) this._host.fire('zoom', p);
    this._host.fire('moveend', p);
    if (zoomChanged) this._host.fire('zoomend', p);
  }

  /**
   * Animated move. Lerps centre linearly and scale in log space over
   * `duration` ms with `easing`. `animate:false`/`duration:0` ⇒ jump.
   * Last-call-wins: supersedes any running animation (its terminal
   * events fire first, via `_cancel`).
   */
  easeTo(o: CameraOptions & AnimationOptions): void {
    if (o.animate === false || o.duration === 0) {
      this.jumpTo(o); // jumpTo resolves + validates; no need to pre-resolve here
      return;
    }
    const target = this._resolve(o);
    const duration = o.duration ?? DEFAULT_DURATION;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error('camera: duration must be a finite non-negative number');
    }
    const ease = o.easing ?? Tween.sineInOut;

    this._cancel();
    const from = this._host.getCameraState();
    const zoomChanged = target.scale !== from.scale;
    const logFrom = Math.log(from.scale);
    const logTo = Math.log(target.scale);
    const startP = this._payload(from);
    this._host.fire('movestart', startP);
    if (zoomChanged) this._host.fire('zoomstart', startP);

    let lastState: CameraState = from;
    const emitEnd = () => {
      const endP = this._payload(lastState);
      this._host.fire('moveend', endP);
      if (zoomChanged) this._host.fire('zoomend', endP);
    };
    this._activeEnd = emitEnd;

    const tween = new Tween(ease);
    this._tween = tween;
    tween.on('change', (e: { value: number }) => {
      const t = e.value; // Tween already eased; lerps 0→1
      if (t >= 1) {
        // Snap to the exact target BEFORE the final move fires so `move`
        // and the following `moveend` agree (no end-of-animation jitter).
        lastState = target;
      } else {
        const cx = from.center[0] + (target.center[0] - from.center[0]) * t;
        const cy = from.center[1] + (target.center[1] - from.center[1]) * t;
        // log-space scale lerp: keeps perceived zoom rate constant.
        const scale = Math.exp(logFrom + (logTo - logFrom) * t);
        lastState = { center: [cx, cy], scale };
      }
      this._host.applyCameraState(lastState.center, lastState.scale);
      this._host.requestRender();
      const p = this._payload(lastState);
      this._host.fire('move', p);
      if (zoomChanged) this._host.fire('zoom', p);
      if (t >= 1) {
        this._tween = null;
        this._activeEnd = null;
        emitEnd();
      }
    });
    tween.start(0, 1, duration);
  }

  setCenter(center: [number, number]): void {
    this.jumpTo({ center });
  }
  setZoom(zoom: number): void {
    this.jumpTo({ zoom });
  }
  zoomTo(zoom: number, o: AnimationOptions = {}): void {
    this.easeTo({ zoom, ...o });
  }
  panTo(center: [number, number], o: AnimationOptions = {}): void {
    this.easeTo({ center, ...o });
  }

  /** Pan by a pixel offset (converted to a data-coord centre shift). */
  panBy(offset: [number, number], o: AnimationOptions = {}): void {
    const { center, scale } = this._host.getCameraState();
    // px → data: dx_data = dpx / mx ; flipY ⇒ dy_data = dpy / my = dpy / -scale
    const next: [number, number] = [center[0] + offset[0] / scale, center[1] + offset[1] / -scale];
    this.easeTo({ center: next, ...o });
  }

  /** Fit a Bounds (data coords) into the viewport with optional padding. */
  fitBounds(b: import('./bounds').Bounds, o: FitBoundsOptions = {}): void {
    const { width, height } = this._host.getViewportSize();
    const pad = o.padding ?? 0;
    const vw = Math.max(1, width - 2 * pad);
    const vh = Math.max(1, height - 2 * pad);
    const center: [number, number] = [b.centerX, b.centerY];
    const bw = b.width;
    const bh = b.height;
    let scale: number;
    if (!b.hasBounds() || (bw <= 0 && bh <= 0)) {
      // zero-area → keep current scale, clamped to maxScale
      scale = this._host.getCameraState().scale;
    } else {
      // scale so the larger dimension fits the padded viewport
      const sx = bw > 0 ? vw / bw : Infinity;
      const sy = bh > 0 ? vh / bh : Infinity;
      scale = Math.min(sx, sy);
    }
    if (o.maxScale !== undefined) scale = Math.min(scale, o.maxScale);
    if (!Number.isFinite(scale) || scale <= 0) scale = this._host.getCameraState().scale;
    this.easeTo({ center, scale, ...o });
  }

  /**
   * van-Wijk (2004) parabolic flight: for a far move, zoom out, pan, zoom
   * back in. Reduces to easeTo for near moves. `curve` default 1.42.
   */
  flyTo(o: FlyToOptions): void {
    const target = this._resolve(o);
    if (o.animate === false || o.duration === 0) {
      this.jumpTo(o);
      return;
    }
    let duration = o.duration ?? DEFAULT_DURATION;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error('camera: duration must be a finite non-negative number');
    }
    if (o.speed != null && (!Number.isFinite(o.speed) || o.speed <= 0)) {
      throw new Error('camera: speed must be a finite positive number');
    }
    const ease = o.easing ?? Tween.sineInOut;
    const rho = o.curve ?? RHO_DEFAULT;
    const { width } = this._host.getViewportSize();

    this._cancel();
    const from = this._host.getCameraState();
    const zoomChanged = target.scale !== from.scale;
    // Work in a "world" where 1 unit = 1 px at scale 1: w0/w1 are the
    // viewport widths in data units at the start/end scales.
    const u1 =
      Math.hypot(target.center[0] - from.center[0], target.center[1] - from.center[1]) *
      Math.max(from.scale, 1e-9); // pixel distance between centres at start scale
    const w0 = width / from.scale;
    const w1 = width / target.scale;
    const rho2 = rho * rho;

    // van-Wijk closed form (guard the degenerate u1≈0 → linear log-scale)
    function rCoeff(wk: number, sign: number): number {
      const u = u1 || 1e-9;
      const b = (w1 * w1 - w0 * w0 + sign * rho2 * rho2 * u * u) / (2 * wk * rho2 * u);
      return Math.log(Math.sqrt(b * b + 1) - b);
    }
    const r0 = rCoeff(w0, +1);
    const r1 = rCoeff(w1, -1);
    const S = u1 < FLY_DEGENERATE_U ? Math.abs(Math.log(w1 / w0)) / rho : (r1 - r0) / rho;
    // `speed` (screenfuls/sec, van-Wijk) overrides duration when set —
    // MapLibre parity: duration = 1000 * S / speed.
    if (o.speed != null) duration = (1000 * S) / o.speed;
    const startP = this._payload(from);
    this._host.fire('movestart', startP);
    if (zoomChanged) this._host.fire('zoomstart', startP);

    let lastState: CameraState = from;
    const emitEnd = () => {
      const endP = this._payload(lastState);
      this._host.fire('moveend', endP);
      if (zoomChanged) this._host.fire('zoomend', endP);
    };
    this._activeEnd = emitEnd;

    const tween = new Tween(ease);
    this._tween = tween;
    tween.on('change', (e: { value: number }) => {
      const k = e.value; // eased 0→1
      let cx: number, cy: number, scale: number;
      if (u1 < FLY_DEGENERATE_U) {
        // pure zoom: log-lerp scale, centre lerps trivially
        const lf = Math.log(from.scale);
        const lt = Math.log(target.scale);
        scale = Math.exp(lf + (lt - lf) * k);
        cx = from.center[0] + (target.center[0] - from.center[0]) * k;
        cy = from.center[1] + (target.center[1] - from.center[1]) * k;
      } else {
        // centre tracks eased k directly (plan §Task4 NOTE fallback); scale
        // follows the van-Wijk w(s) curve so a far move still zooms out then in.
        const s = k * S;
        const w = w0 * (Math.cosh(r0) / Math.cosh(rho * s + r0));
        scale = width / w;
        cx = from.center[0] + (target.center[0] - from.center[0]) * k;
        cy = from.center[1] + (target.center[1] - from.center[1]) * k;
      }
      lastState = k >= 1 ? target : { center: [cx, cy], scale };
      this._host.applyCameraState(lastState.center, lastState.scale);
      this._host.requestRender();
      const p = this._payload(lastState);
      this._host.fire('move', p);
      if (zoomChanged) this._host.fire('zoom', p);
      if (k >= 1) {
        this._tween = null;
        this._activeEnd = null;
        emitEnd();
      }
    });
    tween.start(0, 1, duration);
  }

  /** Cancel a running animation, firing its terminal events at the current state. */
  private _cancel(): void {
    // Also kill the viewport's separate kinetic zoom tween so a
    // zoomIn()/zoomOut() in flight cannot overwrite the camera transform.
    this._host.cancelZoomAnimation?.();
    if (this._tween) {
      this._tween.stop();
      this._tween = null;
    }
    if (this._activeEnd) {
      const end = this._activeEnd;
      this._activeEnd = null;
      end();
    }
  }

  /** Public: stop any running animation (no-op when idle). */
  stop(): void {
    this._cancel();
  }
}

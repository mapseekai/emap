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
  fire(type: string, e: { center: [number, number]; zoom: number; originalEvent: null }): void;
  requestRender(): void;
}

const DEFAULT_DURATION = 1000;

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

  private _payload(s: CameraState): { center: [number, number]; zoom: number; originalEvent: null } {
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

  /** Cancel a running animation, firing its terminal events at the current state. */
  private _cancel(): void {
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

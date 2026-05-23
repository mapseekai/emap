import type { RenderRequest, RenderAction, AffineDelta } from '../map/types';

/**
 * Frame time above which the next nav action enters the fast-nav code
 * path (CSS-transformed stale frame instead of a real redraw). Aligned
 * with mapshaper `gui-layer-renderer.mjs:31` `SLOW_FRAME_MS`.
 */
export const SLOW_FRAME_MS = 100;

/**
 * Maximum time the scheduler will keep a fast-nav frame on screen
 * without a real redraw. Acts as a watchdog in case the
 * `interactionend` event never arrives (tab switch, lost pointer).
 * Aligned with mapshaper `gui-layer-renderer.mjs:36`.
 */
export const FAST_SETTLE_FALLBACK_MS = 2000;

/**
 * Captured state from the last completed full redraw. Used to verify the
 * fast-nav transform math is still valid (canvas hasn't been resized,
 * device pixel ratio unchanged).
 */
export interface Snapshot {
  canvasWidth: number;
  canvasHeight: number;
  pixRatio: number;
}

export interface RenderCallbacks {
  /** Paint everything from scratch. The expensive path. */
  fullRedraw: () => void;
  /** Repaint overlays without re-running the main layer pass. */
  overlayOnly: () => void;
  /**
   * Apply a CSS transform to the main canvas reflecting a pan/zoom delta
   * relative to the last full-redraw snapshot.
   */
  fastNav: (delta: AffineDelta) => void;
}

/**
 * Frame router. Receives `RenderRequest`s and decides — based on the last
 * measured frame time and a captured snapshot — whether to do a full
 * redraw, an overlay-only redraw, or a fast-nav CSS transform. Mirrors
 * the decision logic in mapshaper `gui-layer-renderer.mjs`.
 */
export class RenderScheduler {
  private _lastFrameMs = 0;
  private _snapshot: Snapshot | null = null;
  private _fastActive = false;
  private _settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private _cb: RenderCallbacks) {}

  /** Route a single render request through the decision table. */
  schedule(req: RenderRequest): void {
    const action: RenderAction = req.action ?? 'redraw';

    if (action === 'hover') {
      this._cb.overlayOnly();
      return;
    }

    if (action === 'nav' && req.navDelta && this._shouldUseFastNav()) {
      this._fastActive = true;
      this._cb.fastNav(req.navDelta);
      this._scheduleSettleFallback();
      return;
    }

    // Default: 'redraw', non-fast 'nav', or 'nav' without delta — all become
    // full redraw (and cancel any pending fast-nav state).
    this._fullRedrawNow();
  }

  /**
   * Called by `Emap` after a full frame completes. Records the wall time
   * and current canvas dimensions so the next nav can decide whether to
   * fast-nav.
   */
  recordFrame(ms: number, snapshot: Snapshot): void {
    this._lastFrameMs = ms;
    this._snapshot = snapshot;
  }

  /**
   * Called when pointer interaction ends (pointerup, wheel idle). If a
   * fast-nav frame is currently on screen, we settle it with a real
   * redraw immediately rather than waiting for the fallback timer.
   */
  notifyInteractionEnd(): void {
    if (this._fastActive) {
      this._fullRedrawNow();
    }
  }

  /** Accessor for tests / diagnostics. */
  get lastFrameMs(): number { return this._lastFrameMs; }
  get fastActive(): boolean { return this._fastActive; }
  get snapshot(): Snapshot | null { return this._snapshot; }

  private _fullRedrawNow(): void {
    this._fastActive = false;
    this._cancelSettleFallback();
    this._cb.fullRedraw();
  }

  private _shouldUseFastNav(): boolean {
    if (!this._snapshot) return false;
    if (this._lastFrameMs <= SLOW_FRAME_MS) return false;
    return true;
  }

  private _scheduleSettleFallback(): void {
    this._cancelSettleFallback();
    this._settleTimer = setTimeout(() => {
      if (this._fastActive) this._fullRedrawNow();
    }, FAST_SETTLE_FALLBACK_MS);
  }

  private _cancelSettleFallback(): void {
    if (this._settleTimer !== null) {
      clearTimeout(this._settleTimer);
      this._settleTimer = null;
    }
  }
}

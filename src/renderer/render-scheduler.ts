import type { AffineDelta, RenderAction, RenderRequest } from '../map/types';

export const SLOW_FRAME_MS = 100;
export const FAST_SETTLE_FALLBACK_MS = 2000;

export interface RenderSnapshot {
  canvasWidth: number;
  canvasHeight: number;
  pixelRatio: number;
}

export interface RenderCallbacks {
  fullRedraw: () => void;
  fastNav: (delta: AffineDelta) => void;
  getSnapshot: () => RenderSnapshot;
}

export class RenderScheduler {
  private _lastFrameMs = 0;
  private _snapshot: RenderSnapshot | null = null;
  private _fastActive = false;
  private _settleRequested = false;
  private _settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private _callbacks: RenderCallbacks) {}

  schedule(req: RenderRequest = {}): void {
    const action: RenderAction = req.action ?? 'redraw';

    if (action === 'nav' && req.navDelta && this._shouldUseFastNav()) {
      this._fastActive = true;
      this._callbacks.fastNav(req.navDelta);
      this._markRedrawPending();
      return;
    }

    this._fullRedrawNow();
  }

  recordFrame(ms: number, snapshot: RenderSnapshot): void {
    this._lastFrameMs = ms;
    this._snapshot = snapshot;
  }

  notifyInteractionEnd(hasPendingNav = false): void {
    if (this._fastActive) {
      this._fullRedrawNow();
    } else if (hasPendingNav) {
      this._settleRequested = true;
    }
  }

  dispose(): void {
    this._cancelSettle();
  }

  get lastFrameMs(): number {
    return this._lastFrameMs;
  }

  get fastActive(): boolean {
    return this._fastActive;
  }

  private _fullRedrawNow(): void {
    this._fastActive = false;
    this._settleRequested = false;
    this._cancelSettle();
    this._callbacks.fullRedraw();
  }

  private _shouldUseFastNav(): boolean {
    if (!this._snapshot) return false;
    if (this._lastFrameMs <= SLOW_FRAME_MS) return false;

    const current = this._callbacks.getSnapshot();
    if (current.canvasWidth !== this._snapshot.canvasWidth) return false;
    if (current.canvasHeight !== this._snapshot.canvasHeight) return false;
    if (current.pixelRatio !== this._snapshot.pixelRatio) return false;
    return true;
  }

  private _markRedrawPending(): void {
    this._cancelSettle();
    if (this._settleRequested) {
      this._fullRedrawNow();
      return;
    }
    this._settleTimer = setTimeout(() => {
      if (this._fastActive) this._fullRedrawNow();
    }, FAST_SETTLE_FALLBACK_MS);
  }

  private _cancelSettle(): void {
    if (this._settleTimer !== null) {
      clearTimeout(this._settleTimer);
      this._settleTimer = null;
    }
  }
}

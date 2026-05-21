import { EventDispatcher } from '../events';
import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';

export interface DragPanOptions {
  /** Reserve shift+drag for higher-level handlers (P2b selection). Default true. */
  skipShiftDrag: boolean;
}

const DEFAULTS: DragPanOptions = { skipShiftDrag: true };
type Point = { x: number; y: number };

/**
 * Named `dragPan` handler. Phase 2a: pan logic lives in `handlePointer`,
 * driven by HandlerManager's single pointer-listener arbiter — the handler
 * owns no DOM listeners. Emits `panstart` / `pan {dx,dy}` / `panend` exactly
 * as before so Emap's viewport wiring is unchanged.
 */
export class DragPanHandler extends EventDispatcher implements Handler<DragPanOptions> {
  readonly name = 'dragPan';
  private _opts: DragPanOptions;
  private _enabled = true;
  private _dragging = false;
  private _last: { x: number; y: number } = { x: 0, y: 0 };
  private _hoverPoint: Point | null = null;
  private _onGestureStart?: () => void;
  private _isHoveringSelected?: (point: Point) => boolean;

  constructor(
    opts?: Partial<DragPanOptions>,
    onGestureStart?: () => void,
    isHoveringSelected?: (point: Point) => boolean,
  ) {
    super();
    this._opts = { ...DEFAULTS, ...opts };
    this._onGestureStart = onGestureStart;
    this._isHoveringSelected = isHoveringSelected;
  }

  enable(): void { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    if (this._dragging) { this._dragging = false; this.fire('panend'); }
  }
  isEnabled(): boolean { return this._enabled; }
  setOptions(opts: Partial<DragPanOptions>): void { this._opts = { ...this._opts, ...opts }; }
  getOptions(): Readonly<DragPanOptions> { return this._opts; }

  getCursor(): string | null {
    if (!this._enabled) return null;
    if (this._dragging) return 'grabbing';
    if (this._hoverPoint && this._isHoveringSelected?.(this._hoverPoint)) return 'move';
    return 'grab';
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';
    if (ev.kind === 'down') {
      if (ev.button !== 0) return 'passthrough';
      if (this._opts.skipShiftDrag && ev.modifiers.shift) return 'passthrough';
      // Only interrupt a running camera animation once this is committed to a
      // pan — shift+drag passes through to box/lasso-select and must not abort
      // a fly the camera was never asked to give up.
      this._onGestureStart?.();
      this._dragging = true;
      this._last = { x: ev.point.x, y: ev.point.y };
      this.fire('panstart');
      return 'exclusive';
    }
    if (ev.kind === 'move' && !this._dragging) {
      this._hoverPoint = { x: ev.point.x, y: ev.point.y };
      return 'passthrough';
    }
    if (ev.kind === 'move' && this._dragging) {
      const dx = ev.point.x - this._last.x;
      const dy = ev.point.y - this._last.y;
      this._last = { x: ev.point.x, y: ev.point.y };
      this.fire('pan', { dx, dy });
      return 'exclusive';
    }
    if (ev.kind === 'up' && this._dragging) {
      this._dragging = false;
      this.fire('panend');
      return 'passthrough';
    }
    return 'passthrough';
  }
}

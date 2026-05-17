import { EventDispatcher } from '../events';
import { MouseWheel } from '../interactions';
import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ScrollZoomOptions {}

interface WheelPayload { direction: number; multiplier: number; x: number; y: number; }

/**
 * Named `scrollZoom` handler. Phase 1: adapts the existing MouseWheel DOM
 * primitive, re-emitting its 'mousewheel' event. When disabled, re-emission
 * is suppressed (MouseWheel itself has no enable flag, so the handler gates
 * at the boundary).
 */
export class ScrollZoomHandler extends EventDispatcher implements Handler<ScrollZoomOptions> {
  readonly name = 'scrollZoom';
  private _wheel: MouseWheel;
  private _enabled = true;

  constructor(element: HTMLElement) {
    super();
    this._wheel = new MouseWheel(element);
    this._wheel.on('mousewheel', (e: WheelPayload) => {
      if (this._enabled) this.fire('mousewheel', e);
    });
  }

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  isEnabled(): boolean { return this._enabled; }
  setOptions(_opts: Partial<ScrollZoomOptions>): void {}
  getOptions(): Readonly<ScrollZoomOptions> { return {}; }
  handlePointer(_ev: NormalizedPointerEvent): HandlerResult { return 'passthrough'; }

  destroy(): void { this._wheel.destroy(); }
}

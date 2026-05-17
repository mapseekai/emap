import { EventDispatcher } from '../events';
import { DragPanHandler as PanGestureSource } from '../drag-pan-handler';
import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';

export interface DragPanOptions {
  /** Reserve shift+drag for higher-level handlers. Default true. */
  skipShiftDrag: boolean;
}

const DEFAULTS: DragPanOptions = { skipShiftDrag: true };

/**
 * Named `dragPan` handler. Phase 1: adapts the existing PanGestureSource DOM
 * primitive and re-emits its 'pan'/'panstart'/'panend' events, so Emap's
 * existing wiring is unchanged. handlePointer() is a passthrough no-op until
 * Phase 2 introduces the single-DOM arbitration layer.
 */
export class DragPanHandler extends EventDispatcher implements Handler<DragPanOptions> {
  readonly name = 'dragPan';
  private _opts: DragPanOptions;
  private _src: PanGestureSource;
  private _enabled = true;

  constructor(element: HTMLElement, opts?: Partial<DragPanOptions>) {
    super();
    this._opts = { ...DEFAULTS, ...opts };
    this._src = new PanGestureSource(element, { skipShiftDrag: this._opts.skipShiftDrag });
    this._src.on('pan', (e: { dx: number; dy: number }) => this.fire('pan', e));
    this._src.on('panstart', () => this.fire('panstart'));
    this._src.on('panend', () => this.fire('panend'));
  }

  enable(): void { this._enabled = true; this._src.setEnabled(true); }
  disable(): void { this._enabled = false; this._src.setEnabled(false); }
  isEnabled(): boolean { return this._enabled; }

  setOptions(opts: Partial<DragPanOptions>): void {
    this._opts = { ...this._opts, ...opts };
    // skipShiftDrag is fixed at construction in the underlying primitive;
    // Phase 2's arbitration layer makes this dynamic. Documented limitation.
  }
  getOptions(): Readonly<DragPanOptions> { return this._opts; }

  handlePointer(_ev: NormalizedPointerEvent): HandlerResult { return 'passthrough'; }

  destroy(): void { this._src.destroy(); }
}

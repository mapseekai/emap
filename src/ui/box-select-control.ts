import type { BoxSelectHandlerOptions, BoxSelectStyle } from '../engine/core/handlers/box-select';
import type { ModifierCombo } from '../engine/core/handlers/select-mode';
import type { ControlContext } from '../runtime/services/controls';
import type { Control } from './control';

export type { BoxSelectStyle } from '../engine/core/handlers/box-select';

export interface BoxSelectControlOptions {
  /**
   * Restrict the selection to a subset of layer ids. When omitted, every
   * visible layer participates (matching `queryFeatures` default).
   */
  layers?: string[];
  /** Visual style of the rubber-band rectangle. */
  style?: BoxSelectStyle;
  /**
   * Pixel diagonal threshold below which the drag is treated as no-op.
   * Default `4`.
   */
  dragThreshold?: number;
  /**
   * Modifier combo required to start dragging. Default `'none'`, so an active
   * box-select tool starts with a plain left-drag.
   */
  dragActivator?: ModifierCombo;
}

/**
 * Thin shell over the `map.boxSelect` handler (DX P2c). The handler owns
 * the drag gesture, the `.emap-box-select` rubber-band overlay,
 * hit-testing, and selection; this control just forwards options and
 * proxies enable/disable, returning a 0×0 anchor for `addControl`
 * placement. Public class, options, anchor DOM, and selection behaviour
 * are unchanged from the pre-P2c control.
 *
 * Modifier conventions: plain drag→`replace`, shift→`add`,
 * shift+alt→`toggle`. Mutually exclusive with
 * lasso-select — `onAdd` propagates the handler's throw if `lassoSelect`
 * is already enabled.
 */
export class BoxSelectControl implements Control {
  private _options: BoxSelectControlOptions;
  private _enabled = true;
  private _handler: ControlContext['boxSelect'] | null = null;
  private _container: HTMLElement | null = null;

  constructor(options: BoxSelectControlOptions = {}) {
    this._options = options;
  }

  onAdd(map: ControlContext): HTMLElement {
    this._handler = map.boxSelect;
    this._handler.setOptions({
      layers: this._options.layers,
      dragThreshold: this._options.dragThreshold,
      dragActivator: this._options.dragActivator,
      style: this._options.style,
    } as Partial<BoxSelectHandlerOptions>);
    if (this._enabled) this._handler.enable();

    const container = document.createElement('div');
    container.className = 'emap-ctrl emap-box-select-anchor';
    container.style.width = '0';
    container.style.height = '0';
    container.style.pointerEvents = 'none';
    this._container = container;
    return container;
  }

  onRemove(): void {
    this._handler?.disable();
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._handler = null;
    this._container = null;
  }

  disable(): void {
    this._enabled = false;
    this._handler?.disable();
  }

  enable(): void {
    this._enabled = true;
    this._handler?.enable();
  }

  isEnabled(): boolean {
    return this._handler ? this._handler.isEnabled() : this._enabled;
  }
}

import type { Control } from './control';
import type { Emap } from '../map/map';
import type { LassoSelectHandlerOptions } from '../core/handlers/lasso-select';

export { pointInPolygon, featureMatchesLasso } from '../core/handlers/select-geometry';
export type { LassoSelectStyle } from '../core/handlers/lasso-select';
import type { LassoSelectStyle } from '../core/handlers/lasso-select';

export interface LassoSelectControlOptions {
  /**
   * Restrict the selection to a subset of layer ids. When omitted, every
   * visible layer participates (matching `queryFeatures` default).
   */
  layers?: string[];
  /** Visual style of the lasso polyline. */
  style?: LassoSelectStyle;
  /**
   * Pixel diagonal threshold below which the drag is treated as no-op.
   * Default `4`.
   */
  dragThreshold?: number;
  /**
   * Select features that intersect the lasso boundary or interior, not only
   * features fully contained by it. Default `true`, matching box-select.
   */
  includeIntersecting?: boolean;
}

/**
 * Thin shell over the `map.lassoSelect` handler (DX P2c). The handler owns
 * the shift+drag free-form gesture, the dashed `.emap-lasso-select` SVG
 * polyline, polygon hit-testing, and selection; this control just forwards
 * options and proxies enable/disable, returning a 0×0 anchor. Public
 * class, options, anchor DOM, selection behaviour, and the dashed visual
 * are unchanged from the pre-P2c control.
 *
 * Modifier conventions (on top of shift): shift→`replace`,
 * shift+ctrl/meta→`add`, shift+alt→`toggle`. Mutually exclusive with
 * box-select — `onAdd` propagates the handler's throw if `boxSelect` is
 * already enabled.
 */
export class LassoSelectControl implements Control {
  private _options: LassoSelectControlOptions;
  private _enabled = true;
  private _handler: Emap['lassoSelect'] | null = null;
  private _container: HTMLElement | null = null;

  constructor(options: LassoSelectControlOptions = {}) {
    this._options = options;
  }

  onAdd(map: Emap): HTMLElement {
    this._handler = map.lassoSelect;
    this._handler.setOptions({
      layers: this._options.layers,
      dragThreshold: this._options.dragThreshold,
      includeIntersecting: this._options.includeIntersecting,
      style: this._options.style,
    } as Partial<LassoSelectHandlerOptions>);
    if (this._enabled) this._handler.enable();

    const container = document.createElement('div');
    container.className = 'emap-ctrl emap-lasso-select-anchor';
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

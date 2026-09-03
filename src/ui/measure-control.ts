import type { MeasureOptions } from '../core/handlers/measure';
import type { MeasurementMode } from '../geo/measurement';
import type { Emap } from '../map/map';
import type { Control } from './control';
import { createControlButton, createControlIcon, type ControlIconName } from './control-icons';

const DEFAULT_ICON_NAMES: Record<MeasurementMode, ControlIconName> = {
  length: 'measure-length',
  area: 'measure-area',
};

const DEFAULT_TITLES: Record<MeasurementMode, string> = {
  length: 'Measure length',
  area: 'Measure area',
};

export interface MeasureControlOptions extends MeasureOptions {
  icon?: string | Node;
}

/** Button control for one spherical measurement mode. Add one instance per mode. */
export class MeasureControl implements Control {
  private readonly _opts: MeasureControlOptions;
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _button: HTMLButtonElement | null = null;
  private readonly _onEditModeChange = (event: { mode: string }): void => {
    if (event.mode !== 'measure') {
      this._setPressed(false);
      return;
    }
    this._syncPressedState();
  };

  constructor(options: MeasureControlOptions) {
    this._opts = { ...options };
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group';

    this._button = createControlButton({
      className: 'emap-ctrl-measure',
      title: DEFAULT_TITLES[this._opts.mode],
      icon: this._opts.icon ?? createControlIcon(DEFAULT_ICON_NAMES[this._opts.mode]),
      onClick: () => this._toggle(),
      pressed: false,
      aria: { 'aria-label': DEFAULT_TITLES[this._opts.mode] },
    });
    this._container.appendChild(this._button);

    map.on('editmodechange', this._onEditModeChange);
    this._syncPressedState();
    return this._container;
  }

  onRemove(): void {
    const map = this._map;
    map?.off('editmodechange', this._onEditModeChange);
    if (map?.measure.isEnabled() && map.measure.getOptions().mode === this._opts.mode) {
      map.measure.disable();
    }
    this._container?.remove();
    this._map = null;
    this._container = null;
    this._button = null;
  }

  private _toggle(): void {
    const map = this._map;
    if (!map) return;
    const handler = map.measure;
    if (handler.isEnabled() && handler.getOptions().mode === this._opts.mode) {
      handler.disable();
      return;
    }

    if (handler.isEnabled()) handler.disable();
    const { icon: _icon, ...options } = this._opts;
    handler.setOptions(options);
    handler.enable();
  }

  private _syncPressedState(): void {
    const active =
      this._map?.measure.isEnabled() === true &&
      this._map.measure.getOptions().mode === this._opts.mode;
    this._setPressed(active);
  }

  private _setPressed(active: boolean): void {
    this._button?.classList.toggle('active', active);
    this._button?.setAttribute('aria-pressed', String(active));
  }
}

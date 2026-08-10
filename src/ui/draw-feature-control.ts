import type { DrawFeatureOptions, DrawGeometryType } from '../core/handlers/draw-feature';
import type { Control } from './control';
import type { Emap } from '../map/map';

export type { DrawGeometryType } from '../core/handlers/draw-feature';

export interface DrawFeatureControlOptions extends DrawFeatureOptions {
  icon?: string | Node;
}

const DEFAULT_ICONS: Record<DrawGeometryType, string> = {
  polygon: '▢',
  polyline: '╱',
  point: '●',
};

const DEFAULT_TITLES: Record<DrawGeometryType, string> = {
  polygon: 'Draw Polygon',
  polyline: 'Draw Polyline',
  point: 'Draw Point',
};

export class DrawFeatureControl implements Control {
  private _opts: DrawFeatureControlOptions;
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _btn: HTMLButtonElement | null = null;
  private _onEditModeChange = (e: { mode: string }) => {
    if (e.mode !== 'draw') {
      this._btn?.classList.remove('active');
      this._btn?.setAttribute('aria-pressed', 'false');
    }
  };

  constructor(options: DrawFeatureControlOptions) {
    this._opts = options;
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group';

    this._btn = document.createElement('button');
    this._btn.className = 'emap-ctrl-draw';
    this._btn.type = 'button';
    this._btn.title = DEFAULT_TITLES[this._opts.type];
    this._btn.setAttribute('aria-pressed', 'false');
    const iconSpan = document.createElement('span');
    iconSpan.className = 'emap-ctrl-icon';
    const icon = this._opts.icon ?? DEFAULT_ICONS[this._opts.type];
    if (typeof icon === 'string') {
      iconSpan.textContent = icon;
    } else {
      iconSpan.appendChild(icon);
    }
    this._btn.replaceChildren(iconSpan);
    this._btn.addEventListener('click', () => this._toggle());
    this._container.appendChild(this._btn);

    this._applyOptions();

    map.on('editmodechange', this._onEditModeChange);

    return this._container;
  }

  onRemove(): void {
    if (this._map && this._map.drawFeature.isEnabled()) {
      this._map.drawFeature.disable();
    }
    this._map?.off('editmodechange', this._onEditModeChange);
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = null;
    this._container = null;
    this._btn = null;
  }

  private _toggle(): void {
    if (!this._map) return;
    const df = this._map.drawFeature;
    if (df.isEnabled() && this._btn?.classList.contains('active')) {
      df.disable();
      this._btn?.classList.remove('active');
      this._btn?.setAttribute('aria-pressed', 'false');
    } else {
      if (df.isEnabled()) df.disable();
      this._applyOptions();
      df.enable();
      this._clearPeerActiveButtons();
      this._btn?.classList.add('active');
      this._btn?.setAttribute('aria-pressed', 'true');
    }
  }

  private _applyOptions(): void {
    if (!this._map) return;
    const { icon: _icon, ...handlerOpts } = this._opts;
    this._map.drawFeature.setOptions(handlerOpts);
  }

  private _clearPeerActiveButtons(): void {
    const group = this._btn?.closest('.emap-edit-toolbar, .emap-ctrl-group');
    group?.querySelectorAll('.emap-ctrl-draw.active').forEach((button) => {
      if (button !== this._btn) {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
      }
    });
  }
}

import { Control } from './control';
import { Emap } from '../map/map';

export interface StatusOptions {
  showMousePos?: boolean;
  showEPSG?: boolean;
  alignment?: 'left' | 'right' | 'center';
  className?: string;
}

export class StatusControl implements Control {
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _options: StatusOptions;
  private _mousePosEl: HTMLElement | null = null;
  private _epsgEl: HTMLElement | null = null;

  // Bound handlers (bound once to avoid memory leaks)
  private _onMouseMoveBound: (e: MouseEvent) => void;
  private _onUpdateEPSGBound: () => void;
  private _rafPending = false;

  constructor(options: StatusOptions = {}) {
    this._options = {
      showMousePos: true,
      showEPSG: true,
      alignment: 'left',
      ...options
    };
    this._onMouseMoveBound = this._onMouseMove.bind(this);
    this._onUpdateEPSGBound = this._updateEPSG.bind(this);
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = `emap-ctrl emap-status-ctrl emap-align-${this._options.alignment} ${this._options.className || ''}`;

    if (this._options.showMousePos) {
      this._mousePosEl = document.createElement('span');
      this._mousePosEl.className = 'emap-status-mousepos';
      this._container.appendChild(this._mousePosEl);
    }

    if (this._options.showEPSG) {
      this._epsgEl = document.createElement('span');
      this._epsgEl.className = 'emap-status-epsg';
      this._container.appendChild(this._epsgEl);
      this._updateEPSG();
    }

    this._map.on('crschange', this._onUpdateEPSGBound);
    this._map.getCanvasContainer().addEventListener('mousemove', this._onMouseMoveBound);

    return this._container;
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._map || !this._mousePosEl || !this._options.showMousePos) return;

    // Throttle DOM updates to one per animation frame
    if (this._rafPending) return;
    this._rafPending = true;

    const clientX = e.clientX;
    const clientY = e.clientY;

    requestAnimationFrame(() => {
      this._rafPending = false;
      if (!this._map || !this._mousePosEl) return;

      const rect = this._map.getCanvasContainer().getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const [mx, my] = this._map.unproject(x, y);
      this._mousePosEl.textContent = ` ${mx.toFixed(4)}, ${my.toFixed(4)}`;
    });
  }

  private _updateEPSG(): void {
    if (!this._map || !this._epsgEl) return;
    const epsg = this._map.getCRS();
    this._epsgEl.textContent = ` | ${epsg}`;
  }

  onRemove(): void {
    if (this._map) {
      this._map.getCanvasContainer().removeEventListener('mousemove', this._onMouseMoveBound);
      this._map.off('crschange', this._onUpdateEPSGBound);
    }
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = null;
    this._container = null;
  }
}

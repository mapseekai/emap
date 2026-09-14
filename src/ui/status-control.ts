import type { PointerMoveEvent } from '../core/pointer-event-dispatcher';
import { normalizeCrsString } from '../geo/crs-resolver';
import type { ControlContext } from '../services/controls';
import { Control } from './control';

export interface StatusOptions {
  showMousePos?: boolean;
  showEPSG?: boolean;
  alignment?: 'left' | 'right' | 'center';
  className?: string;
}

export class StatusControl implements Control {
  private _map: ControlContext | null = null;
  private _container: HTMLElement | null = null;
  private _options: StatusOptions;
  private _mousePosEl: HTMLElement | null = null;
  private _epsgEl: HTMLElement | null = null;

  // Bound handlers (bound once to avoid memory leaks)
  private _onMoveBound: (e: PointerMoveEvent) => void;
  private _onUpdateEPSGBound: () => void;
  private _rafPending = false;

  constructor(options: StatusOptions = {}) {
    this._options = {
      showMousePos: true,
      showEPSG: true,
      alignment: 'left',
      ...options,
    };
    this._onMoveBound = this._onMove.bind(this);
    this._onUpdateEPSGBound = this._updateEPSG.bind(this);
  }

  onAdd(map: ControlContext): HTMLElement {
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
    // Gate the delegated mousemove subscription on the option that actually
    // consumes it — installing it unconditionally would install the shared
    // arbiter pointer-sink even when the readout is disabled, breaking the
    // "zero cost when no listener is registered" guarantee (spec §17.6).
    if (this._options.showMousePos) {
      this._map.on('mousemove', this._onMoveBound);
    }

    return this._container;
  }

  private _onMove(e: PointerMoveEvent): void {
    if (!this._map || !this._mousePosEl || !this._options.showMousePos) return;

    // Throttle DOM updates to one per animation frame.
    if (this._rafPending) return;
    this._rafPending = true;

    const [mx, my] = e.mapCoord;

    requestAnimationFrame(() => {
      this._rafPending = false;
      if (!this._map || !this._mousePosEl) return;
      this._mousePosEl.textContent = ` ${mx.toFixed(4)}, ${my.toFixed(4)}`;
    });
  }

  private _updateEPSG(): void {
    if (!this._map || !this._epsgEl) return;
    const epsg = normalizeCrsString(this._map.getCRS());
    this._epsgEl.textContent = ` | ${epsg}`;
  }

  onRemove(): void {
    if (this._map) {
      if (this._options.showMousePos) this._map.off('mousemove', this._onMoveBound);
      this._map.off('crschange', this._onUpdateEPSGBound);
    }
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = null;
    this._container = null;
  }
}

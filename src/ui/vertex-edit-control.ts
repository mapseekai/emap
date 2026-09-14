import type { ControlContext } from '../runtime/services/controls';
import type { Control } from './control';
import { createControlButton, createControlIcon } from './control-icons';

export interface VertexEditControlOptions {
  /** Polygon hover fill, forwarded to map.vertexEdit. Default unchanged. */
  polygonFillColor?: string;
}

export class VertexEditControl implements Control {
  private _map: ControlContext | null = null;
  private _container: HTMLElement | null = null;
  private _btn: HTMLButtonElement | null = null;
  private _opts: VertexEditControlOptions;

  constructor(options: VertexEditControlOptions = {}) {
    this._opts = options;
  }

  onAdd(map: ControlContext): HTMLElement {
    this._map = map;
    if (this._opts.polygonFillColor !== undefined) {
      map.vertexEdit.setOptions({ polygonFillColor: this._opts.polygonFillColor });
    }
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group';
    this._btn = createControlButton({
      className: 'emap-ctrl-edit',
      title: 'Edit Vertices',
      icon: createControlIcon('edit'),
      onClick: () => this._toggle(),
      pressed: false,
    });
    this._container.appendChild(this._btn);
    return this._container;
  }

  onRemove(): void {
    if (this._map && this._map.vertexEdit.isEnabled()) this._map.vertexEdit.disable();
    if (this._container?.parentNode) this._container.parentNode.removeChild(this._container);
    this._map = null;
    this._container = null;
    this._btn = null;
  }

  private _toggle(): void {
    if (!this._map) return;
    const ve = this._map.vertexEdit;
    if (ve.isEnabled()) {
      ve.disable();
      this._btn?.classList.remove('active');
      this._btn?.setAttribute('aria-pressed', 'false');
    } else {
      ve.enable();
      this._btn?.classList.add('active');
      this._btn?.setAttribute('aria-pressed', 'true');
    }
  }
}

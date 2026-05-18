import type { Control } from './control';
import type { Emap } from '../map/map';

export interface VertexEditControlOptions {
  /** Polygon hover fill, forwarded to map.vertexEdit. Default unchanged. */
  polygonFillColor?: string;
}

export class VertexEditControl implements Control {
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _btn: HTMLButtonElement | null = null;
  private _opts: VertexEditControlOptions;

  constructor(options: VertexEditControlOptions = {}) { this._opts = options; }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    if (this._opts.polygonFillColor !== undefined) {
      map.vertexEdit.setOptions({ polygonFillColor: this._opts.polygonFillColor });
    }
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group';
    this._btn = document.createElement('button');
    this._btn.className = 'emap-ctrl-edit';
    this._btn.type = 'button';
    this._btn.title = 'Edit Vertices';
    this._btn.innerHTML = '<span class="emap-ctrl-icon">✏</span>';
    this._btn.addEventListener('click', () => this._toggle());
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
    if (ve.isEnabled()) { ve.disable(); this._btn?.classList.remove('active'); }
    else { ve.enable(); this._btn?.classList.add('active'); }
  }
}

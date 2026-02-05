import { Control } from './control';
import { Emap } from '../map/map';

export interface NavigationOptions {
  showZoom?: boolean;
  showHome?: boolean;
  className?: string;
}

export class NavigationControl implements Control {
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _options: NavigationOptions;

  constructor(options: NavigationOptions = {}) {
    this._options = {
      showZoom: true,
      showHome: true,
      ...options
    };
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = `emap-ctrl emap-ctrl-group ${this._options.className || ''}`;

    if (this._options.showZoom) {
      this._createButton('zoom-in', '+', 'Zoom In', () => {
        this._map?.zoomIn();
      });
      this._createButton('zoom-out', '-', 'Zoom Out', () => {
        this._map?.zoomOut();
      });
    }

    if (this._options.showHome) {
      this._createButton('home', '⌂', 'Reset View', () => {
        // Need to implement reset logic or call setExtent with initial extent if we have it
        this._map?.fire('reset');
      });
    }

    return this._container;
  }

  private _createButton(id: string, label: string, title: string, onClick: () => void): void {
    const btn = document.createElement('button');
    btn.className = `emap-ctrl-${id}`;
    btn.type = 'button';
    btn.title = title;
    btn.innerHTML = `<span class="emap-ctrl-icon">${label}</span>`;
    btn.addEventListener('click', onClick);
    this._container?.appendChild(btn);
  }

  onRemove(): void {
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = null;
    this._container = null;
  }
}

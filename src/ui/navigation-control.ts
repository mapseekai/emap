import type { ControlContext } from '../services/controls';
import { Control } from './control';
import { createControlButton, createControlIcon } from './control-icons';

export interface NavigationOptions {
  showZoom?: boolean;
  showHome?: boolean;
  className?: string;
}

export class NavigationControl implements Control {
  private _map: ControlContext | null = null;
  private _container: HTMLElement | null = null;
  private _options: NavigationOptions;

  constructor(options: NavigationOptions = {}) {
    this._options = {
      showZoom: true,
      showHome: true,
      ...options,
    };
  }

  onAdd(map: ControlContext): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = `emap-ctrl emap-ctrl-group ${this._options.className || ''}`;

    if (this._options.showZoom) {
      this._container.appendChild(
        createControlButton({
          className: 'emap-ctrl-zoom-in',
          title: 'Zoom In',
          icon: createControlIcon('zoom-in'),
          onClick: () => this._map?.zoomIn(),
        }),
      );
      this._container.appendChild(
        createControlButton({
          className: 'emap-ctrl-zoom-out',
          title: 'Zoom Out',
          icon: createControlIcon('zoom-out'),
          onClick: () => this._map?.zoomOut(),
        }),
      );
    }

    if (this._options.showHome) {
      this._container.appendChild(
        createControlButton({
          className: 'emap-ctrl-home',
          title: 'Reset View',
          icon: createControlIcon('home'),
          onClick: () => this._map?.fire('reset'),
        }),
      );
    }

    return this._container;
  }

  onRemove(): void {
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = null;
    this._container = null;
  }
}

import { type MapOptions } from '../../map/types';
import type { ControlPosition } from '../../ui/control';

/** surface implementation, wired through explicit service dependencies. */
export class SurfaceServiceImpl {
  _container!: HTMLElement;

  _canvasContainer!: HTMLElement;

  _controlContainers: globalThis.Map<ControlPosition, HTMLElement> = new globalThis.Map();

  public getCanvasContainer(): HTMLElement {
    return this._canvasContainer;
  }

  _createCanvasContainer(): HTMLElement {
    const el = document.createElement('div');
    el.style.position = 'relative';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.overflow = 'hidden';
    el.className = 'emap-canvas-container';

    const corners: ControlPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    for (const pos of corners) {
      const container = document.createElement('div');
      container.className = `emap-ctrl-${pos}`;
      container.style.position = 'absolute';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '10';

      const [v, h] = pos.split('-');
      container.style[v as 'top' | 'bottom'] = '10px';
      container.style[h as 'left' | 'right'] = '10px';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';

      // Stop UI-control events from bubbling onto the canvas. Without this,
      // clicking a control button (Undo, Navigation, …) also fires the
      // canvas's `click` handler — which examples wire to feature
      // selection — and starts the drag-pan on `mousedown`. `pointer-events:
      // none` on the container itself prevents hit-testing on empty space
      // around buttons, but events on the buttons themselves still bubble.
      const swallow = (e: Event) => e.stopPropagation();
      for (const type of ['click', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) {
        container.addEventListener(type, swallow);
      }
      // Wheel events listed separately: register passive so the page can
      // continue scrolling normally when the cursor sits over the control
      // chrome, AND so Chrome doesn't log a "non-passive wheel handler"
      // warning. We still call stopPropagation, which prevents the wheel
      // event from reaching the canvas's zoom handler — that's the part
      // we actually want.
      container.addEventListener('wheel', swallow, { passive: true });

      el.appendChild(container);
      this._controlContainers.set(pos, container);
    }

    return el;
  }

  initialize(options: { container?: MapOptions['container'] }): void {
    if (typeof options.container === 'string') {
      const element = document.getElementById(options.container);
      if (!element) throw new Error(`Container #${options.container} not found`);
      this._container = element;
    } else {
      if (!options.container) throw new Error('This preset requires a DOM container');
      this._container = options.container;
    }
    this._canvasContainer = this._createCanvasContainer();
    this._container.appendChild(this._canvasContainer);
  }
  dispose(): void {
    this._canvasContainer?.remove();
    this._controlContainers.clear();
  }
}

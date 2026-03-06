import { Control } from './control';
import { Emap } from '../map/map';
import { VertexEditControl } from './vertex-edit-control';

/**
 * EditToolbar wraps the VertexEditControl with a styled toolbar container.
 * Usage:
 *   map.addControl(new EditToolbar(), 'top-left');
 */
export class EditToolbar implements Control {
  private _container: HTMLElement | null = null;
  private _vertexEditControl: VertexEditControl;

  constructor() {
    this._vertexEditControl = new VertexEditControl();
  }

  onAdd(map: Emap): HTMLElement {
    // The vertex edit control returns its own element
    const vertexEl = this._vertexEditControl.onAdd(map);

    // Wrap in a toolbar container
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group emap-edit-toolbar';

    // Move the button from the vertex control's container into ours
    const btn = vertexEl.querySelector('button');
    if (btn) {
      this._container.appendChild(btn);
    }

    return this._container;
  }

  onRemove(): void {
    this._vertexEditControl.onRemove();
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = null;
  }
}

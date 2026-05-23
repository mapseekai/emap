import { Control } from './control';
import { Emap } from '../map/map';
import { VertexEditControl } from './vertex-edit-control';
import { DrawFeatureControl } from './draw-feature-control';

export interface EditToolbarOptions {
  /** Explicit controls to render. When provided, default edit/draw buttons are not added. */
  controls?: Control[];
  /** Source ID for draw tools. If not provided, draw buttons are not shown. */
  drawSource?: string;
  /** Source layer name for draw tools (optional, defaults to first matching layer). */
  drawSourceLayer?: string;
}

/**
 * EditToolbar wraps editing controls (vertex edit + draw tools) in a styled toolbar.
 *
 * Usage:
 *   // Vertex edit only (backward compatible)
 *   map.addControl(new EditToolbar(), 'top-left');
 *
 *   // With draw tools
 *   map.addControl(new EditToolbar({ drawSource: 'my-source' }), 'top-left');
 *
 *   // Custom composition
 *   map.addControl(new EditToolbar({ controls: [new VertexEditControl()] }), 'top-left');
 */
export class EditToolbar implements Control {
  private _container: HTMLElement | null = null;
  private _controls: Control[];
  private _options: EditToolbarOptions;

  constructor(options?: EditToolbarOptions) {
    this._options = options || {};
    if (this._options.controls) {
      this._controls = this._options.controls;
    } else {
      this._controls = [new VertexEditControl()];
      if (this._options.drawSource) {
        this._controls.push(
          new DrawFeatureControl({
            source: this._options.drawSource,
            sourceLayer: this._options.drawSourceLayer,
            type: 'polygon',
          }),
          new DrawFeatureControl({
            source: this._options.drawSource,
            sourceLayer: this._options.drawSourceLayer,
            type: 'polyline',
          }),
          new DrawFeatureControl({
            source: this._options.drawSource,
            sourceLayer: this._options.drawSourceLayer,
            type: 'point',
          }),
        );
      }
    }
  }

  onAdd(map: Emap): HTMLElement {
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group emap-edit-toolbar';

    for (const control of this._controls) {
      const controlEl = control.onAdd(map);
      const buttons = controlEl.querySelectorAll('button');
      for (const button of buttons) {
        this._container.appendChild(button);
      }
    }

    return this._container;
  }

  onRemove(): void {
    for (const control of this._controls) {
      control.onRemove();
    }
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = null;
  }
}

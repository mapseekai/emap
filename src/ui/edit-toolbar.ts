import { Control } from './control';
import { Emap } from '../map/map';
import { VertexEditControl } from './vertex-edit-control';
import { DrawFeatureControl } from './draw-feature-control';

export interface EditToolbarOptions {
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
 */
export class EditToolbar implements Control {
  private _container: HTMLElement | null = null;
  private _vertexEditControl: VertexEditControl;
  private _drawControls: DrawFeatureControl[] = [];
  private _options: EditToolbarOptions;

  constructor(options?: EditToolbarOptions) {
    this._options = options || {};
    this._vertexEditControl = new VertexEditControl();

    if (this._options.drawSource) {
      this._drawControls = [
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
      ];
    }
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

    // Add draw tool buttons
    for (const drawCtrl of this._drawControls) {
      const drawEl = drawCtrl.onAdd(map);
      const drawBtn = drawEl.querySelector('button');
      if (drawBtn) {
        this._container.appendChild(drawBtn);
      }
    }

    return this._container;
  }

  onRemove(): void {
    this._vertexEditControl.onRemove();
    for (const drawCtrl of this._drawControls) {
      drawCtrl.onRemove();
    }
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = null;
  }
}

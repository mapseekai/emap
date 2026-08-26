import type { Emap } from '../map/map';
import type { Control } from './control';
import { VertexEditControl } from './vertex-edit-control';
import { DrawFeatureControl } from './draw-feature-control';

type AdvancedTool = 'reshape' | 'ring-add' | 'ring-delete' | 'part-add' | 'part-delete';

const ADVANCED_TOOL_TITLES: Record<AdvancedTool, string> = {
  reshape: 'Reshape Feature',
  'ring-add': 'Add Hole',
  'ring-delete': 'Delete Hole',
  'part-add': 'Add Part',
  'part-delete': 'Delete Part',
};

export interface EditToolbarOptions {
  /** Explicit controls to render. When provided, default edit/draw buttons are not added. */
  controls?: Control[];
  /** Source ID for draw tools. If not provided, draw buttons are not shown. */
  drawSource?: string;
  /** Source layer name for draw tools (optional, defaults to first matching layer). */
  drawSourceLayer?: string;
  /** Include reshape, ring, and part editing tools. Defaults to false. */
  advancedTools?: boolean;
}

class AdvancedEditControl implements Control {
  private _map: Emap | null = null;
  private _button: HTMLButtonElement | null = null;
  private readonly _onEditModeChange = (event: { mode: string }): void => this._syncPressed(event.mode);

  constructor(private readonly _tool: AdvancedTool) {}

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    const container = document.createElement('div');
    container.className = 'emap-ctrl emap-ctrl-group';
    this._button = document.createElement('button');
    this._button.className = `emap-ctrl-${this._tool}`;
    this._button.type = 'button';
    this._button.title = ADVANCED_TOOL_TITLES[this._tool];
    this._button.setAttribute('aria-label', this._button.title);
    this._button.setAttribute('aria-pressed', 'false');
    this._button.textContent = this._button.title;
    this._button.addEventListener('click', () => this._toggle());
    container.appendChild(this._button);
    map.on('editmodechange', this._onEditModeChange);
    return container;
  }

  onRemove(): void {
    const map = this._map;
    map?.off('editmodechange', this._onEditModeChange);
    if (map && this._matchesActiveHandler()) this._disable();
    this._button?.remove();
    this._button = null;
    this._map = null;
  }

  private _toggle(): void {
    const map = this._map;
    if (!map) return;
    if (this._matchesActiveHandler()) {
      this._disable();
      return;
    }
    if (this._tool === 'reshape') {
      if (map.reshapeFeature.isEnabled()) map.reshapeFeature.disable();
      map.reshapeFeature.enable();
      return;
    }
    const handler = this._tool.startsWith('ring') ? map.ringEdit : map.partEdit;
    if (handler.isEnabled()) handler.disable();
    handler.setOptions({ mode: this._mode() });
    handler.enable();
  }

  private _disable(): void {
    const map = this._map;
    if (!map) return;
    if (this._tool === 'reshape') {
      map.reshapeFeature.disable();
      return;
    }
    (this._tool.startsWith('ring') ? map.ringEdit : map.partEdit).disable();
  }

  private _matchesActiveHandler(): boolean {
    const map = this._map;
    if (!map) return false;
    if (this._tool === 'reshape') return map.reshapeFeature.isEnabled();
    const handler = this._tool.startsWith('ring') ? map.ringEdit : map.partEdit;
    return handler.isEnabled() && handler.getOptions().mode === this._mode();
  }

  private _mode(): 'add' | 'delete' {
    return this._tool.endsWith('add') ? 'add' : 'delete';
  }

  private _syncPressed(mode: string): void {
    const expectedMode = this._tool === 'reshape'
      ? 'reshape'
      : this._tool.startsWith('ring')
        ? 'ring'
        : 'part';
    const active = mode === expectedMode && this._matchesActiveHandler();
    this._button?.classList.toggle('active', active);
    this._button?.setAttribute('aria-pressed', String(active));
  }
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
      if (this._options.advancedTools) {
        this._controls.push(
          new AdvancedEditControl('reshape'),
          new AdvancedEditControl('ring-add'),
          new AdvancedEditControl('ring-delete'),
          new AdvancedEditControl('part-add'),
          new AdvancedEditControl('part-delete'),
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

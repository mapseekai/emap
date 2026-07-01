import { Control } from './control';
import { Emap } from '../map/map';
import type { HistoryStateSnapshot } from '../edit/edit-history';

export interface HistoryControlOptions {
  /** Tooltip text for the undo button. Default: "Undo (Ctrl+Z)". */
  undoTitle?: string;
  /** Tooltip text for the redo button. Default: "Redo (Ctrl+Shift+Z)". */
  redoTitle?: string;
  /** Optional class to add to the control container. */
  className?: string;
}

/**
 * Two-button Undo / Redo control.
 *
 * Buttons are enabled / disabled based on the map's `historychange` event so
 * they always reflect `canUndo()` / `canRedo()` without polling.
 */
export class HistoryControl implements Control {
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _undoBtn: HTMLButtonElement | null = null;
  private _redoBtn: HTMLButtonElement | null = null;
  private _options: HistoryControlOptions;
  private _onHistoryChange: ((e: { canUndo: boolean; canRedo: boolean }) => void) | null = null;

  constructor(options: HistoryControlOptions = {}) {
    this._options = options;
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = `emap-ctrl emap-ctrl-group ${this._options.className || ''}`.trim();

    this._undoBtn = this._createButton(
      'undo',
      '↶',
      this._options.undoTitle ?? 'Undo (Ctrl+Z)',
      () => {
        this._map?.undo();
      },
    );
    this._redoBtn = this._createButton(
      'redo',
      '↷',
      this._options.redoTitle ?? 'Redo (Ctrl+Shift+Z)',
      () => {
        this._map?.redo();
      },
    );

    // Initial enabled state — drives off the current map state, not just future events.
    this._setEnabled(map.canUndo(), map.canRedo());

    this._onHistoryChange = (e) => this._setEnabled(e.canUndo, e.canRedo);
    map.on<HistoryStateSnapshot>('historychange', this._onHistoryChange);

    return this._container;
  }

  onRemove(): void {
    if (this._map && this._onHistoryChange) {
      this._map.off('historychange', this._onHistoryChange);
    }
    this._onHistoryChange = null;
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = null;
    this._container = null;
    this._undoBtn = null;
    this._redoBtn = null;
  }

  private _setEnabled(canUndo: boolean, canRedo: boolean): void {
    if (this._undoBtn) this._undoBtn.disabled = !canUndo;
    if (this._redoBtn) this._redoBtn.disabled = !canRedo;
  }

  private _createButton(
    id: string,
    label: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `emap-ctrl-${id}`;
    btn.type = 'button';
    btn.title = title;
    btn.disabled = true;
    const icon = document.createElement('span');
    icon.className = 'emap-ctrl-icon';
    icon.textContent = label;
    btn.appendChild(icon);
    btn.addEventListener('click', onClick);
    this._container?.appendChild(btn);
    return btn;
  }
}

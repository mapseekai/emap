import { EventDispatcher } from './events';

/**
 * Handles mouse drag-to-pan interaction.
 * Matches the MouseWheel pattern — extends EventDispatcher and emits events.
 *
 * Events:
 *   'pan' — { dx: number, dy: number } — pixel delta to translate
 *   'panstart' — drag started
 *   'panend' — drag ended
 */
export class DragPanHandler extends EventDispatcher {
  private _isDragging: boolean = false;
  private _lastMousePos: [number, number] = [0, 0];
  private _enabled: boolean = true;

  private _onMouseDownBound: (e: MouseEvent) => void;
  private _onMouseMoveBound: (e: MouseEvent) => void;
  private _onMouseUpBound: (e: MouseEvent) => void;

  constructor(element: HTMLElement) {
    super();
    this._onMouseDownBound = this._onMouseDown.bind(this);
    this._onMouseMoveBound = this._onMouseMove.bind(this);
    this._onMouseUpBound = this._onMouseUp.bind(this);

    element.addEventListener('mousedown', this._onMouseDownBound);
    window.addEventListener('mousemove', this._onMouseMoveBound);
    window.addEventListener('mouseup', this._onMouseUpBound);
  }

  /** Temporarily disable pan (e.g. during vertex editing) */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled && this._isDragging) {
      this._isDragging = false;
      this.fire('panend');
    }
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  isDragging(): boolean {
    return this._isDragging;
  }

  destroy(): void {
    // Note: we can't remove window listeners without reference to the original element,
    // but the bound functions are unique so this works.
    window.removeEventListener('mousemove', this._onMouseMoveBound);
    window.removeEventListener('mouseup', this._onMouseUpBound);
  }

  private _onMouseDown(e: MouseEvent): void {
    if (!this._enabled) return;
    this._isDragging = true;
    this._lastMousePos = [e.clientX, e.clientY];
    this.fire('panstart');
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._isDragging) return;
    const dx = e.clientX - this._lastMousePos[0];
    const dy = e.clientY - this._lastMousePos[1];
    this._lastMousePos = [e.clientX, e.clientY];
    this.fire('pan', { dx, dy });
  }

  private _onMouseUp(): void {
    if (!this._isDragging) return;
    this._isDragging = false;
    this.fire('panend');
  }
}

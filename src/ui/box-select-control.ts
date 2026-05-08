import type { Control } from './control';
import type { Emap, FeatureRef } from '../map/map';

/** Visual style for the rubber-band rectangle. */
export interface BoxSelectStyle {
  /** Stroke color. Default `'#0078ff'`. */
  stroke?: string;
  /** Stroke width in CSS pixels. Default `1.5`. */
  strokeWidth?: number;
  /** Fill color. Default `'rgba(0, 120, 255, 0.1)'`. */
  fill?: string;
}

export interface BoxSelectControlOptions {
  /**
   * Restrict the selection to a subset of layer ids. When omitted, every
   * visible layer participates (matching `queryFeatures` default).
   */
  layers?: string[];
  /** Visual style of the rubber-band rectangle. */
  style?: BoxSelectStyle;
  /**
   * Pixel diagonal threshold below which the drag is treated as no-op.
   * Default `4`.
   */
  dragThreshold?: number;
}

/**
 * Shift+drag rubber-band feature selection. Reuses
 * `Emap.queryFeatures(bbox)` for hit-testing and `Emap.select` for
 * selection state management.
 *
 * Modifier-key conventions (layered on top of shift):
 * - shift only → mode `'replace'`
 * - shift + ctrl/meta → mode `'add'`
 * - shift + alt → mode `'toggle'`
 *
 * Tiny drags (< `dragThreshold` px diagonal) cancel without selecting.
 *
 * Coordinates with `DragPanHandler`: the handler now skips shift-modified
 * mousedowns, leaving shift+drag for this control.
 */
export class BoxSelectControl implements Control {
  private _options: BoxSelectControlOptions;
  private _dragThreshold: number;
  private _enabled: boolean = true;

  private _map: Emap | null = null;
  private _container: HTMLElement | null = null; // 0×0 anchor returned to addControl
  private _overlay: HTMLDivElement | null = null; // visible rubber-band rectangle
  private _canvasContainer: HTMLElement | null = null;

  // Drag state — null when not dragging
  private _startPx: [number, number] | null = null;

  // Bound handlers
  private _onMouseDownBound: (e: MouseEvent) => void;
  private _onMouseMoveBound: (e: MouseEvent) => void;
  private _onMouseUpBound: (e: MouseEvent) => void;

  constructor(options: BoxSelectControlOptions = {}) {
    this._options = options;
    this._dragThreshold = options.dragThreshold ?? 4;
    this._onMouseDownBound = this._onMouseDown.bind(this);
    this._onMouseMoveBound = this._onMouseMove.bind(this);
    this._onMouseUpBound = this._onMouseUp.bind(this);
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._canvasContainer = map.getCanvasContainer();

    // Rubber-band overlay — absolutely positioned inside the canvas container.
    const overlay = document.createElement('div');
    overlay.className = 'emap-box-select';
    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'none';
    overlay.style.display = 'none';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '0';
    overlay.style.height = '0';
    const style = this._options.style ?? {};
    overlay.style.border = `${style.strokeWidth ?? 1.5}px solid ${style.stroke ?? '#0078ff'}`;
    overlay.style.background = style.fill ?? 'rgba(0, 120, 255, 0.1)';
    overlay.style.boxSizing = 'border-box';
    this._canvasContainer.appendChild(overlay);
    this._overlay = overlay;

    this._canvasContainer.addEventListener('mousedown', this._onMouseDownBound);

    // 0×0 corner anchor (Control protocol expects an element to attach).
    const container = document.createElement('div');
    container.className = 'emap-ctrl emap-box-select-anchor';
    container.style.width = '0';
    container.style.height = '0';
    container.style.pointerEvents = 'none';
    this._container = container;
    return container;
  }

  onRemove(): void {
    if (this._canvasContainer) {
      this._canvasContainer.removeEventListener('mousedown', this._onMouseDownBound);
    }
    window.removeEventListener('mousemove', this._onMouseMoveBound);
    window.removeEventListener('mouseup', this._onMouseUpBound);

    if (this._overlay?.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }

    this._map = null;
    this._canvasContainer = null;
    this._overlay = null;
    this._container = null;
    this._startPx = null;
  }

  /** Disable the control — shift+drag becomes a no-op until re-enabled. */
  disable(): void {
    this._enabled = false;
    if (this._startPx) {
      this._cancelDrag();
    }
  }

  enable(): void {
    this._enabled = true;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  // ---------------------------------------------------------------------------

  private _onMouseDown(e: MouseEvent): void {
    if (!this._enabled) return;
    if (!e.shiftKey) return;
    if (e.button !== 0) return;
    if (!this._canvasContainer || !this._overlay) return;

    e.preventDefault();
    const [px, py] = this._eventToContainerPx(e);
    this._startPx = [px, py];

    this._overlay.style.left = `${px}px`;
    this._overlay.style.top = `${py}px`;
    this._overlay.style.width = '0';
    this._overlay.style.height = '0';
    this._overlay.style.display = 'block';

    window.addEventListener('mousemove', this._onMouseMoveBound);
    window.addEventListener('mouseup', this._onMouseUpBound);
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._startPx || !this._overlay) return;
    const [cx, cy] = this._eventToContainerPx(e);
    const [sx, sy] = this._startPx;
    const left = Math.min(sx, cx);
    const top = Math.min(sy, cy);
    const w = Math.abs(cx - sx);
    const h = Math.abs(cy - sy);
    this._overlay.style.left = `${left}px`;
    this._overlay.style.top = `${top}px`;
    this._overlay.style.width = `${w}px`;
    this._overlay.style.height = `${h}px`;
  }

  private _onMouseUp(e: MouseEvent): void {
    if (!this._startPx || !this._map || !this._overlay) {
      this._cleanupDrag();
      return;
    }

    const [sx, sy] = this._startPx;
    const [cx, cy] = this._eventToContainerPx(e);
    const dx = cx - sx;
    const dy = cy - sy;
    const diag = Math.hypot(dx, dy);

    this._overlay.style.display = 'none';

    if (diag < this._dragThreshold) {
      this._cleanupDrag();
      return;
    }

    const x1 = Math.min(sx, cx);
    const y1 = Math.min(sy, cy);
    const x2 = Math.max(sx, cx);
    const y2 = Math.max(sy, cy);

    const features = this._map.queryFeatures(
      [[x1, y1], [x2, y2]],
      this._options.layers ? { layers: this._options.layers } : undefined,
    );

    const refs = dedupeRefs(features);
    const mode = this._modeFromEvent(e);
    this._map.select(refs, { mode });

    this._cleanupDrag();
  }

  private _cancelDrag(): void {
    if (this._overlay) this._overlay.style.display = 'none';
    this._cleanupDrag();
  }

  private _cleanupDrag(): void {
    this._startPx = null;
    window.removeEventListener('mousemove', this._onMouseMoveBound);
    window.removeEventListener('mouseup', this._onMouseUpBound);
  }

  private _eventToContainerPx(e: MouseEvent): [number, number] {
    if (!this._canvasContainer) return [0, 0];
    const rect = this._canvasContainer.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private _modeFromEvent(e: MouseEvent): 'replace' | 'add' | 'toggle' {
    if (e.altKey) return 'toggle';
    if (e.ctrlKey || e.metaKey) return 'add';
    return 'replace';
  }
}

/** Dedupe `(source, layer, id)` triples — same feature can show up under
 *  multiple visible layers when a source has e.g. fill + line styling. */
function dedupeRefs(features: ReadonlyArray<{ source: string; layer: string; id: number }>): FeatureRef[] {
  const seen = new Set<string>();
  const out: FeatureRef[] = [];
  for (const f of features) {
    const key = `${f.source}|${f.layer}|${f.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: f.source, layer: f.layer, id: f.id });
  }
  return out;
}

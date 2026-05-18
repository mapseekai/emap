import { EventDispatcher } from '../events';
import type { Handler, HandlerResult, NormalizedPointerEvent, PointerModifiers } from '../handler';
import { resolveMode, type ModifierCombo } from './select-mode';
import { dedupeRefs } from './select-geometry';
import type { SelectHandlerOptions } from './click-select';
import type { Emap } from '../../map/map';

export interface BoxSelectStyle { stroke?: string; strokeWidth?: number; fill?: string; }
export interface BoxSelectHandlerOptions extends SelectHandlerOptions {
  /** Min drag diagonal (px) before a release counts as a box. Default 4. */
  dragThreshold?: number;
  /** Combo that must be held at pointerdown to start. Default 'shift'. */
  dragActivator?: ModifierCombo;
  style?: BoxSelectStyle;
}

const BOX_DEFAULT_MODS = { replace: 'none', add: 'ctrl', toggle: 'alt' } as const;

/** True iff every key of `combo` is held (extra held keys allowed). */
function comboHeld(m: PointerModifiers, combo: ModifierCombo): boolean {
  if (combo === 'none') return true;
  return combo.split('+').every((k) => (m as any)[k] === true);
}

/**
 * Named `boxSelect` handler. Disabled by default. On `dragActivator`+down
 * it captures the gesture (`'exclusive'`), draws a rubber-band rectangle in
 * `_canvasContainer`, and on release past `dragThreshold` runs
 * `queryFeatures(bbox)` → `select(mode)`. Mode is resolved by stripping the
 * activator then matching `modifiers` — reproducing the legacy
 * `BoxSelectControl` behavior exactly. Mutually exclusive with `lassoSelect`
 * (enforced in HandlerManager — a later task).
 */
export class BoxSelectHandler extends EventDispatcher implements Handler<BoxSelectHandlerOptions> {
  readonly name = 'boxSelect';
  private _enabled = false;
  private _opts: BoxSelectHandlerOptions = {};
  private _start: { x: number; y: number } | null = null;
  private _overlay: HTMLDivElement | null = null;
  /** Set by HandlerManager.register. */
  _manager?: { isEnabledByName(name: string): boolean };

  constructor(private _map: Emap) { super(); }

  enable(): void {
    if (this._manager?.isEnabledByName('lassoSelect')) {
      throw new Error('cannot enable boxSelect: lassoSelect is enabled (both consume shift+drag); disable it first');
    }
    this._enabled = true;
  }
  disable(): void {
    this._enabled = false;
    if (this._start) this._cancel();
  }
  isEnabled(): boolean { return this._enabled; }
  setOptions(opts: Partial<BoxSelectHandlerOptions>): void { this._opts = { ...this._opts, ...opts }; }
  getOptions(): Readonly<BoxSelectHandlerOptions> { return this._opts; }

  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }

  private get _threshold(): number { return this._opts.dragThreshold ?? 4; }
  private get _activator(): ModifierCombo { return this._opts.dragActivator ?? 'shift'; }

  private _ensureOverlay(): HTMLDivElement {
    if (this._overlay) return this._overlay;
    const o = document.createElement('div');
    o.className = 'emap-box-select';
    o.style.position = 'absolute';
    o.style.pointerEvents = 'none';
    o.style.display = 'none';
    o.style.boxSizing = 'border-box';
    const s = this._opts.style ?? {};
    o.style.border = `${s.strokeWidth ?? 1.5}px solid ${s.stroke ?? '#0078ff'}`;
    o.style.background = s.fill ?? 'rgba(0, 120, 255, 0.1)';
    this._map.getCanvasContainer().appendChild(o);
    this._overlay = o;
    return o;
  }

  private _cancel(): void {
    if (this._overlay) this._overlay.style.display = 'none';
    this._start = null;
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';

    if (ev.kind === 'down') {
      if (ev.button !== 0 || !comboHeld(ev.modifiers, this._activator)) return 'passthrough';
      this._start = { x: ev.point.x, y: ev.point.y };
      const o = this._ensureOverlay();
      o.style.left = `${ev.point.x}px`;
      o.style.top = `${ev.point.y}px`;
      o.style.width = '0';
      o.style.height = '0';
      o.style.display = 'block';
      return 'exclusive';
    }

    if (ev.kind === 'move' && this._start) {
      const o = this._ensureOverlay();
      const left = Math.min(this._start.x, ev.point.x);
      const top = Math.min(this._start.y, ev.point.y);
      o.style.left = `${left}px`;
      o.style.top = `${top}px`;
      o.style.width = `${Math.abs(ev.point.x - this._start.x)}px`;
      o.style.height = `${Math.abs(ev.point.y - this._start.y)}px`;
      return 'exclusive';
    }

    if (ev.kind === 'up' && this._start) {
      const s = this._start;
      const { x: cx, y: cy } = ev.point;
      this._cancel();
      if (Math.hypot(cx - s.x, cy - s.y) < this._threshold) return 'passthrough';
      const x1 = Math.min(s.x, cx), y1 = Math.min(s.y, cy);
      const x2 = Math.max(s.x, cx), y2 = Math.max(s.y, cy);
      const hits = this._map.queryFeatures(
        [[x1, y1], [x2, y2]],
        this._opts.layers ? { layers: this._opts.layers } : undefined,
      );
      const mode = resolveMode(ev.modifiers, this._opts.modifiers ?? BOX_DEFAULT_MODS, this._activator);
      this._map.select(dedupeRefs(hits), { mode });
      return 'passthrough';
    }

    return 'passthrough';
  }
}

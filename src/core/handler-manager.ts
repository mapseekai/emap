import { type Handler, isHandler, type NormalizedPointerEvent } from './handler';

// Highest → lowest. Only registered+enabled handlers participate. The
// selection handlers (Phase 2b) slot in ahead of dragPan.
const PRIORITY = ['lassoSelect', 'boxSelect', 'clickSelect', 'dragPan'] as const;

/**
 * Registry of named interaction handlers owned by Emap. Owns the
 * single-DOM-listener pointer arbitration layer: installs one set of pointer
 * listeners, normalizes events, and dispatches to enabled handlers in fixed
 * priority order with an exclusive-gesture lock.
 */
export class HandlerManager {
  private _handlers = new Map<string, Handler>();
  private _element: HTMLElement | null = null;
  private _exclusive: Handler | null = null;
  private _pointerSink: ((ev: NormalizedPointerEvent) => void) | null = null;
  private _onDown = (e: PointerEvent) => this._dispatch(this._norm(e, 'down'));
  private _onMove = (e: PointerEvent) => this._dispatch(this._norm(e, 'move'));
  private _onUp = (e: PointerEvent) => this._dispatch(this._norm(e, 'up'));
  private _onClick = (e: MouseEvent) => this._dispatch(this._norm(e, 'click'));
  private _onContextMenu = (e: MouseEvent) => this._dispatch(this._norm(e, 'contextmenu'));

  /** Register a handler; re-registering the same `name` replaces the prior one. */
  register(handler: Handler): void {
    if (!isHandler(handler)) {
      throw new Error(`HandlerManager.register: argument is not a valid Handler`);
    }
    this._handlers.set(handler.name, handler);
    (handler as unknown as { _manager?: HandlerManager })._manager = this;
  }

  /** Is a sibling handler currently registered AND enabled? */
  isEnabledByName(name: string): boolean {
    const h = this._handlers.get(name);
    return !!h && h.isEnabled();
  }

  get(name: string): Handler | undefined {
    return this._handlers.get(name);
  }

  /** Legacy `interactive` shim: toggles the pan + zoom handlers together. */
  applyInteractive(interactive: boolean): void {
    for (const n of ['dragPan', 'scrollZoom']) {
      const h = this._handlers.get(n);
      if (!h) continue;
      if (interactive) h.enable();
      else h.disable();
    }
  }

  /** Install the single pointer-listener set + start arbitrating. */
  attach(element: HTMLElement): void {
    this.detach();
    this._element = element;
    element.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    element.addEventListener('click', this._onClick);
    element.addEventListener('contextmenu', this._onContextMenu);
  }

  /** Remove all listeners and clear any active exclusive gesture. */
  detach(): void {
    if (!this._element) return;
    this._element.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this._element.removeEventListener('click', this._onClick);
    this._element.removeEventListener('contextmenu', this._onContextMenu);
    this._element = null;
    this._exclusive = null;
    this._pointerSink = null;
  }

  /** Install (or clear with `null`) a passive observer fed click + non-gesture move. */
  setPointerSink(sink: ((ev: NormalizedPointerEvent) => void) | null): void {
    this._pointerSink = sink;
  }

  private _norm(e: PointerEvent | MouseEvent, kind: NormalizedPointerEvent['kind']): NormalizedPointerEvent {
    const r = (this._element as HTMLElement).getBoundingClientRect();
    return {
      kind,
      point: { x: e.clientX - r.left, y: e.clientY - r.top },
      modifiers: { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey },
      button: 'button' in e ? e.button : 0,
      originalEvent: e,
    };
  }

  private _orderedEnabled(): Handler[] {
    const out: Handler[] = [];
    for (const name of PRIORITY) {
      const h = this._handlers.get(name);
      if (h && h.isEnabled()) out.push(h);
    }
    return out;
  }

  private _dispatch(ev: NormalizedPointerEvent): void {
    if (this._pointerSink) {
      if (ev.kind === 'click' || (ev.kind === 'move' && !this._exclusive)) {
        this._pointerSink(ev);
      }
    }
    if (this._exclusive && (ev.kind === 'move' || ev.kind === 'up')) {
      const r = this._exclusive.handlePointer(ev);
      if (r !== 'exclusive') this._exclusive = null;
      return;
    }
    for (const h of this._orderedEnabled()) {
      const r = h.handlePointer(ev);
      if (r === 'exclusive') { this._exclusive = h; return; }
      if (r === 'consumed') return;
    }
  }
}

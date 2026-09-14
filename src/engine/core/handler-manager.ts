import { type Handler, isHandler, type NormalizedPointerEvent } from './handler';

export interface HandlerRegistration {
  priority?: number;
  before?: readonly string[];
  after?: readonly string[];
  group?: string;
}

interface RegisteredHandler {
  options: HandlerRegistration;
  sequence: number;
}

/**
 * Registry of named interaction handlers owned by Emap. Owns the
 * single-DOM-listener pointer arbitration layer: installs one set of pointer
 * listeners, normalizes events, and dispatches to enabled handlers in configured
 * priority order with an exclusive-gesture lock.
 */
export class HandlerManager {
  private _handlers = new Map<string, Handler>();
  private _registrations = new Map<string, RegisteredHandler>();
  private _order: string[] = [];
  private _sequence = 0;
  private _element: HTMLElement | null = null;
  private _exclusive: Handler | null = null;
  private _pointerSink: ((ev: NormalizedPointerEvent) => void) | null = null;
  private _suppressNextClick = false;
  private _exclusiveGestureMoved = false;
  private _onDown = (e: PointerEvent) => {
    this._suppressNextClick = false;
    this._exclusiveGestureMoved = false;
    this._dispatch(this._norm(e, 'down'));
  };
  private _onMove = (e: PointerEvent) => this._dispatch(this._norm(e, 'move'));
  private _onUp = (e: PointerEvent) => this._dispatch(this._norm(e, 'up'));
  private _onClick = (e: MouseEvent) => this._dispatch(this._norm(e, 'click'));
  private _onContextMenu = (e: MouseEvent) => this._dispatch(this._norm(e, 'contextmenu'));
  private _onDblClick = (e: MouseEvent) => this._dispatch(this._norm(e, 'dblclick'));

  /** Register a handler with configuration-time ordering and owner-safe removal. */
  register(handler: Handler, options: HandlerRegistration = {}): () => void {
    if (!isHandler(handler))
      throw new Error('HandlerManager.register: argument is not a valid Handler');
    const priority = options.priority ?? 0;
    if (!Number.isFinite(priority)) throw new Error('Handler priority must be finite');
    const record = {
      options: {
        ...options,
        priority,
        before: [...(options.before ?? [])],
        after: [...(options.after ?? [])],
      },
      sequence: this._sequence++,
    };
    const next = new Map(this._registrations);
    next.set(handler.name, record);
    const order = this._resolveOrder(next);
    const previous = this._handlers.get(handler.name);
    if (previous && previous !== handler) this._release(previous);
    this._registrations = next;
    this._order = order;
    this._handlers.set(handler.name, handler);
    (handler as unknown as { _manager?: HandlerManager })._manager = this;
    this.refreshCursor();
    return () => {
      if (this._registrations.get(handler.name) === record) this.unregister(handler.name);
    };
  }

  unregister(name: string): void {
    const handler = this._handlers.get(name);
    if (!handler) return;
    try {
      this._release(handler);
    } finally {
      this._handlers.delete(name);
      this._registrations.delete(name);
      this._order = this._resolveOrder(this._registrations);
      this.refreshCursor();
    }
  }

  private _release(handler: Handler): void {
    try {
      handler.disable();
    } finally {
      if (this._exclusive === handler) {
        this._exclusive = null;
        this._exclusiveGestureMoved = false;
        this._suppressNextClick = true;
      }
      const owned = handler as unknown as { _manager?: HandlerManager };
      if (owned._manager === this) delete owned._manager;
    }
  }

  private _resolveOrder(registrations: ReadonlyMap<string, RegisteredHandler>): string[] {
    const incoming = new Map([...registrations.keys()].map((name) => [name, 0]));
    const edges = new Map([...registrations.keys()].map((name) => [name, new Set<string>()]));
    const edge = (from: string, to: string): void => {
      if (!registrations.has(from) || !registrations.has(to) || edges.get(from)!.has(to)) return;
      edges.get(from)!.add(to);
      incoming.set(to, incoming.get(to)! + 1);
    };
    for (const [name, { options }] of registrations) {
      for (const other of options.before ?? []) edge(name, other);
      for (const other of options.after ?? []) edge(other, name);
    }
    const compare = (a: string, b: string) =>
      (registrations.get(b)!.options.priority ?? 0) -
        (registrations.get(a)!.options.priority ?? 0) ||
      registrations.get(a)!.sequence - registrations.get(b)!.sequence;
    const ready = [...incoming]
      .filter(([, count]) => count === 0)
      .map(([name]) => name)
      .sort(compare);
    const result: string[] = [];
    while (ready.length) {
      const name = ready.shift()!;
      result.push(name);
      for (const next of edges.get(name)!) {
        incoming.set(next, incoming.get(next)! - 1);
        if (incoming.get(next) === 0) {
          ready.push(next);
          ready.sort(compare);
        }
      }
    }
    if (result.length !== registrations.size) throw new Error('Handler ordering cycle');
    return result;
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
    for (const [name, { options }] of this._registrations) {
      if (options.group !== 'navigation') continue;
      const handler = this._handlers.get(name)!;
      if (interactive) handler.enable();
      else handler.disable();
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
    element.addEventListener('dblclick', this._onDblClick);
  }

  /** Remove all listeners and clear any active exclusive gesture. */
  detach(): void {
    if (!this._element) return;
    this._element.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this._element.removeEventListener('click', this._onClick);
    this._element.removeEventListener('contextmenu', this._onContextMenu);
    this._element.removeEventListener('dblclick', this._onDblClick);
    this._element.style.cursor = '';
    this._element = null;
    this._exclusive = null;
    this._pointerSink = null;
    this._suppressNextClick = false;
    this._exclusiveGestureMoved = false;
  }

  /** Install (or clear with `null`) a passive observer fed click + non-gesture move. */
  setPointerSink(sink: ((ev: NormalizedPointerEvent) => void) | null): void {
    this._pointerSink = sink;
  }

  private _norm(
    e: PointerEvent | MouseEvent,
    kind: NormalizedPointerEvent['kind'],
  ): NormalizedPointerEvent {
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
    for (const name of this._order) {
      const h = this._handlers.get(name);
      if (h && h.isEnabled()) out.push(h);
    }
    return out;
  }

  private _dispatch(ev: NormalizedPointerEvent): void {
    const hadExclusive = this._exclusive !== null;
    if (ev.kind === 'move' && !hadExclusive) this._suppressNextClick = false;
    this._dispatchInner(ev);
    this._applyCursor();
  }

  private _dispatchInner(ev: NormalizedPointerEvent): void {
    if (ev.kind === 'click' && this._suppressNextClick) {
      this._suppressNextClick = false;
      return;
    }

    if (this._pointerSink) {
      if (ev.kind === 'click' || (ev.kind === 'move' && !this._exclusive)) {
        this._pointerSink(ev);
      }
    }
    if (this._exclusive && (ev.kind === 'move' || ev.kind === 'up')) {
      if (ev.kind === 'move') this._exclusiveGestureMoved = true;
      const r = this._exclusive.handlePointer(ev);
      if (this._exclusiveGestureMoved && (ev.kind === 'up' || r !== 'exclusive')) {
        this._suppressNextClick = true;
        this._exclusiveGestureMoved = false;
      }
      if (r !== 'exclusive') this._exclusive = null;
      return;
    }
    for (const h of this._orderedEnabled()) {
      const r = h.handlePointer(ev);
      if (r === 'exclusive') {
        this._exclusive = h;
        return;
      }
      if (r === 'consumed') return;
    }
  }

  /**
   * Resolve the effective cursor and write it to the attached element.
   * Order: active exclusive handler's cursor → first enabled handler in
   * configured order with a non-empty cursor → '' (clear → CSS/page default).
   * Idempotent: only writes when the value changes.
   */
  private _applyCursor(): void {
    if (!this._element) return;
    let next: string | null = null;
    const ex = this._exclusive;
    if (ex && ex.isEnabled()) {
      next = ex.getCursor?.() ?? null;
    }
    if (!next) {
      for (const h of this._orderedEnabled()) {
        const c = h.getCursor?.();
        if (c) {
          next = c;
          break;
        }
      }
    }
    const value = next ?? '';
    if (this._element.style.cursor !== value) {
      this._element.style.cursor = value;
    }
  }

  /**
   * Recompute the effective cursor. Call after a handler changes
   * cursor-relevant state OUTSIDE a pointer event (e.g. enable()/disable()
   * flipping a mode). No-op when not attached.
   */
  refreshCursor(): void {
    this._applyCursor();
  }
}

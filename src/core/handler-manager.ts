import { type Handler, isHandler } from './handler';

/**
 * Registry of named interaction handlers owned by Emap. Phase 1 holds the
 * registry and maps the legacy `interactive` option onto handlers. The
 * single-DOM-listener arbitration layer (priority + exclusive gestures)
 * arrives in Phase 2 when selection handlers need it.
 */
export class HandlerManager {
  private _handlers = new Map<string, Handler>();

  /** Register a handler; re-registering the same `name` replaces the prior one. */
  register(handler: Handler): void {
    if (!isHandler(handler)) {
      throw new Error(`HandlerManager.register: argument is not a valid Handler`);
    }
    this._handlers.set(handler.name, handler);
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
}

import type { NormalizedPointerEvent } from './handler';

export interface PointerMoveEvent {
  /** Element-local pixel coords (= the normalized event's `point`). */
  point: { x: number; y: number };
  /** `host.unproject(point.x, point.y)` — source-data coordinates. */
  mapCoord: [number, number];
  /** The DOM event that produced this (typed `Event`; a PointerEvent at runtime). */
  originalEvent: Event;
}

type Cb = (e: PointerMoveEvent) => void;

/** Minimal surface the dispatcher needs from Emap (keeps it unit-testable). */
export interface PointerEventMapHost {
  unproject(x: number, y: number): [number, number];
}


/**
 * Delegated pointer-move event registry. Fed normalized pointer events by
 * `HandlerManager`'s sink (non-gesture move) via `Emap._syncPointerSink`.
 * Move-only by design (P8 §17.3) — `click` is covered by P3
 * `feature:click`; `down`/`up`/`wheel`/`dblclick`/`contextmenu` have no
 * consumer. No hit-test, no filter (it is not feature-scoped).
 */
export class PointerEventDispatcher {
  private _cbs: Cb[] = [];
  /** Maps user cb → its once-wrapper so `off(type, userCb)` resolves the wrap. */
  private _onceWrap = new Map<Cb, Cb>();
  private _onChange?: () => void;

  constructor(private _host: PointerEventMapHost) {}

  /** Install a callback invoked whenever the registry changes (drives sink install/teardown). */
  setOnChange(fn: () => void): void {
    this._onChange = fn;
  }

  hasListeners(): boolean {
    return this._cbs.length > 0;
  }

  on(type: string, cb: Cb): void {
    if (type !== 'mousemove') return;
    this._cbs.push(cb);
    this._onChange?.();
  }

  once(type: string, cb: Cb): void {
    if (type !== 'mousemove') return;
    const wrap: Cb = (e) => {
      this.off(type, cb);
      cb(e);
      // onChange already fired inside off(); no second call needed.
    };
    this._onceWrap.set(cb, wrap);
    this._cbs.push(wrap);
    this._onChange?.();
  }

  off(type: string, cb: Cb): void {
    if (type !== 'mousemove') return;
    const wrap = this._onceWrap.get(cb);
    this._cbs = this._cbs.filter((c) => c !== cb && (wrap === undefined || c !== wrap));
    this._onceWrap.delete(cb);
    this._onChange?.();
  }

  dispatch(ev: NormalizedPointerEvent): void {
    if (!this.hasListeners()) return;
    if (ev.kind !== 'move') return;
    const entries = this._cbs;
    const e: PointerMoveEvent = {
      point: { x: ev.point.x, y: ev.point.y },
      mapCoord: this._host.unproject(ev.point.x, ev.point.y),
      originalEvent: ev.originalEvent,
    };
    for (const cb of entries.slice()) cb(e);
  }
}

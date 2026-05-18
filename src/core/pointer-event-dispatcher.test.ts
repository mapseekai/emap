// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PointerEventDispatcher } from './pointer-event-dispatcher';
import type { NormalizedPointerEvent } from './handler';

function ev(
  kind: NormalizedPointerEvent['kind'],
  x: number,
  y: number,
): NormalizedPointerEvent {
  return {
    kind,
    point: { x, y },
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    button: 0,
    originalEvent: new Event(kind),
  };
}

function stubHost() {
  return { unproject: (x: number, y: number) => [x / 10, y / 10] as [number, number] };
}

describe('PointerEventDispatcher', () => {
  it('hasListeners() false until a mousemove listener is added, true after, false after off', () => {
    const d = new PointerEventDispatcher(stubHost());
    expect(d.hasListeners()).toBe(false);
    const cb = vi.fn();
    d.on('mousemove', cb);
    expect(d.hasListeners()).toBe(true);
    d.off('mousemove', cb);
    expect(d.hasListeners()).toBe(false);
  });

  it('dispatch(move) emits one PointerMoveEvent with mapCoord = host.unproject(point) and point = ev.point', () => {
    const d = new PointerEventDispatcher(stubHost());
    const cb = vi.fn();
    d.on('mousemove', cb);
    const e0 = ev('move', 30, 40);
    d.dispatch(e0);
    expect(cb).toHaveBeenCalledTimes(1);
    const e = cb.mock.calls[0][0];
    expect(e.point).toEqual({ x: 30, y: 40 });
    expect(e.mapCoord).toEqual([3, 4]);
    expect(e.originalEvent).toBe(e0.originalEvent);
  });

  it('dispatch ignores non-move kinds (click/down/up/wheel/dblclick/contextmenu)', () => {
    const d = new PointerEventDispatcher(stubHost());
    const cb = vi.fn();
    d.on('mousemove', cb);
    for (const k of ['click', 'down', 'up', 'wheel', 'dblclick', 'contextmenu'] as const) {
      d.dispatch(ev(k, 1, 1));
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it('dispatch is a no-op when there are no listeners (host.unproject untouched)', () => {
    const host = stubHost();
    const unprojectSpy = vi.spyOn(host, 'unproject');
    const d = new PointerEventDispatcher(host);
    expect(() => d.dispatch(ev('move', 5, 5))).not.toThrow();
    expect(unprojectSpy).not.toHaveBeenCalled();
  });

  it('once fires exactly once then auto-removes; cancellable via off(type, cb)', () => {
    const d = new PointerEventDispatcher(stubHost());
    const once = vi.fn();
    d.once('mousemove', once);
    d.dispatch(ev('move', 10, 10));
    d.dispatch(ev('move', 20, 20));
    expect(once).toHaveBeenCalledTimes(1);
    expect(d.hasListeners()).toBe(false);
    const c2 = vi.fn();
    d.once('mousemove', c2);
    d.off('mousemove', c2);
    d.dispatch(ev('move', 1, 1));
    expect(c2).not.toHaveBeenCalled();
  });

  it('setOnChange fires on every on/once/off', () => {
    const d = new PointerEventDispatcher(stubHost());
    const onChange = vi.fn();
    d.setOnChange(onChange);
    const cb = vi.fn();
    d.on('mousemove', cb);
    d.off('mousemove', cb);
    d.once('mousemove', vi.fn());
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('a second move emits again (not deduped — unlike feature enter/leave)', () => {
    const d = new PointerEventDispatcher(stubHost());
    const cb = vi.fn();
    d.on('mousemove', cb);
    d.dispatch(ev('move', 1, 1));
    d.dispatch(ev('move', 1, 1));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

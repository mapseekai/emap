// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { StatusControl } from './status-control';

/** Minimal Emap stub: on/off registry + getCRS (the exact surface the
 * thin-shell StatusControl now consumes — no raw canvas access). */
function stubMap() {
  const listeners: Record<string, Function[]> = {};
  return {
    on: vi.fn((type: string, cb: Function) => {
      (listeners[type] ??= []).push(cb);
    }),
    off: vi.fn((type: string, cb: Function) => {
      listeners[type] = (listeners[type] ?? []).filter((c) => c !== cb);
    }),
    getCRS: () => 'EPSG:4326',
    _emit: (type: string, e: unknown) => (listeners[type] ?? []).forEach((c) => c(e)),
    _count: (type: string) => (listeners[type] ?? []).length,
  };
}

describe('StatusControl (thin-shell over map.on(mousemove))', () => {
  it('onAdd subscribes map.on(mousemove); does NOT add a raw canvas listener', () => {
    const map = stubMap();
    const ctrl = new StatusControl({ showMousePos: true, showEPSG: false });
    ctrl.onAdd(map as any);
    expect(map.on).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(map._count('mousemove')).toBe(1);
  });

  it('onAdd does NOT subscribe mousemove when showMousePos is false (zero-cost guarantee)', () => {
    const map = stubMap();
    const ctrl = new StatusControl({ showMousePos: false, showEPSG: false });
    ctrl.onAdd(map as any);
    expect(map._count('mousemove')).toBe(0);
    expect(map.on).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
  });

  it('a PointerMoveEvent updates the mouse-position text from e.mapCoord (after rAF)', async () => {
    const map = stubMap();
    const ctrl = new StatusControl({ showMousePos: true, showEPSG: false });
    const el = ctrl.onAdd(map as any);
    map._emit('mousemove', {
      point: { x: 0, y: 0 },
      mapCoord: [12.3456789, -7.654321],
      originalEvent: new Event('pointermove'),
    });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const posEl = el.querySelector('.emap-status-mousepos') as HTMLElement;
    expect(posEl.textContent).toBe(' 12.3457, -7.6543');
  });

  it('onRemove calls map.off(mousemove) with the same bound listener', () => {
    const map = stubMap();
    const ctrl = new StatusControl({ showMousePos: true, showEPSG: false });
    ctrl.onAdd(map as any);
    ctrl.onRemove();
    expect(map.off).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(map._count('mousemove')).toBe(0);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { BoxSelectHandler } from './box-select';
import type { NormalizedPointerEvent } from '../handler';

function ev(kind: NormalizedPointerEvent['kind'], x: number, y: number, shift = false, alt = false): NormalizedPointerEvent {
  return {
    kind, point: { x, y },
    modifiers: { shift, ctrl: false, alt, meta: false },
    button: 0, originalEvent: new MouseEvent('pointerdown'),
  };
}

function fakeMap() {
  const c = document.createElement('div');
  return {
    _c: c,
    getCanvasContainer: () => c,
    queryFeatures: vi.fn(() => [{ source: 's', layer: 'l', id: 7 }]),
    select: vi.fn(),
  };
}

describe('BoxSelectHandler', () => {
  it('name + disabled-by-default; shift+down while disabled is passthrough', () => {
    const h = new BoxSelectHandler(fakeMap() as any);
    expect(h.name).toBe('boxSelect');
    expect(h.isEnabled()).toBe(false);
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('passthrough');
  });

  it('without activator (no shift) down → passthrough (lets dragPan have it)', () => {
    const h = new BoxSelectHandler(fakeMap() as any);
    h.enable();
    expect(h.handlePointer(ev('down', 0, 0, false))).toBe('passthrough');
  });

  it('shift+down → exclusive; move tracks; up past threshold → query+select(replace)', () => {
    const map = fakeMap();
    const h = new BoxSelectHandler(map as any);
    h.enable();
    expect(h.handlePointer(ev('down', 10, 10, true))).toBe('exclusive');
    expect(h.handlePointer(ev('move', 60, 40, true))).toBe('exclusive');
    expect(h.handlePointer(ev('up', 60, 40, true))).toBe('passthrough');
    expect(map.queryFeatures).toHaveBeenCalledWith([[10, 10], [60, 40]], undefined);
    expect(map.select).toHaveBeenCalledWith([{ source: 's', layer: 'l', id: 7 }], { mode: 'replace' });
  });

  it('shift+alt drag → toggle mode (strip-activator default table)', () => {
    const map = fakeMap();
    const h = new BoxSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 0, 0, true, true));
    h.handlePointer(ev('move', 50, 50, true, true));
    h.handlePointer(ev('up', 50, 50, true, true));
    expect(map.select).toHaveBeenCalledWith(expect.anything(), { mode: 'toggle' });
  });

  it('below drag threshold → no select, passthrough (click can proceed)', () => {
    const map = fakeMap();
    const h = new BoxSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 10, 10, true));
    expect(h.handlePointer(ev('up', 11, 11, true))).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
  });

  it('disable() mid-drag cancels the gesture and hides overlay', () => {
    const map = fakeMap();
    const h = new BoxSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 10, 10, true));
    h.disable();
    expect(h.handlePointer(ev('up', 99, 99, true))).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
  });
});

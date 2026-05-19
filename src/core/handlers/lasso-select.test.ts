// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { LassoSelectHandler } from './lasso-select';
import type { NormalizedPointerEvent } from '../handler';
import * as geom from './select-geometry';

function ev(kind: NormalizedPointerEvent['kind'], x: number, y: number, shift = false): NormalizedPointerEvent {
  return {
    kind, point: { x, y },
    modifiers: { shift, ctrl: false, alt: false, meta: false },
    button: 0, originalEvent: new MouseEvent('pointerdown'),
  };
}
function fakeMap() {
  const c = document.createElement('div');
  return {
    getCanvasContainer: () => c,
    queryFeatures: vi.fn(() => [{ source: 's', layer: 'l', id: 1 }]),
    select: vi.fn(),
  };
}

describe('LassoSelectHandler', () => {
  it('name + disabled-by-default; shift+down disabled → passthrough', () => {
    const h = new LassoSelectHandler(fakeMap() as any);
    expect(h.name).toBe('lassoSelect');
    expect(h.isEnabled()).toBe(false);
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('passthrough');
  });

  it('shift+down → exclusive; multi-move builds path; up → bbox query + polygon refine + select', () => {
    const map = fakeMap();
    const spy = vi.spyOn(geom, 'featureMatchesLasso').mockReturnValue(true);
    const h = new LassoSelectHandler(map as any);
    h.enable();
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('exclusive');
    expect(h.handlePointer(ev('move', 0, 40, true))).toBe('exclusive');
    expect(h.handlePointer(ev('move', 40, 40, true))).toBe('exclusive');
    expect(h.handlePointer(ev('up', 40, 0, true))).toBe('passthrough');
    expect(map.queryFeatures).toHaveBeenCalledWith([[0, 0], [40, 40]], undefined);
    expect(map.select).toHaveBeenCalledWith([{ source: 's', layer: 'l', id: 1 }], { mode: 'replace' });
    spy.mockRestore();
  });

  it('path shorter than 3 points → no select, passthrough', () => {
    const map = fakeMap();
    const h = new LassoSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 5, 5, true));
    expect(h.handlePointer(ev('up', 6, 6, true))).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
  });

  it('disable() mid-lasso cancels', () => {
    const map = fakeMap();
    const h = new LassoSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 0, 0, true));
    h.handlePointer(ev('move', 0, 40, true));
    h.disable();
    expect(h.handlePointer(ev('up', 40, 40, true))).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
  });
});

describe('LassoSelectHandler stroke-dasharray (DX P2c)', () => {
  it('default strokeDasharray: polyline has "4 3"', () => {
    const map = fakeMap();
    const h = new LassoSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 0, 0, true));
    const container = map.getCanvasContainer();
    const poly = container.querySelector('polyline');
    expect(poly).not.toBeNull();
    expect(poly?.getAttribute('stroke-dasharray')).toBe('4 3');
  });

  it('custom strokeDasharray via setOptions: polyline uses custom value', () => {
    const map = fakeMap();
    const h = new LassoSelectHandler(map as any);
    h.setOptions({ style: { strokeDasharray: '8 2' } });
    h.enable();
    h.handlePointer(ev('down', 0, 0, true));
    const container = map.getCanvasContainer();
    const poly = container.querySelector('polyline');
    expect(poly).not.toBeNull();
    expect(poly?.getAttribute('stroke-dasharray')).toBe('8 2');
  });
});

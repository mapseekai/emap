// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Emap } from './map';

// jsdom does not implement CanvasRenderingContext2D; stub getContext so
// CanvasPainter construction succeeds.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({
    scale: () => {}, clearRect: () => {}, fillRect: () => {},
    strokeRect: () => {}, beginPath: () => {}, moveTo: () => {},
    lineTo: () => {}, stroke: () => {}, fill: () => {},
    arc: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, setTransform: () => {}, drawImage: () => {},
    measureText: () => ({ width: 0 }),
  } as any);
});

function container(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  document.body.appendChild(el);
  return el;
}

describe('Emap handler registry (Phase 1)', () => {
  it('exposes dragPan and scrollZoom handlers, enabled by default', () => {
    const map = new Emap({ container: container() });
    expect(map.dragPan.name).toBe('dragPan');
    expect(map.scrollZoom.name).toBe('scrollZoom');
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.scrollZoom.isEnabled()).toBe(true);
  });

  it('interactive:false disables both handlers (legacy behavior preserved)', () => {
    const map = new Emap({ container: container(), interactive: false });
    expect(map.dragPan.isEnabled()).toBe(false);
    expect(map.scrollZoom.isEnabled()).toBe(false);
  });

  it('map.scrollZoom.disable() leaves dragPan enabled (selective toggle)', () => {
    const map = new Emap({ container: container() });
    map.scrollZoom.disable();
    expect(map.scrollZoom.isEnabled()).toBe(false);
    expect(map.dragPan.isEnabled()).toBe(true);
  });

  it('dragging the canvas pans the viewport through the arbiter', () => {
    const el = container();
    const map = new Emap({ container: el });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    const before = map.getCenter();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 100, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 100, button: 0 }));
    const after = map.getCenter();
    expect(after[0]).not.toBe(before[0]); // longitude changed → pan happened
  });

  it('exposes disabled-by-default selection handlers', () => {
    const map = new Emap({ container: container() });
    expect(map.clickSelect.name).toBe('clickSelect');
    expect(map.boxSelect.name).toBe('boxSelect');
    expect(map.lassoSelect.name).toBe('lassoSelect');
    expect(map.clickSelect.isEnabled()).toBe(false);
    expect(map.boxSelect.isEnabled()).toBe(false);
    expect(map.lassoSelect.isEnabled()).toBe(false);
  });

  it('shift+drag with boxSelect enabled selects via the arbiter (not pan)', () => {
    const el = container();
    const map = new Emap({ container: el });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    map.boxSelect.enable();
    const before = map.getCenter();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, shiftKey: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 200, button: 0, shiftKey: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 200, button: 0, shiftKey: true }));
    expect(map.getCenter()[0]).toBe(before[0]);
  });

  it('map.on("feature:click", filter, cb) fires for the hit feature via the arbiter', () => {
    const map = new Emap({ container: container() });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    const hit = { source: 's', layer: 'l', id: 1 };
    (map as any).queryFeatures = () => [hit];
    (map as any).features = { get: (r: any) => ({ ref: r, geometry: null, properties: Object.freeze({}) }) };
    const cb = vi.fn();
    map.on('feature:click', { layers: ['l'] }, cb);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'feature:click', ref: hit });
  });

  it('non-feature map.on still works (super delegation unaffected)', () => {
    const map = new Emap({ container: container() });
    const cb = vi.fn();
    map.on('move', cb);
    map.fire('move', { foo: 1 });
    expect(cb).toHaveBeenCalled();
  });

  it('no feature:* listener ⇒ no pointer sink installed (zero cost)', () => {
    const map = new Emap({ container: container() });
    const hm = (map as any)._handlers;
    expect((hm as any)._pointerSink).toBeNull();
    const cb = () => {};
    map.on('feature:hover', cb);
    expect((hm as any)._pointerSink).not.toBeNull();
    map.off('feature:hover', cb);
    expect((hm as any)._pointerSink).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Emap } from './map';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () =>
    ({
      scale: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      setTransform: () => {},
      drawImage: () => {},
      measureText: () => ({ width: 0 }),
    }) as any;
});

function container(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  document.body.appendChild(el);
  return el;
}

describe('Emap camera facade (DX P9)', () => {
  it('exposes camera methods that return `this` and move the view', () => {
    const map = new Emap({ container: container() });
    expect(map.jumpTo({ center: [10, 20], scale: 3 })).toBe(map);
    const t = map.getTransform();
    const [px, py] = t.project(10, 20);
    expect(px).toBeCloseTo(400, 3);
    expect(py).toBeCloseTo(300, 3);
    expect(typeof map.easeTo).toBe('function');
    expect(typeof map.flyTo).toBe('function');
    expect(typeof map.fitBounds).toBe('function');
    expect(typeof map.panBy).toBe('function');
    expect(map.stop()).toBe(map);
  });

  it('jumpTo fires the movestart/move/moveend lifecycle', () => {
    const map = new Emap({ container: container() });
    const seen: string[] = [];
    for (const t of ['movestart', 'move', 'moveend']) map.on(t, () => seen.push(t));
    map.jumpTo({ center: [1, 2], scale: 2 });
    expect(seen).toEqual(expect.arrayContaining(['movestart', 'move', 'moveend']));
  });

  it('starting a drag stops a running camera animation', () => {
    const map = new Emap({ container: container() });
    const stop = vi.spyOn(map, 'stop');
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON() {},
    });
    // Start a real long animation, then prove the drag actually terminates it
    // (a dangling moveend would never fire if stop() were a no-op here).
    let ended = false;
    map.on('moveend', () => {
      ended = true;
    });
    map.easeTo({ center: [500, 500], scale: 4, duration: 5000 });
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }),
    );
    expect(stop).toHaveBeenCalled();
    expect(ended).toBe(true);
  });

  it('legacy view methods still work (back-compat)', () => {
    const map = new Emap({ container: container() });
    const c0 = map.getCenter();
    map.zoomIn();
    map.zoomOut();
    expect(map.getCenter()).toBeDefined();
    expect(typeof map.getZoom()).toBe('number');
    expect(Array.isArray(c0)).toBe(true);
  });
});

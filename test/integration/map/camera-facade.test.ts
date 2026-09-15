import { createBrowserTestMap } from '../../utils/plugin-test-map';
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Bounds } from '../../../src/domain/geo/bounds';
import { TopologySource } from '../../../src/domain/source/topology-source';
import { VertexMoveCommand } from '../../../src/domain/edit/commands/vertex-move';
const clearRect = vi.fn();
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () =>
    ({
      scale: () => {},
      clearRect,
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
  it('exposes camera methods that return `this` and move the view', async () => {
    const map = await createBrowserTestMap({ container: container() });
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
  it('jumpTo fires the movestart/move/moveend lifecycle', async () => {
    const map = await createBrowserTestMap({ container: container() });
    const seen: string[] = [];
    for (const t of ['movestart', 'move', 'moveend']) map.on(t, () => seen.push(t));
    map.jumpTo({ center: [1, 2], scale: 2 });
    expect(seen).toEqual(expect.arrayContaining(['movestart', 'move', 'moveend']));
  });
  it('starting a drag stops a running camera animation', async () => {
    const map = await createBrowserTestMap({ container: container() });
    const stop = vi.spyOn(map.ctx.view, 'stop');
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
  it('legacy view methods still work (back-compat)', async () => {
    const map = await createBrowserTestMap({ container: container() });
    const c0 = map.getCenter();
    map.zoomIn();
    map.zoomOut();
    expect(map.getCenter()).toBeDefined();
    expect(typeof map.getZoom()).toBe('number');
    expect(Array.isArray(c0)).toBe(true);
  });
  it('redraws the restored view when reset interrupts active navigation', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();
    const map = await createBrowserTestMap({ container: container() });
    try {
      map.setExtent(new Bounds(0, 0, 100, 100));
      while (callbacks.length) callbacks.shift()?.(0);
      const initialTransform = map.getTransform();
      Reflect.set(map, '_navSnapshotTransform', {
        mx: initialTransform.mx,
        my: initialTransform.my,
        bx: initialTransform.bx,
        by: initialTransform.by,
      });
      const viewport = Reflect.get(map, '_viewport') as {
        pan: (dx: number, dy: number) => void;
      };
      viewport.pan(80, 40);
      map.render();
      clearRect.mockClear();
      map.reset();
      while (callbacks.length) callbacks.shift()?.(0);
      expect(map.getTransform()).toEqual(initialTransform);
      expect(clearRect).toHaveBeenCalledTimes(1);
    } finally {
      await map.dispose();
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
  it('resets to the latest data extent after a vertex edit', async () => {
    const map = await createBrowserTestMap({ container: container() });
    const source = new TopologySource('edited');
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
          },
        },
      ],
    });
    try {
      await source.setData({
        filename: 'edited.geojson',
        content: Uint8Array.from(Array.from(geojson, (char) => char.charCodeAt(0))),
      });
      await map.addSource('edited', source);
      const initialExtent = source.getExtent();
      map.setExtent(initialExtent);
      const arcs = source.getDataset()?.arcs;
      if (!arcs) throw new Error('Expected polygon arcs');
      const vertexData = arcs.getVertexData();
      const vertexId = Array.from(vertexData.xx).findIndex((x) => x === initialExtent.xmax);
      if (vertexId < 0) throw new Error('Expected an eastern vertex');
      const from: [number, number] = [vertexData.xx[vertexId], vertexData.yy[vertexId]];
      new VertexMoveCommand({
        vertexIds: [vertexId],
        from,
        to: [30, from[1]],
        arcs,
        source,
      }).do();
      const editedExtent = source.getExtent();
      expect(editedExtent.xmax).toBe(30);
      map.reset();
      const [east] = map.project(editedExtent.xmax, editedExtent.centerY);
      expect(east).toBeGreaterThanOrEqual(0);
      expect(east).toBeLessThanOrEqual(800);
      const viewport = Reflect.get(map, '_viewport') as {
        getMapScale: () => number;
      };
      expect(viewport.getMapScale()).toBeCloseTo(1);
    } finally {
      await map.dispose();
    }
  });
});

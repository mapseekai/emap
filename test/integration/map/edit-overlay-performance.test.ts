import { EventDispatcher } from '../../../src/engine/core/events';
import { createBrowserTestMap } from '../../utils/plugin-test-map';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emap } from '../../../src/engine/map/map';
import { Bounds } from '../../../src/domain/geo/bounds';
import type { NormalizedPointerEvent } from '../../../src/engine/core/handler';
import type { RenderScheduler } from '../../../src/engine/rendering/render-scheduler';
import { TopologySource } from '../../../src/domain/source/topology-source';
import { getDefaultMapshaperAdapter } from '../../../src/integrations/mapshaper/adapter';
const contexts = new Map<HTMLCanvasElement, ReturnType<typeof makeContext>>();
function makeContext() {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn<(image: CanvasImageSource, ...coordinates: number[]) => void>(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    closePath: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 20 }),
  };
}
let map: Emap;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
function flushFrame() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}
function pointer(kind: NormalizedPointerEvent['kind'], x = 300, y = 250): NormalizedPointerEvent {
  return {
    kind,
    point: { x, y },
    button: 0,
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    originalEvent: new MouseEvent(kind),
  };
}
beforeEach(async () => {
  frames = new Map();
  frameId = 0;
  contexts.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  // jsdom supplies no native Canvas; this host fixture implements the exercised 2D surface.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement, kind: string) {
      if (kind !== '2d') return null;
      const context = makeContext();
      contexts.set(this, context);
      return context;
    },
  });
  const el = document.createElement('div');
  Object.defineProperties(el, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  document.body.appendChild(el);
  map = await createBrowserTestMap({ container: el });
  map.setExtent(new Bounds(-100, -60, 100, 60));
  flushFrame();
});
afterEach(async () => {
  await map.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function startTool(mode: 'measure' | 'draw' | 'reshape' | 'auto-complete') {
  if (mode === 'measure') {
    map.measure.enable();
    return map.measure;
  }
  if (mode === 'draw') {
    map.drawFeature.setOptions({ source: 'data', type: 'polygon' });
    map.drawFeature.enable();
    return map.drawFeature;
  }
  const tool = mode === 'reshape' ? map.reshapeFeature : map.autoCompletePolygon;
  tool.enable();
  return tool;
}
async function addRoad() {
  const source = new TopologySource('data');
  const arcs = getDefaultMapshaperAdapter().createArcCollection([
    { xx: new Float64Array([-20, 0, 20]), yy: new Float64Array([0, 20, 0]) },
  ]);
  source.setDataset(
    {
      arcs,
      info: { crs_string: 'EPSG:4326' },
      layers: [{ name: 'road', geometry_type: 'polyline', shapes: [[[0]]] }],
    },
    false,
  );
  await map.addSource('data', source);
  map.addLayer({ id: 'road', source: 'data', type: 'line' });
  map.setExtent(new Bounds(-100, -60, 100, 60));
  flushFrame();
  return source;
}
describe('temporary overlays with expensive map layers', () => {
  it('coalesces ordinary highlights and style changes on the overlay, then clears stale pixels', async () => {
    await addRoad();
    const [base, overlay] = [...contexts.values()];
    base.clearRect.mockClear();
    overlay.clearRect.mockClear();
    for (let i = 0; i < 20; i++)
      map.setHighlightedFeatures([{ source: 'data', layer: 'road', id: 0 }]);
    map.setHighlightStyle({ color: '#ff0000', width: 5 });
    flushFrame();
    expect(base.clearRect).not.toHaveBeenCalled();
    expect(overlay.clearRect).toHaveBeenCalledTimes(1);
    expect(overlay.lineTo).toHaveBeenCalled();
    expect(Reflect.get(overlay, 'strokeStyle')).toBe('#ff0000');
    overlay.clearRect.mockClear();
    overlay.lineTo.mockClear();
    map.clearHighlightedFeatures();
    flushFrame();
    expect(overlay.clearRect).toHaveBeenCalledTimes(1);
    expect(overlay.lineTo).not.toHaveBeenCalled();
    expect(base.clearRect).not.toHaveBeenCalled();
  });

  it('keeps vertex hover off the base canvas but invalidates live drag geometry and history', async () => {
    const source = await addRoad();
    map.vertexEdit.enable();
    flushFrame();
    const [base, overlay] = [...contexts.values()];
    const clear = vi.fn();
    Reflect.set(Reflect.get(map, '_painter'), 'clearGeometryCache', clear);
    base.clearRect.mockClear();
    overlay.arc.mockClear();
    const [x, y] = map.project(-20, 0);
    map.vertexEdit.handlePointer(pointer('move', x, y));
    flushFrame();
    expect(base.clearRect).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(overlay.arc).toHaveBeenCalled();
    map.render();
    flushFrame();
    expect(clear).not.toHaveBeenCalled();
    base.clearRect.mockClear();
    map.vertexEdit.handlePointer(pointer('down', x, y));
    map.vertexEdit.handlePointer(pointer('move', x - 40, y));
    flushFrame();
    expect(base.clearRect).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'data' }));
    expect(source.getArcs()!.getVertex2!(0)![0]).toBeCloseTo(map.unproject(x - 40, y)[0]);
    map.vertexEdit.handlePointer(pointer('up', x - 40, y));
    flushFrame();
    map.undo();
    flushFrame();
    expect(source.getArcs()!.getVertex2!(0)![0]).toBeCloseTo(-20);
    map.redo();
    flushFrame();
    expect(source.getArcs()!.getVertex2!(0)![0]).toBeCloseTo(map.unproject(x - 40, y)[0]);
    clear.mockClear();
    map.render();
    flushFrame();
    expect(clear).not.toHaveBeenCalled();
  });

  it('respects highlight masks and hidden layers and refreshes styles on a base invalidation', async () => {
    await addRoad();
    const [base, overlay] = [...contexts.values()];
    map.setHighlightedFeatures([{ source: 'data', layer: 'road', id: 0 }]);
    flushFrame();
    overlay.lineTo.mockClear();
    map.setFilter('road', ['==', 0, 1]);
    flushFrame();
    expect(overlay.lineTo).not.toHaveBeenCalled();
    map.setFilter('road', null);
    flushFrame();
    expect(overlay.lineTo).toHaveBeenCalled();
    overlay.lineTo.mockClear();
    map.setLayerVisibility('road', 'none');
    flushFrame();
    expect(overlay.lineTo).not.toHaveBeenCalled();
    map.setLayerVisibility('road', 'visible');
    flushFrame();
    expect(overlay.lineTo).toHaveBeenCalled();
    base.clearRect.mockClear();
    map.setPaintProperty('road', 'line-color', '#00ff00');
    flushFrame();
    expect(base.clearRect).toHaveBeenCalledTimes(1);
    const frame = base.drawImage.mock.lastCall?.[0];
    expect(frame).toBeInstanceOf(HTMLCanvasElement);
    if (!(frame instanceof HTMLCanvasElement)) throw new Error('No completed base frame');
    expect(Reflect.get(contexts.get(frame)!, 'strokeStyle')).toBe('#00ff00');
    overlay.lineTo.mockClear();
    map.removeSource('data');
    flushFrame();
    expect(overlay.lineTo).not.toHaveBeenCalled();
  });

  it('invalidates a source once when dragging multiple selected vertices through pointer events', async () => {
    const source = await addRoad();
    map.vertexEdit.enable();
    const [x, y] = map.project(-20, 0);
    const [middleX, middleY] = map.project(0, 20);
    const deltaX = map.unproject(x - 40, y)[0] - map.unproject(x, y)[0];
    map.vertexEdit.handlePointer(pointer('down', x - 20, middleY - 20));
    map.vertexEdit.handlePointer(pointer('move', middleX + 20, y + 20));
    map.vertexEdit.handlePointer(pointer('up', middleX + 20, y + 20));
    flushFrame();
    map.vertexEdit.handlePointer(pointer('move', x, y));
    flushFrame();
    expect(Reflect.get(map.vertexEdit, '_selectedNodes')).toEqual([
      expect.objectContaining({ coords: [-20, 0], vertexIds: [0] }),
      expect.objectContaining({ coords: [0, 20], vertexIds: [1] }),
    ]);
    const clear = vi.fn();
    Reflect.set(Reflect.get(map, '_painter'), 'clearGeometryCache', clear);
    const [base] = [...contexts.values()];
    base.clearRect.mockClear();
    map.vertexEdit.handlePointer(pointer('down', x, y));
    map.vertexEdit.handlePointer(pointer('move', x - 40, y));
    flushFrame();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'data' }));
    expect(base.clearRect).toHaveBeenCalledTimes(1);
    expect(source.getArcs()!.getVertex2!(0)![0]).toBeCloseTo(-20 + deltaX);
    expect(source.getArcs()!.getVertex2!(1)![0]).toBeCloseTo(deltaX);
    expect(source.getArcs()!.getVertex2!(2)![0]).toBeCloseTo(20);
    map.vertexEdit.handlePointer(pointer('up', x - 40, y));
    flushFrame();
    map.undo();
    flushFrame();
    expect(source.getArcs()!.getVertex2!(0)![0]).toBeCloseTo(-20);
    expect(source.getArcs()!.getVertex2!(1)![0]).toBeCloseTo(0);
  });

  it('keeps highlights aligned during fast navigation and resize and cancels removal work', async () => {
    await addRoad();
    map.vertexEdit.enable();
    const [vertexX, vertexY] = map.project(-20, 0);
    map.vertexEdit.handlePointer(pointer('move', vertexX, vertexY));
    map.setHighlightedFeatures([{ source: 'data', layer: 'road', id: 0 }]);
    flushFrame();
    const [base, overlay] = [...contexts.values()];
    const clear = vi.fn();
    Reflect.set(Reflect.get(map, '_painter'), 'clearGeometryCache', clear);
    const scheduler = Reflect.get(map, '_scheduler') as RenderScheduler;
    scheduler.recordFrame(100, {
      canvasWidth: 800,
      canvasHeight: 600,
      pixelRatio: window.devicePixelRatio || 1,
    });
    base.clearRect.mockClear();
    overlay.moveTo.mockClear();
    const zoom = map.scrollZoom;
    if (!(zoom instanceof EventDispatcher)) throw new Error('Expected scroll events');
    zoom.fire('mousewheel', { direction: 1, multiplier: 1, x: 400, y: 300 });
    flushFrame();
    expect(base.clearRect).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    const [x, y] = map.project(-20, 0);
    expect(overlay.moveTo).toHaveBeenCalledWith(expect.closeTo(x), expect.closeTo(y));
    map.resize();
    flushFrame();
    const [mainCanvas, overlayCanvas] = [...contexts.keys()];
    expect([overlayCanvas.width, overlayCanvas.height]).toEqual([
      mainCanvas.width,
      mainCanvas.height,
    ]);
    map.clearHighlightedFeatures();
    await map.dispose();
    overlay.clearRect.mockClear();
    flushFrame();
    expect(overlay.clearRect).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it.each([
    'measure',
    'draw',
    'reshape',
    'auto-complete',
  ] as const)('%s coalesces pointer previews without repainting the data canvas', (mode) => {
    const tool = startTool(mode);
    tool.handlePointer(pointer('click'));
    flushFrame();
    const base = contexts.get(map.getCanvasContainer().querySelector('canvas')!)!;
    base.clearRect.mockClear();
    const overlay = [...contexts.entries()].find(
      ([canvas]) => canvas !== map.getCanvasContainer().querySelector('canvas')!,
    )!;
    overlay[1].clearRect.mockClear();
    for (let i = 0; i < 20; i++) tool.handlePointer(pointer('move', 400 + i, 300));
    expect(base.clearRect).not.toHaveBeenCalled();
    flushFrame();
    expect(base.clearRect).not.toHaveBeenCalled();
    expect(overlay).toBeDefined();
    expect(overlay[1].clearRect).toHaveBeenCalledTimes(1);
    expect(overlay[1].lineTo).toHaveBeenCalled();
    expect(overlay[0].style.pointerEvents).toBe('none');
  });
  it.each([
    'measure',
    'draw',
  ] as const)('%s preserves fast navigation while updating previews', (mode) => {
    const tool = startTool(mode);
    tool.handlePointer(pointer('click'));
    flushFrame();
    const base = contexts.get(map.getCanvasContainer().querySelector('canvas')!)!;
    base.clearRect.mockClear();
    const scheduler = Reflect.get(map, '_scheduler') as RenderScheduler;
    scheduler.recordFrame(100, {
      canvasWidth: map.getCanvasContainer().querySelector('canvas')!.width,
      canvasHeight: map.getCanvasContainer().querySelector('canvas')!.height,
      pixelRatio: window.devicePixelRatio || 1,
    });
    // Exercise the actual wheel listener, including the tool's move subscription.
    const zoom = map.scrollZoom;
    if (!(zoom instanceof EventDispatcher)) throw new Error('Expected native scroll-zoom events');
    zoom.fire('mousewheel', { direction: 1, multiplier: 1, x: 400, y: 300 });
    flushFrame();
    expect(base.clearRect).not.toHaveBeenCalled();
    expect(map.getCanvasContainer().querySelector('canvas')!.style.transform).toContain('scale(');
    expect(scheduler.fastActive).toBe(true);
  });
  it('clears a removed preview without repainting data and cancels queued work on removal', async () => {
    const tool = startTool('draw');
    tool.handlePointer(pointer('click'));
    flushFrame();
    const [base, overlay] = [...contexts.values()];
    base.clearRect.mockClear();
    overlay.clearRect.mockClear();
    map.clearEditDrawState();
    flushFrame();
    expect(overlay.clearRect).toHaveBeenCalledTimes(1);
    expect(base.clearRect).not.toHaveBeenCalled();
    tool.handlePointer(pointer('move', 450, 350));
    await map.dispose();
    overlay.clearRect.mockClear();
    flushFrame();
    expect(overlay.clearRect).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it('keeps canvas sizes and preview coordinates aligned after resize', () => {
    const tool = startTool('draw');
    tool.handlePointer(pointer('click'));
    tool.handlePointer(pointer('move', 450, 350));
    flushFrame();
    map.resize();
    flushFrame();
    const canvases = [...contexts.keys()];
    expect(canvases[1].width).toBe(canvases[0].width);
    expect(canvases[1].height).toBe(canvases[0].height);
    expect(contexts.get(canvases[1])!.lineTo).toHaveBeenCalledWith(
      expect.closeTo(450),
      expect.closeTo(350),
    );
  });
});

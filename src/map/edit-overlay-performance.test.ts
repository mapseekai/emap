import {
  createTestMap,
  createBrowserTestMap,
  fixtureGet,
  fixtureSet,
  fixtureCall,
} from '../../test/utils/plugin-test-map';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emap } from './map';
import { Bounds } from '../geo/bounds';
import type { NormalizedPointerEvent } from '../core/handler';
import type { RenderScheduler } from '../renderer/render-scheduler';

const contexts = new Map<HTMLCanvasElement, ReturnType<typeof makeContext>>();
function makeContext() {
  return {
    clearRect: vi.fn(),
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

beforeEach(() => {
  frames = new Map();
  frameId = 0;
  contexts.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    const context = makeContext();
    contexts.set(this, context);
    return context as unknown as CanvasRenderingContext2D;
  });
  const el = document.createElement('div');
  Object.defineProperties(el, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  document.body.appendChild(el);
  map = createBrowserTestMap({ container: el });
  map.setExtent(new Bounds(-100, -60, 100, 60));
  flushFrame();
});

afterEach(() => {
  map.remove();
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

describe('temporary overlays with expensive map layers', () => {
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
    const zoom = map.scrollZoom as { fire: (type: string, event: object) => void };
    zoom.fire('mousewheel', { direction: 1, multiplier: 1, x: 400, y: 300 });
    flushFrame();
    expect(base.clearRect).not.toHaveBeenCalled();
    expect(map.getCanvasContainer().querySelector('canvas')!.style.transform).toContain('scale(');
    expect(scheduler.fastActive).toBe(true);
  });

  it('clears a removed preview without repainting data and cancels queued work on removal', () => {
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
    map.remove();
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

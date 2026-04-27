// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BoxSelectControl } from './box-select-control';

interface FakeMap {
  getCanvasContainer: () => HTMLElement;
  queryRenderedFeatures: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
}

function makeFakeMap(canvasContainer: HTMLElement, hits: any[] = []): FakeMap {
  return {
    getCanvasContainer: () => canvasContainer,
    queryRenderedFeatures: vi.fn(() => hits),
    select: vi.fn(),
  };
}

function dispatch(el: EventTarget, type: string, opts: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  button?: number;
  clientX?: number;
  clientY?: number;
} = {}): void {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: opts.button ?? 0,
    shiftKey: !!opts.shiftKey,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    altKey: !!opts.altKey,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
  });
  el.dispatchEvent(e);
}

describe('BoxSelectControl', () => {
  let canvasContainer: HTMLElement;
  let map: FakeMap;
  let control: BoxSelectControl;

  beforeEach(() => {
    // Mount a canvas container with a stable bounding rect so pixel math is
    // deterministic. JSDOM's getBoundingClientRect returns zeros by default.
    canvasContainer = document.createElement('div');
    canvasContainer.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(canvasContainer);

    map = makeFakeMap(canvasContainer);
    control = new BoxSelectControl();
    const anchor = control.onAdd(map as any);
    document.body.appendChild(anchor);
  });

  afterEach(() => {
    control.onRemove();
    canvasContainer.remove();
  });

  it('shift+drag selects with replace mode', () => {
    map.queryRenderedFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 1, geometryType: 'polygon', properties: {} },
      { source: 's', layer: 'l', id: 2, geometryType: 'polygon', properties: {} },
    ]);

    dispatch(canvasContainer, 'mousedown', { shiftKey: true, clientX: 100, clientY: 100 });
    dispatch(window, 'mousemove', { shiftKey: true, clientX: 200, clientY: 200 });
    dispatch(window, 'mouseup', { shiftKey: true, clientX: 200, clientY: 200 });

    expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
    const bbox = map.queryRenderedFeatures.mock.calls[0][0];
    expect(bbox).toEqual([[100, 100], [200, 200]]);

    expect(map.select).toHaveBeenCalledTimes(1);
    const refs = map.select.mock.calls[0][0];
    expect(refs).toEqual([
      { source: 's', layer: 'l', id: 1 },
      { source: 's', layer: 'l', id: 2 },
    ]);
    expect(map.select.mock.calls[0][1]).toEqual({ mode: 'replace' });
  });

  it('plain (non-shift) mousedown does NOT trigger box-select', () => {
    dispatch(canvasContainer, 'mousedown', { clientX: 100, clientY: 100 });
    dispatch(window, 'mousemove', { clientX: 200, clientY: 200 });
    dispatch(window, 'mouseup', { clientX: 200, clientY: 200 });

    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(map.select).not.toHaveBeenCalled();
  });

  it('below-threshold drag is a no-op', () => {
    dispatch(canvasContainer, 'mousedown', { shiftKey: true, clientX: 100, clientY: 100 });
    dispatch(window, 'mousemove', { shiftKey: true, clientX: 102, clientY: 102 });
    dispatch(window, 'mouseup', { shiftKey: true, clientX: 102, clientY: 102 });

    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(map.select).not.toHaveBeenCalled();
  });

  it('shift+ctrl+drag selects with add mode', () => {
    map.queryRenderedFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 1, geometryType: 'polygon', properties: {} },
    ]);
    dispatch(canvasContainer, 'mousedown', { shiftKey: true, ctrlKey: true, clientX: 0, clientY: 0 });
    dispatch(window, 'mousemove', { shiftKey: true, ctrlKey: true, clientX: 50, clientY: 50 });
    dispatch(window, 'mouseup', { shiftKey: true, ctrlKey: true, clientX: 50, clientY: 50 });

    expect(map.select).toHaveBeenCalledWith(
      [{ source: 's', layer: 'l', id: 1 }],
      { mode: 'add' },
    );
  });

  it('shift+meta+drag selects with add mode (Mac)', () => {
    map.queryRenderedFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 9, geometryType: 'polygon', properties: {} },
    ]);
    dispatch(canvasContainer, 'mousedown', { shiftKey: true, metaKey: true, clientX: 0, clientY: 0 });
    dispatch(window, 'mousemove', { shiftKey: true, metaKey: true, clientX: 50, clientY: 50 });
    dispatch(window, 'mouseup', { shiftKey: true, metaKey: true, clientX: 50, clientY: 50 });

    expect(map.select.mock.calls[0][1]).toEqual({ mode: 'add' });
  });

  it('shift+alt+drag selects with toggle mode', () => {
    map.queryRenderedFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 7, geometryType: 'polygon', properties: {} },
    ]);
    dispatch(canvasContainer, 'mousedown', { shiftKey: true, altKey: true, clientX: 0, clientY: 0 });
    dispatch(window, 'mousemove', { shiftKey: true, altKey: true, clientX: 50, clientY: 50 });
    dispatch(window, 'mouseup', { shiftKey: true, altKey: true, clientX: 50, clientY: 50 });

    expect(map.select.mock.calls[0][1]).toEqual({ mode: 'toggle' });
  });

  it('dedupes refs across visible layers backed by same feature', () => {
    map.queryRenderedFeatures.mockReturnValueOnce([
      { source: 's', layer: 'fill', id: 1, geometryType: 'polygon', properties: {} },
      { source: 's', layer: 'fill', id: 1, geometryType: 'polygon', properties: {} }, // dup of above
      { source: 's', layer: 'line', id: 1, geometryType: 'polygon', properties: {} }, // different layer, kept
    ]);
    dispatch(canvasContainer, 'mousedown', { shiftKey: true, clientX: 0, clientY: 0 });
    dispatch(window, 'mousemove', { shiftKey: true, clientX: 50, clientY: 50 });
    dispatch(window, 'mouseup', { shiftKey: true, clientX: 50, clientY: 50 });

    const refs = map.select.mock.calls[0][0];
    expect(refs).toEqual([
      { source: 's', layer: 'fill', id: 1 },
      { source: 's', layer: 'line', id: 1 },
    ]);
  });

  it('disable() makes shift+drag a no-op', () => {
    control.disable();
    expect(control.isEnabled()).toBe(false);
    dispatch(canvasContainer, 'mousedown', { shiftKey: true, clientX: 0, clientY: 0 });
    dispatch(window, 'mousemove', { shiftKey: true, clientX: 50, clientY: 50 });
    dispatch(window, 'mouseup', { shiftKey: true, clientX: 50, clientY: 50 });
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(map.select).not.toHaveBeenCalled();
  });

  it('forwards layers filter to queryRenderedFeatures', () => {
    control.onRemove();
    control = new BoxSelectControl({ layers: ['only-this'] });
    const anchor = control.onAdd(map as any);
    document.body.appendChild(anchor);
    map.queryRenderedFeatures.mockReturnValueOnce([]);

    dispatch(canvasContainer, 'mousedown', { shiftKey: true, clientX: 0, clientY: 0 });
    dispatch(window, 'mousemove', { shiftKey: true, clientX: 50, clientY: 50 });
    dispatch(window, 'mouseup', { shiftKey: true, clientX: 50, clientY: 50 });

    expect(map.queryRenderedFeatures.mock.calls[0][1]).toEqual({ layers: ['only-this'] });
  });

  it('passes pixel bbox in canvas-container coordinates (subtracting boundingClientRect offset)', () => {
    // Offset the canvas container so client coords differ from container coords.
    canvasContainer.getBoundingClientRect = () => ({
      x: 50, y: 30, top: 30, left: 50, right: 850, bottom: 630,
      width: 800, height: 600, toJSON: () => ({}),
    } as DOMRect);
    map.queryRenderedFeatures.mockReturnValueOnce([]);

    dispatch(canvasContainer, 'mousedown', { shiftKey: true, clientX: 150, clientY: 130 });
    dispatch(window, 'mousemove', { shiftKey: true, clientX: 250, clientY: 230 });
    dispatch(window, 'mouseup', { shiftKey: true, clientX: 250, clientY: 230 });

    expect(map.queryRenderedFeatures.mock.calls[0][0]).toEqual([[100, 100], [200, 200]]);
  });
});

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitFeatureHandler } from './split-feature';
import type { NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import { OK, Err } from '../../map/op-result';

const selected = { source: 'source', layer: 'lines', id: 0 };
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };

function event(
  kind: NormalizedPointerEvent['kind'],
  x = 0,
  y = 0,
  originalEvent: Event = new Event(kind, { cancelable: true }),
): NormalizedPointerEvent {
  return { kind, point: { x, y }, modifiers, button: 0, originalEvent };
}

function createMap(options: { geometry?: 'polyline' | 'polygon'; selection?: typeof selected[] } = {}) {
  const geometry = options.geometry ?? 'polyline';
  const selection = options.selection ?? [selected];
  const layer = { name: 'lines', geometry_type: geometry, shapes: [[[0]]] };
  const arcs = {
    forEachArcSegment: vi.fn(
      (id: number, callback: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void) => {
        if (id === 0) callback(0, 1, new Float64Array([0, 10]), new Float64Array([0, 0]));
      },
    ),
  };
  return {
    layers: { resolve: vi.fn(() => layer) },
    getSelection: vi.fn(() => selection),
    getSource: vi.fn(() => ({ getArcs: () => arcs })),
    unproject: vi.fn((x: number, y: number) => [x, y] as [number, number]),
    project: vi.fn((x: number, y: number) => [x, y] as [number, number]),
    setEditMode: vi.fn(),
    setEditDrawState: vi.fn(),
    clearEditDrawState: vi.fn(),
    render: vi.fn(),
    fire: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    ops: { splitSelected: vi.fn(async () => OK) },
  };
}

describe('SplitFeatureHandler', () => {
  let map = createMap();

  beforeEach(() => {
    map = createMap();
  });

  it('is disabled by default and validates a single same-layer path selection before enabling', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    expect(handler.isEnabled()).toBe(false);
    expect(() =>
      new SplitFeatureHandler(createMap({ selection: [] }) as unknown as EditHandlerHost).enable(),
    ).toThrow(/select/i);
    expect(() =>
      new SplitFeatureHandler(
        createMap({ selection: [selected, { ...selected, layer: 'other' }] }) as unknown as EditHandlerHost,
      ).enable(),
    ).toThrow(/selection/i);
    expect(() =>
      new SplitFeatureHandler(createMap({ geometry: 'polygon' }) as unknown as EditHandlerHost).enable(),
    ).toThrow(/point.*polygon/i);
  });

  it('enables point cutting in split mode with a crosshair and quietly disables when another mode wins', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    expect(map.setEditMode).toHaveBeenCalledWith('split');
    expect(handler.getCursor()).toBe('crosshair');
    const listener = map.on.mock.calls.find(([name]) => name === 'editmodechange')?.[1];
    expect(listener).toBeTypeOf('function');
    if (typeof listener === 'function') listener({ mode: 'draw' });
    expect(handler.isEnabled()).toBe(false);
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });

  it('commits only an exactly snapped point cutter', async () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'point',
      snapThreshold: 5,
    });
    handler.enable();
    handler.handlePointer(event('click', 50, 50));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
    handler.handlePointer(event('move', 5, 2));
    handler.handlePointer(event('click', 5, 2));
    await vi.waitFor(() =>
      expect(map.ops.splitSelected).toHaveBeenCalledWith({ cutter: { type: 'point', coordinates: [5, 0] } }),
    );
  });

  it('ignores a repeated completion while the split operation is pending', async () => {
    let resolveSplit: ((result: typeof OK) => void) | undefined;
    const pending = new Promise<typeof OK>((resolve) => {
      resolveSplit = resolve;
    });
    map.ops.splitSelected.mockImplementationOnce(() => pending);
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, { cutterType: 'polyline' });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('click', 9, 1));
    handler.handlePointer(event('contextmenu', 9, 1));
    handler.handlePointer(event('contextmenu', 9, 1));
    expect(map.ops.splitSelected).toHaveBeenCalledTimes(1);
    resolveSplit?.(OK);
    await vi.waitFor(() => expect(map.clearEditDrawState).toHaveBeenCalled());
  });

  it('completes a polyline once, clears its sketch after success or failure, and emits generic errors', async () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, { cutterType: 'polyline' });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('click', 9, 1));
    const contextMenu = new Event('contextmenu', { cancelable: true });
    handler.handlePointer(event('contextmenu', 9, 1, contextMenu));
    handler.handlePointer(event('contextmenu', 9, 1, contextMenu));
    await vi.waitFor(() => expect(map.ops.splitSelected).toHaveBeenCalledTimes(1));
    expect(map.ops.splitSelected).toHaveBeenCalledWith({
      cutter: { type: 'polyline', coordinates: [[1, 1], [9, 1]] },
    });
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(map.clearEditDrawState).toHaveBeenCalled();
    expect(handler.isEnabled()).toBe(true);

    map.ops.splitSelected.mockResolvedValueOnce(Err.validation('cutter', 'invalid'));
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('click', 9, 1));
    handler.handlePointer(event('contextmenu', 9, 1));
    await vi.waitFor(() =>
      expect(map.fire).toHaveBeenCalledWith('error', {
        error: { kind: 'validation', field: 'cutter', reason: 'invalid' },
      }),
    );
    expect(handler.isEnabled()).toBe(true);
  });

  it('cancels incomplete polylines on context menu and Escape without dispatching', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, { cutterType: 'polyline' });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('contextmenu', 1, 1));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
    handler.handlePointer(event('click', 1, 1));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });
});

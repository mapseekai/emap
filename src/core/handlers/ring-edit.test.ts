// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RingEditHandler } from './ring-edit';
import type { NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import { Err, OK } from '../../map/op-result';

const selected = { source: 'source', layer: 'polygons', id: 0 };
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };

function event(
  kind: NormalizedPointerEvent['kind'],
  x = 0,
  y = 0,
  originalEvent: Event = new Event(kind, { cancelable: true }),
): NormalizedPointerEvent {
  return { kind, point: { x, y }, modifiers, button: 0, originalEvent };
}

function createMap(options: { selection?: (typeof selected)[] } = {}) {
  const selection = options.selection ?? [selected];
  const layer = { name: 'polygons', geometry_type: 'polygon' as const, shapes: [[[0]]] };
  const arcs = {
    forEachArcSegment: vi.fn(
      (
        id: number,
        callback: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void,
      ) => {
        if (id === 0) callback(0, 1, new Float64Array([0, 10]), new Float64Array([0, 0]));
      },
    ),
    getVertexData: () => ({
      xx: new Float64Array([0, 10]),
      yy: new Float64Array([0, 0]),
      nn: new Int32Array([2]),
      ii: new Int32Array([0]),
      zz: null,
    }),
  };
  return {
    layers: { resolve: vi.fn(() => layer) },
    getSelection: vi.fn(() => selection),
    getSource: vi.fn(() => ({ getArcs: () => arcs })),
    unproject: vi.fn((x: number, y: number) => [x + 100, y + 200] as [number, number]),
    project: vi.fn((x: number, y: number) => [x - 100, y - 200] as [number, number]),
    setEditMode: vi.fn(),
    setEditDrawState: vi.fn(),
    clearEditDrawState: vi.fn(),
    render: vi.fn(),
    fire: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    ops: {
      addRing: vi.fn(async () => OK),
      deleteRing: vi.fn(async () => OK),
      fillRing: vi.fn(async () => OK),
    },
  };
}

describe('RingEditHandler', () => {
  let map = createMap();

  beforeEach(() => {
    map = createMap();
  });

  it('submits a closed ring from three placed points on right click', async () => {
    const handler = new RingEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    handler.handlePointer(event('click', 3, 4));
    handler.handlePointer(event('click', 5, 6));
    handler.handlePointer(event('contextmenu', 5, 6));
    await vi.waitFor(() =>
      expect(map.ops.addRing).toHaveBeenCalledWith({
        ring: [
          [101, 202],
          [103, 204],
          [105, 206],
          [101, 202],
        ],
      }),
    );
  });

  it('deletes the ring at the clicked unprojected point without creating a sketch', async () => {
    const handler = new RingEditHandler(map as unknown as EditHandlerHost, { mode: 'delete' });
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    await vi.waitFor(() => expect(map.ops.deleteRing).toHaveBeenCalledWith({ point: [101, 202] }));
    expect(map.setEditDrawState).not.toHaveBeenCalled();
  });

  it('fills the ring at the clicked unprojected point without creating a sketch', async () => {
    const handler = new RingEditHandler(map as unknown as EditHandlerHost, { mode: 'fill' });
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    await vi.waitFor(() => expect(map.ops.fillRing).toHaveBeenCalledWith({ point: [101, 202] }));
    expect(map.setEditDrawState).not.toHaveBeenCalled();
  });

  it('enables without a selected polygon feature', () => {
    const handler = new RingEditHandler(createMap({ selection: [] }) as unknown as EditHandlerHost);
    expect(() => handler.enable()).not.toThrow();
    expect(handler.isEnabled()).toBe(true);
  });

  it('fires an error when an operation rejects the interaction', async () => {
    map.ops.addRing.mockResolvedValueOnce(Err.validation('ring', 'invalid'));
    const handler = new RingEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    handler.handlePointer(event('click', 3, 4));
    handler.handlePointer(event('click', 5, 6));
    handler.handlePointer(event('contextmenu', 5, 6));
    await vi.waitFor(() =>
      expect(map.fire).toHaveBeenCalledWith('error', {
        error: { kind: 'validation', field: 'ring', reason: 'invalid' },
      }),
    );
  });

  it('clears an in-progress sketch when the mode changes', () => {
    const handler = new RingEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    handler.setOptions({ mode: 'delete' });
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });

  it('does not clear a shared overlay when disabled options change', () => {
    const handler = new RingEditHandler(map as unknown as EditHandlerHost);
    map.setEditDrawState({ kind: 'other-tool' });
    handler.setOptions({ mode: 'delete' });
    expect(map.clearEditDrawState).not.toHaveBeenCalled();
  });

  it('quietly disables when another edit mode takes ownership', () => {
    const handler = new RingEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    const listener = map.on.mock.calls.find(([name]) => name === 'editmodechange')?.[1];
    expect(listener).toBeTypeOf('function');
    if (typeof listener === 'function') listener({ mode: 'draw' });
    expect(handler.isEnabled()).toBe(false);
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });
});

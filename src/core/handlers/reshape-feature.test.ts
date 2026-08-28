// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReshapeFeatureHandler } from './reshape-feature';
import type { NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import { Err, OK } from '../../map/op-result';

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

function createMap(options: { selection?: (typeof selected)[] } = {}) {
  const selection = options.selection ?? [selected];
  const layer = { name: 'lines', geometry_type: 'polyline' as const, shapes: [[[0]]] };
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
    ops: { reshapeSelected: vi.fn(async () => OK) },
  };
}

describe('ReshapeFeatureHandler', () => {
  let map = createMap();

  beforeEach(() => {
    map = createMap();
  });

  it('enables without any selection', () => {
    const handler = new ReshapeFeatureHandler(
      createMap({ selection: [] }) as unknown as EditHandlerHost,
    );
    expect(() => handler.enable()).not.toThrow();
    expect(handler.isEnabled()).toBe(true);
  });

  it('submits two placed data coordinates on right click', async () => {
    const handler = new ReshapeFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    handler.handlePointer(event('click', 3, 4));
    handler.handlePointer(event('contextmenu', 3, 4));
    await vi.waitFor(() =>
      expect(map.ops.reshapeSelected).toHaveBeenCalledWith({
        line: [
          [101, 202],
          [103, 204],
        ],
      }),
    );
  });

  it('does not submit an escaped sketch', () => {
    const handler = new ReshapeFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    handler.handlePointer(event('contextmenu', 1, 2));
    expect(map.ops.reshapeSelected).not.toHaveBeenCalled();
  });

  it('fires an error when reshape rejects the sketch', async () => {
    map.ops.reshapeSelected.mockResolvedValueOnce(Err.validation('line', 'invalid'));
    const handler = new ReshapeFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    handler.handlePointer(event('click', 3, 4));
    handler.handlePointer(event('contextmenu', 3, 4));
    await vi.waitFor(() =>
      expect(map.fire).toHaveBeenCalledWith('error', {
        error: { kind: 'validation', field: 'line', reason: 'invalid' },
      }),
    );
  });

  it('quietly disables when another edit mode takes ownership', () => {
    const handler = new ReshapeFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    const listener = map.on.mock.calls.find(([name]) => name === 'editmodechange')?.[1];
    expect(listener).toBeTypeOf('function');
    if (typeof listener === 'function') listener({ mode: 'draw' });
    expect(handler.isEnabled()).toBe(false);
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });
});

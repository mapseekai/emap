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

  it('draws and submits arbitrary coordinates without a selection', () => {
    map = createMap({ selection: [] });
    const handler = new ReshapeFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    try {
      handler.handlePointer(event('move', 1, 2));
      handler.handlePointer(event('click', 1, 2));
      handler.handlePointer(event('move', 3, 4));
      handler.handlePointer(event('click', 3, 4));
      handler.handlePointer(event('contextmenu'));
      expect(map.ops.reshapeSelected).toHaveBeenCalledWith({
        line: [
          [101, 202],
          [103, 204],
        ],
      });
      expect(map.project).not.toHaveBeenCalled();
    } finally {
      handler.disable();
    }
  });

  it.each([
    ['one-point arc', { nn: new Int32Array([1]) }],
    ['negative start', { ii: new Int32Array([-1]) }],
    ['x overflow', { xx: new Float64Array([0]) }],
    ['y overflow', { yy: new Float64Array([0]) }],
    ['missing start', { ii: new Int32Array() }],
    ['NaN x', { xx: new Float64Array([0, NaN]) }],
    ['infinite y', { yy: new Float64Array([0, Infinity]) }],
  ])('ignores the whole snap context for an invalid %s but still draws', (_name, invalid) => {
    const arcs = map.getSource().getArcs();
    const vertexData = { ...arcs.getVertexData(), ...invalid };
    map.getSource.mockReturnValue({
      getArcs: () => ({ ...arcs, getVertexData: () => vertexData }),
    });
    const handler = new ReshapeFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    try {
      handler.handlePointer(event('move', -100, -200));
      handler.handlePointer(event('click', -100, -200));
      expect(map.setEditDrawState).toHaveBeenLastCalledWith(
        expect.objectContaining({ vertices: [[0, 0]], snapKind: null }),
      );
      expect(map.project).not.toHaveBeenCalled();
      expect(arcs.forEachArcSegment).not.toHaveBeenCalled();
    } finally {
      handler.disable();
    }
  });

  it.each([
    ['sparse shape', new Array(1)],
    ['sparse part', [new Array(1)]],
    ['out-of-range reversed arc', [[-2]]],
    ['unsafe arc ID', [[Number.MAX_SAFE_INTEGER + 1]]],
  ])('ignores a %s without blocking sketch placement', (_name, shape) => {
    map.layers.resolve.mockReturnValue({
      name: 'lines',
      geometry_type: 'polyline',
      shapes: [shape],
    });
    const handler = new ReshapeFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    try {
      handler.handlePointer(event('move', -100, -200));
      handler.handlePointer(event('click', -100, -200));
      expect(map.setEditDrawState).toHaveBeenLastCalledWith(
        expect.objectContaining({ vertices: [[0, 0]], snapKind: null }),
      );
      expect(map.project).not.toHaveBeenCalled();
    } finally {
      handler.disable();
    }
  });

  it.each([
    ['vertex wins an edge tie on a reversed arc', -101, -200, [0, 0], 'vertex'],
    ['edge projection', -95, -198, [5, 0], 'edge'],
    ['exact threshold is excluded', -95, -195, null, null],
  ])('preserves %s', (_name, x, y, snapCoord, snapKind) => {
    map.layers.resolve.mockReturnValue({
      name: 'lines',
      geometry_type: 'polyline',
      shapes: [[[-1]]],
    });
    const handler = new ReshapeFeatureHandler(map as unknown as EditHandlerHost, {
      snapThreshold: 5,
    });
    handler.enable();
    try {
      handler.handlePointer(event('click', -120, -220));
      handler.handlePointer(event('move', x, y));
      expect(map.setEditDrawState).toHaveBeenLastCalledWith(
        expect.objectContaining({ snapCoord, snapKind }),
      );
      expect(map.unproject).toHaveBeenCalledWith(x - 5, y - 5);
      expect(map.unproject).toHaveBeenCalledWith(x + 5, y + 5);
    } finally {
      handler.disable();
    }
  });

  it('retains vertex snapping without a segment API', () => {
    const arcs = map.getSource().getArcs();
    Reflect.deleteProperty(arcs, 'forEachArcSegment');
    const handler = new ReshapeFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    try {
      handler.handlePointer(event('move', -101, -200));
      expect(map.setEditDrawState).toHaveBeenLastCalledWith(
        expect.objectContaining({ snapCoord: [0, 0], snapKind: 'vertex' }),
      );
    } finally {
      handler.disable();
    }
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

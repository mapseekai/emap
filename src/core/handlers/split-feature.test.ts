// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitFeatureHandler } from './split-feature';
import type { NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import { OK, Err, type OpResult } from '../../map/op-result';

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

function createMap(
  options: { geometry?: 'polyline' | 'polygon'; selection?: (typeof selected)[] } = {},
) {
  const geometry = options.geometry ?? 'polyline';
  const selection = options.selection ?? [selected];
  const layer = { name: 'lines', geometry_type: geometry, shapes: [[[0]], [[1]]] };
  const arcs = {
    forEachArcSegment: vi.fn(
      (
        id: number,
        callback: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void,
      ) => {
        if (id === 0) callback(0, 1, new Float64Array([0, 10]), new Float64Array([0, 0]));
        if (id === 1) callback(0, 1, new Float64Array([20, 30]), new Float64Array([0, 0]));
      },
    ),
    getVertexData: () => ({
      xx: new Float64Array([0, 10, 20, 30]),
      yy: new Float64Array([0, 0, 0, 0]),
      nn: new Int32Array([2, 2]),
      ii: new Int32Array([0, 2]),
      zz: null,
    }),
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
        createMap({
          selection: [selected, { ...selected, layer: 'other' }],
        }) as unknown as EditHandlerHost,
      ).enable(),
    ).toThrow(/selection/i);
    expect(() =>
      new SplitFeatureHandler(
        createMap({ geometry: 'polygon' }) as unknown as EditHandlerHost,
      ).enable(),
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
      expect(map.ops.splitSelected).toHaveBeenCalledWith({
        cutter: { type: 'point', coordinates: [5, 0] },
      }),
    );
  });

  it('ignores a repeated completion while the split operation is pending', async () => {
    let resolveSplit: ((result: typeof OK) => void) | undefined;
    const pending = new Promise<typeof OK>((resolve) => {
      resolveSplit = resolve;
    });
    map.ops.splitSelected.mockImplementationOnce(() => pending);
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
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
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('click', 9, 1));
    const contextMenu = new Event('contextmenu', { cancelable: true });
    handler.handlePointer(event('contextmenu', 9, 1, contextMenu));
    handler.handlePointer(event('contextmenu', 9, 1, contextMenu));
    await vi.waitFor(() => expect(map.ops.splitSelected).toHaveBeenCalledTimes(1));
    expect(map.ops.splitSelected).toHaveBeenCalledWith({
      cutter: {
        type: 'polyline',
        coordinates: [
          [1, 1],
          [9, 1],
        ],
      },
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

  it('cancels a snapped point sketch when the selection changes before click', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('move', 5, 2));
    const selectionChange = map.on.mock.calls.find(([name]) => name === 'selectionchange')?.[1];
    expect(selectionChange).toBeTypeOf('function');
    if (typeof selectionChange === 'function') selectionChange({});
    handler.handlePointer(event('click', 5, 2));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });

  it('cancels a polyline sketch when the selection changes after its first vertex', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    const selectionChange = map.on.mock.calls.find(([name]) => name === 'selectionchange')?.[1];
    if (typeof selectionChange === 'function') selectionChange({});
    handler.handlePointer(event('click', 9, 1));
    handler.handlePointer(event('contextmenu', 9, 1));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
  });

  it('clears a published snap overlay when the cursor leaves the threshold', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('move', 5, 2));
    expect(map.setEditDrawState).toHaveBeenCalled();
    handler.handlePointer(event('move', 50, 50));
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });

  it('does not let a pending completion clear a later split sketch', async () => {
    let resolveSplit: ((result: typeof OK) => void) | undefined;
    const pending = new Promise<typeof OK>((resolve) => {
      resolveSplit = resolve;
    });
    map.ops.splitSelected.mockImplementationOnce(() => pending);
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('click', 9, 1));
    handler.handlePointer(event('contextmenu', 9, 1));
    handler.disable();
    handler.enable();
    handler.handlePointer(event('click', 2, 2));
    const clearCount = map.clearEditDrawState.mock.calls.length;
    resolveSplit?.(OK);
    await Promise.resolve();
    expect(map.clearEditDrawState).toHaveBeenCalledTimes(clearCount);
  });

  it('does not clear a draw overlay after draw mode takes over a pending split', async () => {
    let resolveSplit: ((result: typeof OK) => void) | undefined;
    const pending = new Promise<typeof OK>((resolve) => {
      resolveSplit = resolve;
    });
    map.ops.splitSelected.mockImplementationOnce(() => pending);
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('click', 9, 1));
    handler.handlePointer(event('contextmenu', 9, 1));
    const modeChange = map.on.mock.calls.find(([name]) => name === 'editmodechange')?.[1];
    if (typeof modeChange === 'function') modeChange({ mode: 'draw' });
    map.setEditDrawState.mockClear();
    map.clearEditDrawState.mockClear();
    map.setEditDrawState({ vertices: [[3, 3]], geometryType: 'polyline' });
    resolveSplit?.(OK);
    await Promise.resolve();
    expect(map.clearEditDrawState).not.toHaveBeenCalled();
  });

  it('keeps a polyline sketch when equivalent selected refs are reordered', async () => {
    const second = { source: 'source', layer: 'lines', id: 1 };
    map.getSelection.mockReturnValue([selected, second]);
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    map.getSelection.mockReturnValue([second, selected]);
    handler.handlePointer(event('click', 9, 1));
    handler.handlePointer(event('contextmenu', 9, 1));
    await vi.waitFor(() => expect(map.ops.splitSelected).toHaveBeenCalledTimes(1));
  });

  it('cancels a snapped cutter when the current selection contains an invalid ref', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('move', 5, 2));
    map.getSelection.mockReturnValue([{ ...selected, id: 10 }]);
    handler.handlePointer(event('click', 5, 2));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });

  it('allows a re-enabled generation to submit before an older request settles', async () => {
    let resolveOld: ((result: typeof OK) => void) | undefined;
    let resolveNew: ((result: typeof OK) => void) | undefined;
    const oldPending = new Promise<typeof OK>((resolve) => {
      resolveOld = resolve;
    });
    const newPending = new Promise<typeof OK>((resolve) => {
      resolveNew = resolve;
    });
    map.ops.splitSelected
      .mockImplementationOnce(() => oldPending)
      .mockImplementationOnce(() => newPending);
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('click', 9, 1));
    handler.handlePointer(event('contextmenu', 9, 1));
    handler.disable();
    handler.enable();
    handler.handlePointer(event('click', 2, 2));
    handler.handlePointer(event('click', 8, 2));
    handler.handlePointer(event('contextmenu', 8, 2));
    expect(map.ops.splitSelected).toHaveBeenCalledTimes(2);
    resolveOld?.(OK);
    await Promise.resolve();
    handler.handlePointer(event('contextmenu', 8, 2));
    expect(map.ops.splitSelected).toHaveBeenCalledTimes(2);
    resolveNew?.(OK);
  });
  it('keeps newer completion ownership when concurrent generations settle in either order', async () => {
    let resolveOld: ((result: OpResult) => void) | undefined;
    let resolveNew: ((result: OpResult) => void) | undefined;
    const oldPending = new Promise<OpResult>((resolve) => {
      resolveOld = resolve;
    });
    const newPending = new Promise<OpResult>((resolve) => {
      resolveNew = resolve;
    });
    map.ops.splitSelected
      .mockImplementationOnce(() => oldPending)
      .mockImplementationOnce(() => newPending);
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('click', 9, 1));
    handler.handlePointer(event('contextmenu', 9, 1));
    handler.disable();
    handler.enable();
    handler.handlePointer(event('click', 2, 2));
    handler.handlePointer(event('click', 8, 2));
    handler.handlePointer(event('contextmenu', 8, 2));
    resolveNew?.(Err.validation('cutter', 'new failure'));
    await vi.waitFor(() => expect(map.fire).toHaveBeenCalledTimes(1));
    resolveOld?.(Err.validation('cutter', 'old failure'));
    await Promise.resolve();
    expect(map.fire).toHaveBeenCalledTimes(1);
  });

  it('cancels a sketch when delimiter-containing source/layer identities change', () => {
    const first = { source: 'a\u0000b', layer: 'c', id: 0 };
    const second = { source: 'a', layer: 'b\u0000c', id: 0 };
    map.getSelection.mockReturnValue([first]);
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('move', 5, 2));
    map.getSelection.mockReturnValue([second]);
    handler.handlePointer(event('click', 5, 2));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });

  it('rejects malformed selected paths at enable and cancels invalid active paths without iterating them', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    map.layers.resolve.mockReturnValue({
      name: 'lines',
      geometry_type: 'polyline',
      shapes: [[[]]],
    });
    expect(() => handler.enable()).toThrow(/invalid feature geometry/i);
    map.layers.resolve.mockReturnValue({
      name: 'lines',
      geometry_type: 'polyline',
      shapes: [[[0]]],
    });
    handler.enable();
    handler.handlePointer(event('move', 5, 2));
    map.layers.resolve.mockReturnValue({
      name: 'lines',
      geometry_type: 'polyline',
      shapes: [[[Number.MAX_SAFE_INTEGER + 1]]],
    });
    handler.handlePointer(event('click', 5, 2));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });

  it.each([
    ['sparse shape', new Array(1)],
    ['sparse part', [new Array(1)]],
    ['undefined part', [undefined]],
  ])('cancels an active snapped cutter when selection has a %s', (_name, malformedShape) => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('move', 5, 2));
    expect(map.setEditDrawState).toHaveBeenCalled();

    map.layers.resolve.mockReturnValue({
      name: 'lines',
      geometry_type: 'polyline',
      shapes: [malformedShape],
    });
    expect(() => handler.handlePointer(event('move', 5, 2))).not.toThrow();

    expect(map.clearEditDrawState).toHaveBeenCalled();
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
  });

  it('cancels an active snapped cutter when the selection contains an undefined ref', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('move', 5, 2));
    map.getSelection.mockReturnValue([undefined]);

    expect(() => handler.handlePointer(event('move', 5, 2))).not.toThrow();

    expect(map.clearEditDrawState).toHaveBeenCalled();
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
  });

  it('validates a pointer move once and scans shared selected arcs once', () => {
    const repeatedSelection = [selected, { ...selected, id: 1 }];
    const sharedShapes = [[[0, 0, 1]], [[~0, 1]]];
    const getVertexData = vi.fn(() => ({
      xx: new Float64Array([0, 10, 20, 30]),
      yy: new Float64Array([0, 0, 0, 0]),
      nn: new Int32Array([2, 2]),
      ii: new Int32Array([0, 2]),
      zz: null,
    }));
    const forEachArcSegment = vi.fn(
      (
        id: number,
        callback: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void,
      ) => {
        if (id === 0) callback(0, 1, new Float64Array([0, 10]), new Float64Array([0, 0]));
        if (id === 1) callback(0, 1, new Float64Array([20, 30]), new Float64Array([0, 0]));
      },
    );
    map.getSelection.mockReturnValue(repeatedSelection);
    map.layers.resolve.mockReturnValue({
      name: 'lines',
      geometry_type: 'polyline',
      shapes: sharedShapes,
    });
    map.getSource.mockReturnValue({ getArcs: () => ({ getVertexData, forEachArcSegment }) });
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    map.getSelection.mockClear();
    map.layers.resolve.mockClear();
    map.getSource.mockClear();
    getVertexData.mockClear();
    forEachArcSegment.mockClear();

    handler.handlePointer(event('move', 5, 2));

    expect(map.getSelection).toHaveBeenCalledTimes(1);
    expect(map.layers.resolve).toHaveBeenCalledTimes(1);
    expect(map.getSource).toHaveBeenCalledTimes(1);
    expect(getVertexData).toHaveBeenCalledTimes(1);
    expect(forEachArcSegment.mock.calls.map(([id]) => id).sort()).toEqual([0, 1]);
  });

  it('rejects empty shapes and out-of-range signed arc references', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    map.layers.resolve.mockReturnValue({ name: 'lines', geometry_type: 'polyline', shapes: [[]] });
    expect(() => handler.enable()).toThrow(/invalid feature geometry/i);
    map.layers.resolve.mockReturnValue({
      name: 'lines',
      geometry_type: 'polyline',
      shapes: [[[2]]],
    });
    expect(() => handler.enable()).toThrow(/invalid feature geometry/i);
  });

  it('cancels incomplete polylines on context menu and Escape without dispatching', () => {
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost, {
      cutterType: 'polyline',
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 1));
    handler.handlePointer(event('contextmenu', 1, 1));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
    handler.handlePointer(event('click', 1, 1));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(map.ops.splitSelected).not.toHaveBeenCalled();
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });
  it.each([
    ['forward arc', [[[0]]]],
    ['reversed arc', [[[~0]]]],
  ])('classifies an exact %s endpoint snap as a vertex', (_name, shapes) => {
    map.layers.resolve.mockReturnValue({ name: 'lines', geometry_type: 'polyline', shapes });
    const handler = new SplitFeatureHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('move', 0, 0));

    expect(map.setEditDrawState).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapKind: 'vertex' }),
    );
  });
});

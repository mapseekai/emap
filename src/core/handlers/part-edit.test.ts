// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartEditHandler } from './part-edit';
import type { NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import { Err, OK } from '../../map/op-result';

const selected = { source: 'source', layer: 'paths', id: 0 };
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
  options: { selection?: (typeof selected)[]; geometryType?: 'polygon' | 'polyline' } = {},
) {
  const selection = options.selection ?? [selected];
  const layer = {
    name: 'paths',
    geometry_type: options.geometryType ?? 'polygon',
    shapes: [[[0]]],
  };
  const arcs = {
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
    ops: { addPart: vi.fn(async () => OK), deletePart: vi.fn(async () => OK) },
  };
}

describe('PartEditHandler', () => {
  let map = createMap();

  beforeEach(() => {
    map = createMap();
  });

  it('submits a closed polygon part from three placed points on right click', async () => {
    const handler = new PartEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    handler.handlePointer(event('click', 3, 4));
    handler.handlePointer(event('click', 5, 6));
    handler.handlePointer(event('contextmenu', 5, 6));
    await vi.waitFor(() =>
      expect(map.ops.addPart).toHaveBeenCalledWith({
        coordinates: [
          [101, 202],
          [103, 204],
          [105, 206],
          [101, 202],
        ],
      }),
    );
  });

  it('submits a polyline part from two placed points', async () => {
    map = createMap({ geometryType: 'polyline' });
    const handler = new PartEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    handler.handlePointer(event('click', 3, 4));
    handler.handlePointer(event('contextmenu', 3, 4));
    await vi.waitFor(() =>
      expect(map.ops.addPart).toHaveBeenCalledWith({
        coordinates: [
          [101, 202],
          [103, 204],
        ],
      }),
    );
  });

  it('deletes the clicked part using a scaled data-unit tolerance without creating a sketch', async () => {
    map.unproject.mockImplementation(
      (x: number, y: number) => [x * 2 + 100, 200 - y * 3] as [number, number],
    );
    const handler = new PartEditHandler(map as unknown as EditHandlerHost, {
      mode: 'delete',
      snapThreshold: 10,
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    await vi.waitFor(() =>
      expect(map.ops.deletePart).toHaveBeenCalledWith({ point: [102, 194], tolerance: 20 }),
    );
    expect(map.setEditDrawState).not.toHaveBeenCalled();
  });

  it('uses the default threshold when a supplied threshold is negative or non-finite', async () => {
    const handler = new PartEditHandler(map as unknown as EditHandlerHost, {
      mode: 'delete',
      snapThreshold: -1,
    });
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    await vi.waitFor(() =>
      expect(map.ops.deletePart).toHaveBeenCalledWith({ point: [101, 202], tolerance: 10 }),
    );
    handler.setOptions({ snapThreshold: Number.NaN });
    handler.handlePointer(event('click', 1, 2));
    await vi.waitFor(() => expect(map.ops.deletePart).toHaveBeenCalledTimes(2));
    expect(map.ops.deletePart).toHaveBeenLastCalledWith({ point: [101, 202], tolerance: 10 });
  });

  it('throws in add mode when enabled without exactly one selected path feature', () => {
    const handler = new PartEditHandler(createMap({ selection: [] }) as unknown as EditHandlerHost);
    expect(() => handler.enable()).toThrow(/selection/i);
  });

  it('enables in delete mode without any selection', () => {
    const handler = new PartEditHandler(
      createMap({ selection: [] }) as unknown as EditHandlerHost,
      {
        mode: 'delete',
      },
    );
    expect(() => handler.enable()).not.toThrow();
    expect(handler.isEnabled()).toBe(true);
  });

  it('switches from delete to add while enabled and accepts clicks with a valid selection', async () => {
    const handler = new PartEditHandler(map as unknown as EditHandlerHost, { mode: 'delete' });
    handler.enable();
    handler.setOptions({ mode: 'add' });
    handler.handlePointer(event('click', 1, 2));
    handler.handlePointer(event('click', 3, 4));
    handler.handlePointer(event('click', 5, 6));
    handler.handlePointer(event('contextmenu', 5, 6));
    await vi.waitFor(() =>
      expect(map.ops.addPart).toHaveBeenCalledWith({
        coordinates: [
          [101, 202],
          [103, 204],
          [105, 206],
          [101, 202],
        ],
      }),
    );
  });

  it('fires an error when an operation rejects the interaction', async () => {
    map.ops.addPart.mockResolvedValueOnce(Err.validation('part', 'invalid'));
    const handler = new PartEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    handler.handlePointer(event('click', 3, 4));
    handler.handlePointer(event('click', 5, 6));
    handler.handlePointer(event('contextmenu', 5, 6));
    await vi.waitFor(() =>
      expect(map.fire).toHaveBeenCalledWith('error', {
        error: { kind: 'validation', field: 'part', reason: 'invalid' },
      }),
    );
  });

  it('clears an in-progress sketch when the mode changes', () => {
    const handler = new PartEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.handlePointer(event('click', 1, 2));
    handler.setOptions({ mode: 'delete' });
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });

  it('does not clear a shared overlay when disabled options change', () => {
    const handler = new PartEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    handler.disable();
    map.clearEditDrawState.mockClear();
    map.setEditDrawState({ kind: 'other-tool' });
    handler.setOptions({ mode: 'delete' });
    expect(map.clearEditDrawState).not.toHaveBeenCalled();
  });

  it('quietly disables when another edit mode takes ownership', () => {
    const handler = new PartEditHandler(map as unknown as EditHandlerHost);
    handler.enable();
    const listener = map.on.mock.calls.find(([name]) => name === 'editmodechange')?.[1];
    expect(listener).toBeTypeOf('function');
    if (typeof listener === 'function') listener({ mode: 'draw' });
    expect(handler.isEnabled()).toBe(false);
    expect(map.clearEditDrawState).toHaveBeenCalled();
  });
});

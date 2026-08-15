// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import { MeasureHandler } from './measure';
import { MeasurementCalculator, type MeasurementContext } from '../../geo/measurement';

function makeHost(crs = 'EPSG:4326') {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const host = {
    clearEditMeasurementState: vi.fn(),
    getCRS: vi.fn(() => crs),
    getSource: vi.fn(),
    off: vi.fn((type: string, listener: (payload: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    }),
    on: vi.fn((type: string, listener: (payload: unknown) => void) => {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    }),
    project: vi.fn((x: number, y: number): [number, number] => [x * 100, y * 100]),
    pushCommand: vi.fn(),
    render: vi.fn(),
    setEditMeasurementState: vi.fn(),
    setEditMode: vi.fn(),
    unproject: vi.fn((x: number, y: number): [number, number] => [x / 100, y / 100]),
  };
  return {
    host,
    emit(type: string, payload: unknown): void {
      for (const listener of listeners.get(type) ?? []) listener(payload);
    },
  };
}

async function makeHandler(mode: 'length' | 'area') {
  const context = await new MeasurementCalculator().getContext('EPSG:4326');
  if (!context) throw new Error('EPSG:4326 measurement context is required for this test');

  const ready = Promise.withResolvers<MeasurementContext | null>();
  const fixture = makeHost();
  const editHost = fixture.host as unknown as EditHandlerHost; // Test fixture implements only the consumed host surface.
  const handler = new MeasureHandler(
    editHost,
    { mode },
    { getContext: vi.fn(() => ready.promise) },
  );
  return {
    ...fixture,
    handler,
    async activate(): Promise<void> {
      handler.enable();
      ready.resolve(context);
      await ready.promise;
    },
  };
}

function pointer(
  kind: NormalizedPointerEvent['kind'],
  x: number,
  y: number,
): NormalizedPointerEvent {
  return {
    kind,
    point: { x: x * 100, y: y * 100 },
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    button: 0,
    originalEvent: new MouseEvent(kind),
  };
}

function clickAt(x: number, y: number): NormalizedPointerEvent {
  return pointer('click', x, y);
}

function moveAt(x: number, y: number): NormalizedPointerEvent {
  return pointer('move', x, y);
}

function doubleClickAt(x: number, y: number): NormalizedPointerEvent {
  return pointer('dblclick', x, y);
}

function deferred<T>() {
  const { promise, resolve } = Promise.withResolvers<T>();
  return { promise, resolve };
}

function fakeContext(value: number): MeasurementContext {
  return {
    inverse(point): [number, number] | null {
      return [point[0], point[1]];
    },
    forward(lngLat): [number, number] | null {
      return [lngLat[0], lngLat[1]];
    },
    length: vi.fn(() => value),
    area: vi.fn(() => value),
  };
}

describe('MeasureHandler', () => {
  it('accumulates a length path and completes it on double click without data writes', async () => {
    const { handler, host, activate } = await makeHandler('length');
    await activate();

    handler.handlePointer(clickAt(0, 0));
    handler.handlePointer(moveAt(1, 0));
    handler.handlePointer(clickAt(1, 0));
    handler.handlePointer(doubleClickAt(1, 0));

    expect(handler.getResult()).toMatchObject({ mode: 'length', completed: true });
    expect(handler.getResult().lengthMeters).toBeCloseTo(111_319.490793, 4);
    expect(host.pushCommand).not.toHaveBeenCalled();
    expect(host.getSource).not.toHaveBeenCalled();
    expect(host.setEditMeasurementState).toHaveBeenLastCalledWith(
      expect.objectContaining({ completed: true, label: '111 km' }),
    );
  });

  it('closes an area by clicking its first vertex and clears it with Escape', async () => {
    const { handler, host, activate } = await makeHandler('area');
    await activate();

    for (const point of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ] as const) {
      handler.handlePointer(clickAt(point[0], point[1]));
    }

    expect(handler.getResult()).toMatchObject({ mode: 'area', completed: true });
    expect(handler.getResult().areaSquareMeters).toBeCloseTo(12_391_399_902.071, 3);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(handler.isEnabled()).toBe(true);
    expect(handler.getResult().vertices).toEqual([]);
    expect(host.clearEditMeasurementState).toHaveBeenCalled();
  });

  it('ignores an obsolete CRS-resolution promise after changing modes', async () => {
    const first = deferred<MeasurementContext | null>();
    const second = deferred<MeasurementContext | null>();
    const calculator = {
      getContext: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    };
    const fixture = makeHost();
    const editHost = fixture.host as unknown as EditHandlerHost; // Test fixture implements only the consumed host surface.
    const handler = new MeasureHandler(editHost, { mode: 'length' }, calculator);
    const staleContext = fakeContext(1);
    const currentContext = fakeContext(2);

    handler.enable();
    handler.setOptions({ mode: 'area' });
    handler.handlePointer(clickAt(0, 0));
    handler.handlePointer(clickAt(1, 0));
    handler.handlePointer(clickAt(1, 1));
    first.resolve(staleContext);
    await first.promise;
    second.resolve(currentContext);
    await second.promise;

    expect(staleContext.area).not.toHaveBeenCalled();
    expect(currentContext.area).toHaveBeenCalled();
    expect(fixture.host.setEditMeasurementState).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'area', label: '2 m²' }),
    );
  });

  it('quietly disables when another edit mode takes ownership', async () => {
    const { handler, emit, host, activate } = await makeHandler('length');
    await activate();

    emit('editmodechange', { mode: 'draw' });

    expect(handler.isEnabled()).toBe(false);
    expect(host.clearEditMeasurementState).toHaveBeenCalled();
  });
});

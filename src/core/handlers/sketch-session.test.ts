// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { SketchSession } from './sketch-session';
import type { NormalizedPointerEvent } from '../handler';
import { EMAP_THEME_COLORS } from '../../theme/colors';

import type { EditHandlerHost } from './edit-handler-host';

const modifiers = { shift: false, ctrl: false, alt: false, meta: false };

function event(
  kind: NormalizedPointerEvent['kind'],
  x = 0,
  y = 0,
  originalEvent: Event = new Event(kind, { cancelable: true }),
): NormalizedPointerEvent {
  return { kind, point: { x, y }, modifiers, button: 0, originalEvent };
}

function createHost() {
  return {
    unproject: vi.fn((x: number, y: number) => [x, y] as [number, number]),
    setEditDrawState: vi.fn(),
    clearEditDrawState: vi.fn(),
    render: vi.fn(),
  };
}

describe('SketchSession', () => {
  it('places vertices and publishes a cursor overlay', () => {
    const host = createHost();
    const session = new SketchSession(
      host as unknown as EditHandlerHost,
      { minVertices: 2 },
      vi.fn(),
    );

    expect(session.handlePointer(event('move', 3, 4))).toBe('passthrough');
    session.handlePointer(event('click', 1, 2));

    expect(session.vertexCount).toBe(1);
    expect(host.setEditDrawState).toHaveBeenLastCalledWith({
      vertices: [[1, 2]],
      cursorCoord: [1, 2],
      snapCoord: null,
      snapKind: null,
      geometryType: 'polyline',
      drawColor: EMAP_THEME_COLORS.primary,
    });
    expect(host.render).not.toHaveBeenCalled();
  });

  it('clears an incomplete sketch and prevents the native context menu', () => {
    const host = createHost();
    const finish = vi.fn();
    const session = new SketchSession(
      host as unknown as EditHandlerHost,
      { minVertices: 2 },
      finish,
    );
    session.handlePointer(event('click', 1, 2));
    const originalEvent = new Event('contextmenu', { cancelable: true });

    expect(session.handlePointer(event('contextmenu', 1, 2, originalEvent))).toBe('consumed');
    expect(originalEvent.defaultPrevented).toBe(true);
    expect(session.vertexCount).toBe(0);
    expect(finish).not.toHaveBeenCalled();
    expect(host.clearEditDrawState).toHaveBeenCalled();
    expect(host.render).toHaveBeenCalled();
  });

  it('finishes sufficient vertices and clears after the callback', () => {
    const host = createHost();
    const finish = vi.fn();
    const session = new SketchSession(
      host as unknown as EditHandlerHost,
      { minVertices: 2 },
      finish,
    );
    session.handlePointer(event('click', 1, 2));
    session.handlePointer(event('click', 3, 4));
    session.handlePointer(event('contextmenu'));

    expect(finish).toHaveBeenCalledWith([
      [1, 2],
      [3, 4],
    ]);
    expect(session.vertexCount).toBe(0);
  });

  it('closes rings before finishing', () => {
    const host = createHost();
    const finish = vi.fn();
    const session = new SketchSession(
      host as unknown as EditHandlerHost,
      { minVertices: 3, closeRing: true },
      finish,
    );
    session.handlePointer(event('click', 1, 2));
    session.handlePointer(event('click', 3, 4));
    session.handlePointer(event('click', 5, 6));
    session.handlePointer(event('contextmenu'));

    expect(finish).toHaveBeenCalledWith([
      [1, 2],
      [3, 4],
      [5, 6],
      [1, 2],
    ]);
  });

  it('auto-finishes at the configured vertex count', () => {
    const host = createHost();
    const finish = vi.fn();
    const session = new SketchSession(
      host as unknown as EditHandlerHost,
      { minVertices: 1, autoFinishAt: 1 },
      finish,
    );

    expect(session.handlePointer(event('click', 1, 2))).toBe('consumed');
    expect(finish).toHaveBeenCalledWith([[1, 2]]);
    expect(session.vertexCount).toBe(0);
  });

  it('clears and renders when Escape is pressed', () => {
    const host = createHost();
    const session = new SketchSession(
      host as unknown as EditHandlerHost,
      { minVertices: 2 },
      vi.fn(),
    );
    session.handlePointer(event('click', 1, 2));
    host.render.mockClear();

    session.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(session.vertexCount).toBe(0);
    expect(host.clearEditDrawState).toHaveBeenCalled();
    expect(host.render).toHaveBeenCalledOnce();
  });

  it('uses a resolved snap coordinate and displays its kind', () => {
    const host = createHost();
    const resolveSnap = vi.fn(() => ({
      coord: [8, 9] as [number, number],
      kind: 'vertex' as const,
    }));
    const session = new SketchSession(
      host as unknown as EditHandlerHost,
      { minVertices: 2, resolveSnap },
      vi.fn(),
    );
    session.handlePointer(event('move', 1, 2));
    session.handlePointer(event('click', 1, 2));

    expect(resolveSnap).toHaveBeenCalledWith(1, 2);
    expect(host.setEditDrawState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        vertices: [[8, 9]],
        cursorCoord: [8, 9],
        snapCoord: [8, 9],
        snapKind: 'vertex',
      }),
    );
  });

  it('does not place a vertex when canPlace rejects the snap result', () => {
    const host = createHost();
    const session = new SketchSession(
      host as unknown as EditHandlerHost,
      { minVertices: 1, canPlace: () => false },
      vi.fn(),
    );

    expect(session.handlePointer(event('click', 1, 2))).toBe('consumed');
    expect(session.vertexCount).toBe(0);
    expect(host.setEditDrawState).not.toHaveBeenCalled();
  });
});

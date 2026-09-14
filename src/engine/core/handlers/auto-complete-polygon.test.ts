// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AutoCompletePolygonHandler } from './auto-complete-polygon';
import type { EditHandlerHost } from './edit-handler-host';
import type { NormalizedPointerEvent } from '../handler';
import { OK } from '../../map/op-result';
import { HandlerManager } from '../handler-manager';

function fixture() {
  const listeners = new Map<string, (event: { mode: string }) => void>();
  const map = {
    on: vi.fn((name: string, listener: (event: { mode: string }) => void) =>
      listeners.set(name, listener),
    ),
    getSelection: () => [],
    setEditMode: vi.fn(),
    unproject: (x: number, y: number): [number, number] => [x, y],
    setEditDrawState: vi.fn(),
    clearEditDrawState: vi.fn(),
    render: vi.fn(),
    fire: vi.fn(),
    ops: { autoCompletePolygon: vi.fn(async () => OK), reshapeSelected: vi.fn(async () => OK) },
  };
  const handler = new AutoCompletePolygonHandler(map as unknown as EditHandlerHost);
  const pointer = (kind: NormalizedPointerEvent['kind'], x = 0, y = 0) =>
    handler.handlePointer({
      kind,
      point: { x, y },
      button: 0,
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      originalEvent: new Event(kind, { cancelable: true }),
    });
  return { handler, map, pointer, listeners };
}

describe('AutoCompletePolygonHandler', () => {
  it('receives actual DOM clicks and contextmenu through the handler manager', async () => {
    const { handler, map } = fixture();
    const manager = new HandlerManager();
    const element = document.createElement('div');
    document.body.appendChild(element);
    manager.register(handler);
    manager.attach(element);
    handler.enable();
    try {
      for (const [clientX, clientY] of [
        [8, 2],
        [14, 2],
        [14, 8],
        [8, 8],
      ])
        element.dispatchEvent(new MouseEvent('click', { clientX, clientY }));
      element.dispatchEvent(new MouseEvent('contextmenu', { button: 2, cancelable: true }));
      await vi.waitFor(() => expect(map.ops.autoCompletePolygon).toHaveBeenCalledTimes(1));
      expect(element.style.cursor).toBe('crosshair');
    } finally {
      handler.dispose();
      manager.detach();
      element.remove();
    }
  });

  it('submits a new-feature sketch on right click without requiring selection', async () => {
    const { handler, map, pointer } = fixture();
    handler.enable();
    expect(handler.name).toBe('autoCompletePolygon');
    expect(map.setEditMode).toHaveBeenCalledWith('auto-complete');
    pointer('click', 8, 2);
    pointer('click', 14, 2);
    pointer('click', 14, 8);
    pointer('click', 8, 8);
    pointer('contextmenu');
    await vi.waitFor(() =>
      expect(map.ops.autoCompletePolygon).toHaveBeenCalledWith({
        line: [
          [8, 2],
          [14, 2],
          [14, 8],
          [8, 8],
        ],
      }),
    );
    expect(map.ops.reshapeSelected).not.toHaveBeenCalled();
    handler.dispose();
  });

  it('cancels on Escape and gives up the sketch when another mode starts', () => {
    const { handler, map, pointer, listeners } = fixture();
    handler.enable();
    pointer('click', 8, 2);
    pointer('click', 14, 2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    pointer('contextmenu');
    expect(map.ops.autoCompletePolygon).not.toHaveBeenCalled();
    pointer('click', 8, 2);
    listeners.get('editmodechange')!({ mode: 'reshape' });
    expect(handler.isEnabled()).toBe(false);
    expect(map.clearEditDrawState).toHaveBeenCalled();
    handler.dispose();
  });
});

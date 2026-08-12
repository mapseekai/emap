// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { HistoryControl } from './history-control';

function fakeMap() {
  return {
    canUndo: vi.fn(() => true),
    canRedo: vi.fn(() => false),
    undo: vi.fn(),
    redo: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as any;
}

describe('HistoryControl', () => {
  it('renders the bundled undo and redo SVG icons', () => {
    const root = new HistoryControl().onAdd(fakeMap());
    const buttons = [...root.querySelectorAll('button')];

    expect(buttons).toHaveLength(2);
    expect(buttons[0].querySelector('span.emap-ctrl-icon svg')).toBeTruthy();
    expect(buttons[1].querySelector('span.emap-ctrl-icon svg')).toBeTruthy();
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });

  it('keeps undo and redo actions wired to their buttons', () => {
    const map = fakeMap();
    const root = new HistoryControl().onAdd(map);

    root.querySelector('.emap-ctrl-undo')?.dispatchEvent(new MouseEvent('click'));
    root.querySelector('.emap-ctrl-redo')?.dispatchEvent(new MouseEvent('click'));

    expect(map.undo).toHaveBeenCalledTimes(1);
    expect(map.redo).toHaveBeenCalledTimes(1);
  });
});

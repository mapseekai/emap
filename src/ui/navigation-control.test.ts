// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { NavigationControl } from './navigation-control';

function fakeMap() {
  return {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fire: vi.fn(),
    getCanvasContainer: () => document.createElement('div'),
  } as any;
}

describe('NavigationControl', () => {
  it('renders the supplied SVG controls by default', () => {
    const root = new NavigationControl().onAdd(fakeMap());
    const buttons = [...root.querySelectorAll('button')];

    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.className)).toEqual([
      'emap-ctrl-zoom-in',
      'emap-ctrl-zoom-out',
      'emap-ctrl-home',
    ]);
    expect(buttons.every((button) => button.querySelector('span.emap-ctrl-icon svg'))).toBe(true);
  });

  it('keeps navigation actions wired to their buttons', () => {
    const map = fakeMap();
    const root = new NavigationControl().onAdd(map);

    root.querySelector('.emap-ctrl-zoom-in')?.dispatchEvent(new MouseEvent('click'));
    root.querySelector('.emap-ctrl-zoom-out')?.dispatchEvent(new MouseEvent('click'));
    root.querySelector('.emap-ctrl-home')?.dispatchEvent(new MouseEvent('click'));

    expect(map.zoomIn).toHaveBeenCalledTimes(1);
    expect(map.zoomOut).toHaveBeenCalledTimes(1);
    expect(map.fire).toHaveBeenCalledWith('reset');
  });
});

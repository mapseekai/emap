// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BasemapControl, type BasemapStyle } from './basemap-control';

describe('BasemapControl', () => {
  it('keeps active styling and aria-pressed synchronized', () => {
    const styles: BasemapStyle[] = [
      { name: 'A', url: 'https://tiles.test/a/{z}/{x}/{y}.png', type: 'raster' },
      { name: 'B', url: 'https://tiles.test/b/{z}/{x}/{y}.png', type: 'raster' },
    ];
    const canvasContainer = document.createElement('div');
    const map = {
      getCanvasContainer: () => canvasContainer,
      on: vi.fn(),
      off: vi.fn(),
    } as any;
    const control = new BasemapControl({ styles });
    const root = control.onAdd(map);
    const buttons = root.querySelectorAll<HTMLButtonElement>('.emap-basemap-btn');
    expect(Array.from(buttons, (button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
    ]);

    Reflect.set(control, '_activeStyle', styles[0]);
    const updateButtons = Reflect.get(control, '_updateButtons') as () => void;
    updateButtons.call(control);

    expect(buttons[0].classList.contains('active')).toBe(true);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].classList.contains('active')).toBe(false);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
  });
});

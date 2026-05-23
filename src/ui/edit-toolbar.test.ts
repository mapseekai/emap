// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Control } from './control';
import { EditToolbar } from './edit-toolbar';

function buttonControl(label: string): Control {
  return {
    onAdd: vi.fn(() => {
      const root = document.createElement('div');
      const button = document.createElement('button');
      button.textContent = label;
      root.appendChild(button);
      return root;
    }),
    onRemove: vi.fn(),
  };
}

function fakeMap() {
  const drawFeature = {
    isEnabled: () => false,
    enable: vi.fn(),
    disable: vi.fn(),
    setOptions: vi.fn(),
  };
  const vertexEdit = {
    isEnabled: () => false,
    enable: vi.fn(),
    disable: vi.fn(),
    setOptions: vi.fn(),
  };
  return {
    drawFeature,
    vertexEdit,
    on: vi.fn(),
  } as any;
}

describe('EditToolbar', () => {
  it('renders explicit controls instead of default edit/draw controls', () => {
    const first = buttonControl('A');
    const second = buttonControl('B');
    const toolbar = new EditToolbar({ controls: [first, second] });

    const root = toolbar.onAdd(fakeMap());

    expect([...root.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['A', 'B']);
    expect(first.onAdd).toHaveBeenCalledTimes(1);
    expect(second.onAdd).toHaveBeenCalledTimes(1);

    toolbar.onRemove();
    expect(first.onRemove).toHaveBeenCalledTimes(1);
    expect(second.onRemove).toHaveBeenCalledTimes(1);
  });

  it('keeps the default vertex + drawSource buttons when controls are not provided', () => {
    const map = fakeMap();
    const toolbar = new EditToolbar({ drawSource: 'source-a', drawSourceLayer: 'layer-a' });

    const root = toolbar.onAdd(map);

    expect(root.querySelectorAll('button')).toHaveLength(4);
    expect(map.drawFeature.setOptions).toHaveBeenCalledWith(expect.objectContaining({
      source: 'source-a',
      sourceLayer: 'layer-a',
      type: 'polygon',
    }));
    expect(map.drawFeature.setOptions).toHaveBeenCalledWith(expect.objectContaining({
      source: 'source-a',
      sourceLayer: 'layer-a',
      type: 'polyline',
    }));
    expect(map.drawFeature.setOptions).toHaveBeenCalledWith(expect.objectContaining({
      source: 'source-a',
      sourceLayer: 'layer-a',
      type: 'point',
    }));
  });
});

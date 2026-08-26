// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Emap } from '../map/map';
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
  const reshapeFeature = {
    isEnabled: () => false,
    enable: vi.fn(),
    disable: vi.fn(),
    setOptions: vi.fn(),
    getOptions: () => ({}),
  };
  let ringEditEnabled = false;
  const ringEdit = {
    isEnabled: () => ringEditEnabled,
    enable: vi.fn(() => {
      ringEditEnabled = true;
    }),
    disable: vi.fn(() => {
      ringEditEnabled = false;
    }),
    setOptions: vi.fn(),
    getOptions: () => ({ mode: 'add' as const }),
  };
  const partEdit = {
    isEnabled: () => false,
    enable: vi.fn(),
    disable: vi.fn(),
    setOptions: vi.fn(),
    getOptions: () => ({ mode: 'add' as const }),
  };
  return {
    drawFeature,
    vertexEdit,
    reshapeFeature,
    ringEdit,
    partEdit,
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('EditToolbar', () => {
  it('renders explicit controls instead of default edit/draw controls', () => {
    const first = buttonControl('A');
    const second = buttonControl('B');
    const toolbar = new EditToolbar({ controls: [first, second] });
    const map = fakeMap();

    const root = toolbar.onAdd(map as unknown as Emap);

    expect([...root.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'A',
      'B',
    ]);
    expect(first.onAdd).toHaveBeenCalledTimes(1);
    expect(second.onAdd).toHaveBeenCalledTimes(1);

    toolbar.onRemove();
    expect(first.onRemove).toHaveBeenCalledTimes(1);
    expect(second.onRemove).toHaveBeenCalledTimes(1);
  });

  it('keeps the default vertex + drawSource buttons when controls are not provided', () => {
    const map = fakeMap();
    const toolbar = new EditToolbar({ drawSource: 'source-a', drawSourceLayer: 'layer-a' });

    const root = toolbar.onAdd(map as unknown as Emap);

    expect(root.querySelectorAll('button')).toHaveLength(4);
    expect(map.drawFeature.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'source-a',
        sourceLayer: 'layer-a',
        type: 'polygon',
      }),
    );
    expect(map.drawFeature.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'source-a',
        sourceLayer: 'layer-a',
        type: 'polyline',
      }),
    );
    expect(map.drawFeature.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'source-a',
        sourceLayer: 'layer-a',
        type: 'point',
      }),
    );
  });

  it('adds advanced handler buttons only when requested', () => {
    const map = fakeMap();
    const toolbar = new EditToolbar({ advancedTools: true });

    const root = toolbar.onAdd(map as unknown as Emap);
    const buttons = root.querySelectorAll('button');

    expect(buttons).toHaveLength(6);
    buttons[1]?.click();
    expect(map.reshapeFeature.enable).toHaveBeenCalledTimes(1);
    buttons[2]?.click();
    expect(map.ringEdit.setOptions).toHaveBeenLastCalledWith({ mode: 'add' });
    expect(map.ringEdit.enable).toHaveBeenCalledTimes(1);
    buttons[3]?.click();
    expect(map.ringEdit.setOptions).toHaveBeenLastCalledWith({ mode: 'delete' });
    expect(map.ringEdit.disable).toHaveBeenCalledTimes(1);
    expect(map.ringEdit.enable).toHaveBeenCalledTimes(2);
  });
});

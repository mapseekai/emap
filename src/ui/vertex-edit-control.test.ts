// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { VertexEditControl } from './vertex-edit-control';

function fakeMap() {
  let enabled = false;
  const ve = { isEnabled: () => enabled, enable: vi.fn(() => { enabled = true; }),
    disable: vi.fn(() => { enabled = false; }), setOptions: vi.fn() };
  return { vertexEdit: ve,
    getCanvasContainer: () => document.createElement('div') } as any;
}

describe('VertexEditControl (thin shell)', () => {
  it('onAdd renders a button; click toggles map.vertexEdit', () => {
    const map = fakeMap();
    const c = new VertexEditControl();
    const root = c.onAdd(map);
    const btn = root.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(map.vertexEdit.enable).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('active')).toBe(true);
    btn.click();
    expect(map.vertexEdit.disable).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('active')).toBe(false);
  });

  it('forwards constructor polygonFillColor to map.vertexEdit.setOptions on add', () => {
    const map = fakeMap();
    const c = new VertexEditControl({ polygonFillColor: 'rgba(1,2,3,0.4)' });
    c.onAdd(map);
    expect(map.vertexEdit.setOptions).toHaveBeenCalledWith({ polygonFillColor: 'rgba(1,2,3,0.4)' });
  });

  it('onRemove disables if active and detaches', () => {
    const map = fakeMap();
    const c = new VertexEditControl();
    const root = c.onAdd(map);
    (root.querySelector('button') as HTMLButtonElement).click(); // active
    c.onRemove();
    expect(map.vertexEdit.disable).toHaveBeenCalled();
  });
});

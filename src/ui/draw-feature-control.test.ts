// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DrawFeatureControl } from './draw-feature-control';

function fakeMap() {
  let enabled = false;
  let modeCb: ((e: { mode: string }) => void) | null = null;
  const df = { isEnabled: () => enabled, enable: vi.fn(() => { enabled = true; }),
    disable: vi.fn(() => { enabled = false; }), setOptions: vi.fn() };
  const off = vi.fn((t: string, cb: any) => {
    if (t === 'editmodechange' && cb === modeCb) modeCb = null;
  });
  return {
    drawFeature: df,
    getCanvasContainer: () => document.createElement('div'),
    on: (t: string, cb: any) => { if (t === 'editmodechange') modeCb = cb; },
    off,
    _fireMode: (m: string) => modeCb?.({ mode: m }),
  } as any;
}

describe('DrawFeatureControl (thin shell)', () => {
  it('onAdd forwards options (minus icon) to map.drawFeature.setOptions and renders the button', () => {
    const map = fakeMap();
    const c = new DrawFeatureControl({ source: 's', type: 'polygon', snapThreshold: 7, icon: '★' });
    const root = c.onAdd(map);
    expect(map.drawFeature.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ source: 's', type: 'polygon', snapThreshold: 7 }));
    expect(map.drawFeature.setOptions.mock.calls[0][0]).not.toHaveProperty('icon');
    const btn = root.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.className).toBe('emap-ctrl-draw');
    expect(btn.title).toBe('Draw Polygon');
    expect(btn.querySelector('span.emap-ctrl-icon')?.textContent).toBe('★');
    btn.click();
    expect(map.drawFeature.enable).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('active')).toBe(true);
    btn.click();
    expect(map.drawFeature.disable).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('active')).toBe(false);
  });

  it('default icon/title when no icon option (per geometry type)', () => {
    const map = fakeMap();
    const c = new DrawFeatureControl({ source: 's', type: 'point' });
    const root = c.onAdd(map);
    const btn = root.querySelector('button') as HTMLButtonElement;
    expect(btn.title).toBe('Draw Point');
    expect(btn.querySelector('span.emap-ctrl-icon')?.textContent).toBe('●');
  });

  it('cross-mode editmodechange un-presses the button', () => {
    const map = fakeMap();
    const c = new DrawFeatureControl({ source: 's', type: 'polygon' });
    const root = c.onAdd(map);
    const btn = root.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(btn.classList.contains('active')).toBe(true);
    map._fireMode('vertex');
    expect(btn.classList.contains('active')).toBe(false);
  });

  it('reapplies options and switches active draw buttons when used in a toolbar', () => {
    const map = fakeMap();
    const line = new DrawFeatureControl({ source: 's', type: 'polyline' });
    const point = new DrawFeatureControl({ source: 's', type: 'point' });
    const toolbar = document.createElement('div');
    toolbar.className = 'emap-edit-toolbar';
    const lineBtn = line.onAdd(map).querySelector('button') as HTMLButtonElement;
    const pointBtn = point.onAdd(map).querySelector('button') as HTMLButtonElement;
    toolbar.append(lineBtn, pointBtn);

    lineBtn.click();
    expect(map.drawFeature.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'polyline' }));
    expect(lineBtn.classList.contains('active')).toBe(true);

    pointBtn.click();
    expect(map.drawFeature.disable).toHaveBeenCalledTimes(1);
    expect(map.drawFeature.enable).toHaveBeenCalledTimes(2);
    expect(map.drawFeature.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'point' }));
    expect(lineBtn.classList.contains('active')).toBe(false);
    expect(pointBtn.classList.contains('active')).toBe(true);
  });

  it('onRemove disables if active', () => {
    const map = fakeMap();
    const c = new DrawFeatureControl({ source: 's', type: 'point' });
    const root = c.onAdd(map);
    (root.querySelector('button') as HTMLButtonElement).click();
    c.onRemove();
    expect(map.drawFeature.disable).toHaveBeenCalled();
  });

  it('onRemove unsubscribes the editmodechange listener', () => {
    const map = fakeMap();
    const c = new DrawFeatureControl({ source: 's', type: 'point' });
    const root = c.onAdd(map);
    const btn = root.querySelector('button') as HTMLButtonElement;

    c.onRemove();
    map._fireMode('vertex');

    expect(map.off).toHaveBeenCalledWith('editmodechange', expect.any(Function));
    expect(btn.classList.contains('active')).toBe(false);
  });
});

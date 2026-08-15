// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Emap } from '../map/map';
import { MeasureControl } from './measure-control';

type FakeMap = Emap & { _fireMode(mode: string): void };
function fakeMap() {
  let enabled = false;
  let options: { mode: 'length' | 'area'; drawColor?: string } = { mode: 'length' };
  const listeners = new Set<(event: { mode: string }) => void>();
  const emit = (mode: string): void => {
    for (const listener of listeners) listener({ mode });
  };
  const measure = {
    disable: vi.fn(() => {
      enabled = false;
      emit('none');
    }),
    enable: vi.fn(() => {
      enabled = true;
      emit('measure');
    }),
    getOptions: vi.fn(() => options),
    isEnabled: vi.fn(() => enabled),
    setOptions: vi.fn((next: Partial<typeof options>) => {
      options = { ...options, ...next };
    }),
  };
  const off = vi.fn((type: string, listener: (event: { mode: string }) => void) => {
    if (type === 'editmodechange') listeners.delete(listener);
  });
  return {
    measure,
    off,
    on(type: string, listener: (event: { mode: string }) => void): void {
      if (type === 'editmodechange') listeners.add(listener);
    },
    _fireMode: emit,
  } as unknown as FakeMap; // Test double implements only MeasureControl's consumed map surface.
}

describe('MeasureControl', () => {
  it('configures and toggles the length handler through an accessible button', () => {
    const map = fakeMap();
    const control = new MeasureControl({ mode: 'length', drawColor: '#0af', icon: '↔' });
    const root = control.onAdd(map);
    const button = root.querySelector('button') as HTMLButtonElement;

    expect(button.className).toBe('emap-ctrl-measure');
    expect(button.title).toBe('Measure length');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.querySelector('.emap-ctrl-icon')?.textContent).toBe('↔');

    button.click();
    expect(map.measure.setOptions).toHaveBeenLastCalledWith({ mode: 'length', drawColor: '#0af' });
    expect(map.measure.enable).toHaveBeenCalledTimes(1);
    expect(button.classList.contains('active')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    expect(map.measure.disable).toHaveBeenCalledTimes(1);
    expect(button.classList.contains('active')).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps paired length and area controls mutually exclusive', () => {
    const map = fakeMap();
    const length = new MeasureControl({ mode: 'length' });
    const area = new MeasureControl({ mode: 'area' });
    const toolbar = document.createElement('div');
    toolbar.className = 'emap-edit-toolbar';
    const lengthButton = length.onAdd(map).querySelector('button') as HTMLButtonElement;
    const areaButton = area.onAdd(map).querySelector('button') as HTMLButtonElement;
    toolbar.append(lengthButton, areaButton);

    lengthButton.click();
    areaButton.click();

    expect(map.measure.disable).toHaveBeenCalledTimes(1);
    expect(map.measure.enable).toHaveBeenCalledTimes(2);
    expect(map.measure.setOptions).toHaveBeenLastCalledWith({ mode: 'area' });
    expect(lengthButton.getAttribute('aria-pressed')).toBe('false');
    expect(areaButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('clears its pressed state when another edit mode takes ownership', () => {
    const map = fakeMap();
    const control = new MeasureControl({ mode: 'area' });
    const button = control.onAdd(map).querySelector('button') as HTMLButtonElement;
    button.click();

    map._fireMode('draw');

    expect(button.classList.contains('active')).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not disable a peer mode on removal, but disables its own active mode', () => {
    const map = fakeMap();
    const length = new MeasureControl({ mode: 'length' });
    const area = new MeasureControl({ mode: 'area' });
    const lengthButton = length.onAdd(map).querySelector('button') as HTMLButtonElement;
    area.onAdd(map);
    lengthButton.click();

    area.onRemove();
    expect(map.measure.disable).not.toHaveBeenCalled();
    length.onRemove();

    expect(map.measure.disable).toHaveBeenCalledTimes(1);
    expect(map.off).toHaveBeenCalledWith('editmodechange', expect.any(Function));
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ClickSelectHandler } from './click-select';
import type { NormalizedPointerEvent } from '../handler';
import type { SelectionHandlerHost } from './selection-handler-host';

function clickEv(x: number, y: number, shift = false, alt = false): NormalizedPointerEvent {
  return {
    kind: 'click',
    point: { x, y },
    modifiers: { shift, ctrl: false, alt, meta: false },
    button: 0,
    originalEvent: new MouseEvent('click'),
  };
}

function fakeMap(hits: any[]) {
  return {
    queryFeatures: vi.fn(() => hits),
    select: vi.fn(),
  };
}

describe('ClickSelectHandler', () => {
  it('name + disabled-by-default + passthrough when disabled', () => {
    const h = new ClickSelectHandler(fakeMap([]) as any);
    expect(h.name).toBe('clickSelect');
    expect(h.isEnabled()).toBe(false);
    expect(h.handlePointer(clickEv(1, 1))).toBe('passthrough');
  });

  it('hit click → select(refs,{mode:replace}) and consumes', () => {
    const map = fakeMap([
      { source: 's', layer: 'l', id: 3 },
      { source: 's', layer: 'l', id: 3 },
    ]);
    const h = new ClickSelectHandler(map as any);
    h.enable();
    expect(h.handlePointer(clickEv(10, 20))).toBe('consumed');
    expect(map.queryFeatures).toHaveBeenCalledWith([10, 20], undefined);
    expect(map.select).toHaveBeenCalledWith([{ source: 's', layer: 'l', id: 3 }], {
      mode: 'replace',
    });
  });

  it('empty click with replace-mode clears selection', () => {
    const map = fakeMap([]);
    const h = new ClickSelectHandler(map as any);
    h.enable();
    expect(h.handlePointer(clickEv(0, 0))).toBe('consumed');
    expect(map.select).toHaveBeenCalledWith([], { mode: 'replace' });
  });

  it('shift+click resolves add via default modifiers table', () => {
    const map = fakeMap([{ source: 's', layer: 'l', id: 1 }]);
    const h = new ClickSelectHandler(map as any);
    h.enable();
    h.handlePointer(clickEv(5, 5, true));
    expect(map.select).toHaveBeenCalledWith([{ source: 's', layer: 'l', id: 1 }], { mode: 'add' });
  });

  it('non-click events pass through', () => {
    const h = new ClickSelectHandler(fakeMap([]) as any);
    h.enable();
    expect(h.handlePointer({ ...clickEv(0, 0), kind: 'down' })).toBe('passthrough');
  });

  it('passes through clicks while a modal edit mode is active', () => {
    const map = {
      ...fakeMap([{ source: 's', layer: 'l', id: 1 }]),
      getEditMode: () => 'split' as const,
    };
    // Partial host stub: only the members handlePointer touches are present.
    const h = new ClickSelectHandler(map as unknown as SelectionHandlerHost);
    h.enable();
    expect(h.handlePointer(clickEv(10, 20))).toBe('passthrough');
    expect(map.queryFeatures).not.toHaveBeenCalled();
    expect(map.select).not.toHaveBeenCalled();
  });

  it('resumes consuming clicks once the edit mode clears', () => {
    let mode: 'none' | 'split' = 'split';
    const map = { ...fakeMap([]), getEditMode: () => mode };
    // Partial host stub: only the members handlePointer touches are present.
    const h = new ClickSelectHandler(map as unknown as SelectionHandlerHost);
    h.enable();
    expect(h.handlePointer(clickEv(0, 0))).toBe('passthrough');
    mode = 'none';
    expect(h.handlePointer(clickEv(0, 0))).toBe('consumed');
  });

  it('setOptions/getOptions round-trips modifiers + layers', () => {
    const h = new ClickSelectHandler(fakeMap([]) as any);
    h.setOptions({ layers: ['a'], modifiers: { add: 'ctrl' } });
    expect(h.getOptions().layers).toEqual(['a']);
    expect(h.getOptions().modifiers).toEqual({ add: 'ctrl' });
  });
});

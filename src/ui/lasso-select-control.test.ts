// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LassoSelectControl } from './lasso-select-control';

function makeMap() {
  const handler = {
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: vi.fn(() => false),
    setOptions: vi.fn(),
    getOptions: vi.fn(() => ({})),
  };
  const map = {
    get lassoSelect() {
      return handler;
    },
  };
  return { map, handler };
}

describe('LassoSelectControl (thin shell, DX P2c)', () => {
  let map: ReturnType<typeof makeMap>['map'];
  let handler: ReturnType<typeof makeMap>['handler'];

  beforeEach(() => {
    const m = makeMap();
    map = m.map;
    handler = m.handler;
  });

  it('onAdd forwards options to map.lassoSelect.setOptions and enables it', () => {
    const c = new LassoSelectControl({
      layers: ['a'],
      dragThreshold: 7,
      includeIntersecting: false,
      style: { stroke: '#f00', strokeDasharray: '8 2' },
    });
    const anchor = c.onAdd(map as any);
    expect(handler.setOptions).toHaveBeenCalledWith({
      layers: ['a'],
      dragThreshold: 7,
      includeIntersecting: false,
      style: { stroke: '#f00', strokeDasharray: '8 2' },
    });
    expect(handler.enable).toHaveBeenCalledTimes(1);
    expect(anchor.className).toBe('emap-ctrl emap-lasso-select-anchor');
    expect(anchor.style.width).toBe('0px');
  });

  it('onAdd with no options forwards undefined fields, still enables', () => {
    const c = new LassoSelectControl();
    c.onAdd(map as any);
    expect(handler.setOptions).toHaveBeenCalledWith({
      layers: undefined,
      dragThreshold: undefined,
      includeIntersecting: undefined,
      style: undefined,
    });
    expect(handler.enable).toHaveBeenCalledTimes(1);
  });

  it('enable/disable/isEnabled proxy to the handler', () => {
    const c = new LassoSelectControl();
    c.onAdd(map as any);
    c.disable();
    expect(handler.disable).toHaveBeenCalledTimes(1);
    c.enable();
    expect(handler.enable).toHaveBeenCalledTimes(2);
    handler.isEnabled.mockReturnValue(true);
    expect(c.isEnabled()).toBe(true);
  });

  it('a disabled control does not enable the handler on onAdd', () => {
    const c = new LassoSelectControl();
    c.disable();
    c.onAdd(map as any);
    expect(handler.enable).not.toHaveBeenCalled();
    expect(handler.setOptions).toHaveBeenCalledTimes(1);
  });

  it('onRemove disables the handler and removes the anchor', () => {
    const c = new LassoSelectControl();
    const anchor = c.onAdd(map as any);
    document.body.appendChild(anchor);
    c.onRemove();
    expect(handler.disable).toHaveBeenCalledTimes(1);
    expect(anchor.parentNode).toBeNull();
  });

  it('propagates the handler mutual-exclusivity throw from enable()', () => {
    handler.enable.mockImplementation(() => {
      throw new Error('cannot enable lassoSelect: boxSelect is enabled');
    });
    const c = new LassoSelectControl();
    expect(() => c.onAdd(map as any)).toThrow(/boxSelect is enabled/);
  });
});

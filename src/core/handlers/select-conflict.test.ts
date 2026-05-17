// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { HandlerManager } from '../handler-manager';
import { BoxSelectHandler } from './box-select';
import { LassoSelectHandler } from './lasso-select';

function fakeMap() {
  const c = document.createElement('div');
  return { getCanvasContainer: () => c, queryFeatures: () => [], select: () => {} };
}

describe('box/lasso mutual exclusion', () => {
  it('enabling lasso while box is enabled throws', () => {
    const m = new HandlerManager();
    const box = new BoxSelectHandler(fakeMap() as any);
    const lasso = new LassoSelectHandler(fakeMap() as any);
    m.register(box); m.register(lasso);
    box.enable();
    expect(() => lasso.enable()).toThrow(/boxSelect.*enabled|cannot enable lassoSelect/i);
  });

  it('enabling box while lasso is enabled throws', () => {
    const m = new HandlerManager();
    const box = new BoxSelectHandler(fakeMap() as any);
    const lasso = new LassoSelectHandler(fakeMap() as any);
    m.register(box); m.register(lasso);
    lasso.enable();
    expect(() => box.enable()).toThrow(/lassoSelect.*enabled|cannot enable boxSelect/i);
  });

  it('the two are usable independently when the other is disabled', () => {
    const m = new HandlerManager();
    const box = new BoxSelectHandler(fakeMap() as any);
    const lasso = new LassoSelectHandler(fakeMap() as any);
    m.register(box); m.register(lasso);
    box.enable(); box.disable();
    expect(() => lasso.enable()).not.toThrow();
  });

  it('a handler not registered in any manager can still enable (no manager → no conflict)', () => {
    const box = new BoxSelectHandler(fakeMap() as any);
    expect(() => box.enable()).not.toThrow();
  });
});

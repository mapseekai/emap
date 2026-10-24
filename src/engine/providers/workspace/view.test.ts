import { describe, expect, it, vi } from 'vitest';
import { ViewServiceImpl } from './view';
import { EventDispatcher } from '../../core/events';

function setup() {
  const requestRender = vi.fn();
  const view = new ViewServiceImpl({
    document: { _sources: new Map() },
    events: new EventDispatcher(),
    signals: { requestRender } as any,
  });
  return { view, requestRender };
}

describe('geometry LOD configuration', () => {
  it('defaults to the existing tolerance, changes immediately and can be disabled or reset', () => {
    const { view, requestRender } = setup();
    expect(view._viewport.geometryLodTolerance).toBe(0.5);
    view.setGeometryLod({ pixelTolerance: 2 });
    expect(view._viewport.geometryLodTolerance).toBe(2);
    expect(requestRender).toHaveBeenCalledOnce();
    view.setGeometryLod(false);
    expect(view._viewport.geometryLodTolerance).toBe(0);
    view.setGeometryLod();
    expect(view._viewport.geometryLodTolerance).toBe(0.5);
    view.dispose();
  });

  for (const options of [
    null,
    true,
    [],
    2,
    { pixelTolerance: 0 },
    { pixelTolerance: -1 },
    { pixelTolerance: Infinity },
    { pixelTolerance: NaN },
    { pixelTolerance: '2' },
    { pixelTolerance: 65 },
    { typo: 2 },
  ])
    it(`rejects invalid configuration without changing rendering: ${JSON.stringify(options)}`, () => {
      const { view, requestRender } = setup();
      expect(() => view.setGeometryLod(options as any)).toThrow(/geometryLod/);
      expect(view._viewport.geometryLodTolerance).toBe(0.5);
      expect(requestRender).not.toHaveBeenCalled();
      view.dispose();
    });
});

describe('independent screen path filtering', () => {
  it('toggles screen filtering without changing geometry LOD and redraws only on changes', () => {
    const { view, requestRender } = setup();
    expect(view._viewport.screenPathFiltering).toBe(false);
    view.setGeometryLod(false);
    requestRender.mockClear();
    view.setScreenPathFiltering(false);
    expect(requestRender).not.toHaveBeenCalled();
    view.setScreenPathFiltering(true);
    expect(view._viewport.screenPathFiltering).toBe(true);
    expect(view._viewport.geometryLodTolerance).toBe(0);
    expect(requestRender).toHaveBeenCalledOnce();
    view.setScreenPathFiltering(true);
    expect(requestRender).toHaveBeenCalledOnce();
    view.setGeometryLod({ pixelTolerance: 2 });
    expect(view._viewport.screenPathFiltering).toBe(true);
    view.setScreenPathFiltering();
    expect(view._viewport.screenPathFiltering).toBe(false);
    expect(view._viewport.geometryLodTolerance).toBe(2);
    view.dispose();
  });

  it.each(
    [null, 0, 'false', {}, []].map((value) => [value]),
  )('rejects a non-boolean flag: %j', (value) => {
    const { view, requestRender } = setup();
    expect(() => view.setScreenPathFiltering(value as any)).toThrow(/screenPathFiltering/);
    expect(requestRender).not.toHaveBeenCalled();
    expect(view._viewport.screenPathFiltering).toBe(false);
    view.dispose();
  });
});

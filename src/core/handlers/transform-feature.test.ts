import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransformFeatureHandler } from './transform-feature';
import type { NormalizedPointerEvent } from '../handler';

function pointer(
  kind: NormalizedPointerEvent['kind'],
  x: number,
  y: number,
  button = 0,
): NormalizedPointerEvent {
  return {
    kind,
    point: { x, y },
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    button,
    originalEvent: { type: kind } as unknown as Event,
  };
}

function makeMap() {
  const translateStub = { move: vi.fn(), commit: vi.fn(() => true), cancel: vi.fn() };
  const affineStub = {
    origin: [0, 0] as [number, number],
    applyDelta: vi.fn(),
    commit: vi.fn(() => true),
    cancel: vi.fn(),
    getCumulative: vi.fn(),
  };
  let editModeCb: ((e: { mode: string }) => void) | null = null;
  const map = {
    queryFeatures: vi.fn((_p: [number, number]) => [{ source: 's', layer: 'l', id: 1 }]),
    isSelected: vi.fn(() => false),
    select: vi.fn(),
    unproject: vi.fn((x: number, y: number): [number, number] => [x / 10, y / 10]),
    setEditMode: vi.fn(),
    render: vi.fn(),
    on: vi.fn((type: string, cb: (e: { mode: string }) => void) => {
      if (type === 'editmodechange') editModeCb = cb;
    }),
    editSession: {
      beginTranslateSession: vi.fn(() => translateStub),
      beginAffineSession: vi.fn(() => affineStub),
    },
  };
  return {
    map,
    translateStub,
    affineStub,
    fireEditMode: (mode: string) => editModeCb?.({ mode }),
  };
}

describe('TransformFeatureHandler', () => {
  // Node test env has no `window`; stub it and capture the keydown handler so
  // tests can drive Escape directly through the registered listener.
  let keydownListener: ((e: KeyboardEvent) => void) | null;
  let addSpy: ReturnType<typeof vi.fn>;
  let removeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    keydownListener = null;
    addSpy = vi.fn();
    addSpy.mockImplementation((type: string, cb: (e: KeyboardEvent) => void) => {
      if (type === 'keydown') keydownListener = cb;
    });
    removeSpy = vi.fn();
    vi.stubGlobal('window', {
      addEventListener: addSpy,
      removeEventListener: removeSpy,
    } as Pick<Window, 'addEventListener' | 'removeEventListener'>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has name transformFeature', () => {
    const { map } = makeMap();
    const h = new TransformFeatureHandler(map as any);
    expect(h.name).toBe('transformFeature');
  });

  it('is disabled by default and passes through events', () => {
    const { map } = makeMap();
    const h = new TransformFeatureHandler(map as any);
    expect(h.isEnabled()).toBe(false);
    expect(h.handlePointer(pointer('down', 5, 5))).toBe('passthrough');
    expect(map.queryFeatures).not.toHaveBeenCalled();
  });

  it('enable() sets transform edit mode, isEnabled true, adds keydown listener', () => {
    const { map } = makeMap();
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    expect(map.setEditMode).toHaveBeenCalledWith('transform');
    expect(h.isEnabled()).toBe(true);
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('disable() cancels session, sets none, removes keydown, isEnabled false', () => {
    const { map, translateStub } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    h.handlePointer(pointer('down', 10, 10));
    h.disable();
    expect(translateStub.cancel).toHaveBeenCalled();
    expect(map.setEditMode).toHaveBeenLastCalledWith('none');
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(h.isEnabled()).toBe(false);
  });

  it('down on an UNSELECTED hit passes through — no session, no select (selection is clickSelect\'s job)', () => {
    const { map, translateStub } = makeMap();
    // isSelected default false → not already selected.
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    const r = h.handlePointer(pointer('down', 30, 40));
    expect(r).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
    expect(map.editSession.beginTranslateSession).not.toHaveBeenCalled();
    expect(translateStub.cancel).not.toHaveBeenCalled();
    expect(h.getCursor()).toBe('move');
  });

  it('down on an ALREADY-selected feature (Option A): no select, begins the session, returns exclusive', () => {
    const { map } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    const r = h.handlePointer(pointer('down', 30, 40));
    expect(map.select).not.toHaveBeenCalled();
    expect(map.editSession.beginTranslateSession).toHaveBeenCalled();
    expect(r).toBe('exclusive');
  });

  it('translate mode returns move cursor while hovering an already-selected feature', () => {
    const { map } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    expect(h.handlePointer(pointer('move', 30, 40))).toBe('passthrough');
    expect(h.getCursor()).toBe('move');
  });

  it('translate mode has no cursor opinion when hover is not selected', () => {
    const { map } = makeMap();
    map.isSelected.mockReturnValue(false);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    h.handlePointer(pointer('move', 30, 40));
    expect(h.getCursor()).toBeNull();
  });

  it('keeps move cursor during an active translate session', () => {
    const { map } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    h.handlePointer(pointer('down', 30, 40));
    expect(h.getCursor()).toBe('move');
  });

  it('down on a miss passes through, no session, no select', () => {
    const { map } = makeMap();
    map.queryFeatures.mockReturnValueOnce([]);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    expect(h.handlePointer(pointer('down', 1, 1))).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
    expect(map.editSession.beginTranslateSession).not.toHaveBeenCalled();
  });

  it('passes configured layers to down and hover hit-testing', () => {
    const { map } = makeMap();
    map.queryFeatures.mockReturnValue([]);
    const h = new TransformFeatureHandler(map as any);
    h.setOptions({ layers: ['editable-roads'] });
    h.enable();

    h.handlePointer(pointer('down', 10, 20));
    h.handlePointer(pointer('move', 30, 40));

    expect(map.queryFeatures).toHaveBeenNthCalledWith(1, [10, 20], { layers: ['editable-roads'] });
    expect(map.queryFeatures).toHaveBeenNthCalledWith(2, [30, 40], { layers: ['editable-roads'] });
  });

  it('down with non-left button passes through', () => {
    const { map } = makeMap();
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    expect(h.handlePointer(pointer('down', 5, 5, 2))).toBe('passthrough');
    expect(map.queryFeatures).not.toHaveBeenCalled();
  });

  it('translate move streams expected (dx, dy) into the session', () => {
    const { map, translateStub } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    // unproject(x,y) = [x/10, y/10]. down at (100,100) → last = [10,10].
    h.handlePointer(pointer('down', 100, 100));
    // move to (150, 130) → cur = [15, 13]; dx=5, dy=3.
    const r = h.handlePointer(pointer('move', 150, 130));
    expect(translateStub.move).toHaveBeenCalledWith(5, 3);
    expect(r).toBe('exclusive');
  });

  it('up commits the translate session; subsequent move passes through', () => {
    const { map, translateStub } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    h.handlePointer(pointer('down', 100, 100));
    const up = h.handlePointer(pointer('up', 100, 100));
    expect(translateStub.commit).toHaveBeenCalled();
    expect(up).toBe('passthrough');
    expect(h.handlePointer(pointer('move', 200, 200))).toBe('passthrough');
  });

  it('rotate mode: down begins affine session, move applies a delta', () => {
    const { map, affineStub } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.setOptions({ mode: 'rotate' });
    h.enable();
    h.handlePointer(pointer('down', 100, 0));
    h.handlePointer(pointer('move', 0, 100));
    expect(map.editSession.beginAffineSession).toHaveBeenCalled();
    expect(affineStub.applyDelta).toHaveBeenCalled();
  });

  it('scale mode: move applies a scale delta', () => {
    const { map, affineStub } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.setOptions({ mode: 'scale' });
    h.enable();
    // origin [0,0]; down at (100,0) → cur [10,0], prevDist=10.
    h.handlePointer(pointer('down', 100, 0));
    // move to (200,0) → cur [20,0], dist=20, factor=2 ≠ 1.
    h.handlePointer(pointer('move', 200, 0));
    expect(affineStub.applyDelta).toHaveBeenCalled();
  });

  it('Escape mid-session cancels and clears the session', () => {
    const { map, translateStub } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    h.handlePointer(pointer('down', 100, 100));
    expect(keydownListener).toBeTypeOf('function');
    keydownListener!({ key: 'Escape' } as KeyboardEvent);
    expect(translateStub.cancel).toHaveBeenCalled();
    expect(h.handlePointer(pointer('move', 200, 200))).toBe('passthrough');
  });

  it('cross-mode editmodechange quiet-disables (cancel + isEnabled false, no extra setEditMode)', () => {
    const { map, translateStub, fireEditMode } = makeMap();
    map.isSelected.mockReturnValue(true);
    const h = new TransformFeatureHandler(map as any);
    h.enable();
    h.handlePointer(pointer('down', 100, 100));
    const callsBefore = map.setEditMode.mock.calls.length;
    fireEditMode('vertex');
    expect(translateStub.cancel).toHaveBeenCalled();
    expect(h.isEnabled()).toBe(false);
    expect(map.setEditMode.mock.calls.length).toBe(callsBefore);
  });
});

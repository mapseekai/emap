import { describe, it, expect, vi } from 'vitest';
import { EditStateStore, type EditStateChange } from './edit-state-store';
import type { EditDrawState, EditVertexState } from './types';

function makeStore() {
  const onChange = vi.fn<[EditStateChange], void>();
  const store = new EditStateStore(onChange);
  return { store, onChange };
}

const dummyVertex: EditVertexState = {
  shapes: [],
  arcs: { getArcIter: () => ({ x: 0, y: 0, hasNext: () => false }) },
  hoverVertex: null,
};

const dummyDraw: EditDrawState = {
  vertices: [],
  cursorCoord: null,
  snapCoord: null,
  snapKind: null,
  geometryType: 'polygon',
  drawColor: '#000',
};

describe('EditStateStore', () => {
  it('starts in mode=none with null overlays', () => {
    const { store } = makeStore();
    expect(store.mode).toBe('none');
    expect(store.vertex).toBeNull();
    expect(store.draw).toBeNull();
  });

  it('fires onChange exactly once per effective mutation', () => {
    const { store, onChange } = makeStore();
    store.setMode('vertex');
    store.setVertex(dummyVertex);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('skips onChange when the value is unchanged', () => {
    const { store, onChange } = makeStore();
    store.setMode('none');
    store.setVertex(null);
    store.clearDraw();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('auto-clears vertex state when leaving vertex mode', () => {
    const { store, onChange } = makeStore();
    store.setMode('vertex');
    store.setVertex(dummyVertex);
    onChange.mockClear();

    store.setMode('none');
    expect(store.vertex).toBeNull();
    // One coalesced change event for the mode flip + auto-clear.
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = onChange.mock.calls[0][0];
    expect(change.modeChanged).toBe(true);
    expect(change.previousMode).toBe('vertex');
    expect(change.current.vertex).toBeNull();
  });

  it('auto-clears draw state when leaving draw mode', () => {
    const { store } = makeStore();
    store.setMode('draw');
    store.setDraw(dummyDraw);
    store.setMode('vertex');
    expect(store.draw).toBeNull();
    expect(store.mode).toBe('vertex');
  });

  it('reports modeChanged=false on overlay-only mutations', () => {
    const { store, onChange } = makeStore();
    store.setMode('vertex');
    onChange.mockClear();

    store.setVertex(dummyVertex);
    const change = onChange.mock.calls[0][0];
    expect(change.modeChanged).toBe(false);
    expect(change.previousMode).toBe('vertex');
  });

  it('clearVertex / clearDraw are no-ops when already null', () => {
    const { store, onChange } = makeStore();
    store.clearVertex();
    store.clearDraw();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('EditStateStore — transform mode', () => {
  it("setMode('transform') drops vertex/draw sub-state and fires one change", () => {
    const { store, onChange } = makeStore();
    store.setMode('vertex');
    store.setVertex(dummyVertex);
    onChange.mockClear();
    store.setMode('transform');
    expect(store.mode).toBe('transform');
    expect(store.vertex).toBeNull();
    expect(store.draw).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ modeChanged: true, current: { mode: 'transform' } });
  });
});

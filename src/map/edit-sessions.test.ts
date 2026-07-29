import { describe, expect, it, vi } from 'vitest';
import { EditSessions } from './edit-sessions';
import { Selection } from './selection';
import { EditHistory } from '../edit/edit-history';
import { CompositeCommand } from '../edit/commands/composite';
import { LayerRegistry } from './layer-registry';
import type { EmapHostInternal } from './emap-host';
import type { TopologySource } from '../source/source';
import type { ArcCollection, MapshaperLayer } from '../types/mapshaper-types';

// `EditSessions` (692 lines) was 0%-tested. These tests cover the
// surface-level entry points (`translateSelected` / `rotateSelected` /
// `scaleSelected`) plus the live drag-session lifecycle
// (`beginTranslateSession` / `beginAffineSession`). Heavy algorithmic
// internals like `_buildSelectionBuckets` + split-shared-arcs are
// exercised via `splitSharedArcs: false` to keep these tests focused
// on session lifecycle correctness rather than topology mechanics.

// ----- mock builders --------------------------------------------------------

/** Tiny in-memory ArcCollection that supports translate's vertex math. */
function makeArcs(arcCount: number) {
  // 2 verts per arc, all at (0, 0). nn=[2,2,...].
  const xx = new Float64Array(arcCount * 2);
  const yy = new Float64Array(arcCount * 2);
  const nn = new Int32Array(arcCount).fill(2);
  const ii = new Int32Array(arcCount);
  for (let i = 0; i < arcCount; i++) ii[i] = i * 2;
  return {
    getVertexData: () => ({ xx, yy, nn, ii, zz: null }),
    updateArcBounds: vi.fn(),
    size: () => arcCount,
    getPointCount: () => arcCount * 2,
  } as unknown as ArcCollection & { _xx: Float64Array; _yy: Float64Array };
}

function makeSource(id: string, layers: MapshaperLayer[], arcs: ArcCollection): TopologySource {
  const dataset = { layers, arcs, info: {} } as any;
  return {
    id,
    getLayers: () => layers,
    getArcs: () => arcs,
    getDataset: () => dataset,
    setDataset: vi.fn(),
    refreshDisplayArcs: vi.fn(),
    markDisplayArcsDirty: vi.fn(),
  } as unknown as TopologySource;
}

function makeHost(): {
  host: EmapHostInternal;
  selection: Selection;
  history: EditHistory;
  sources: globalThis.Map<string, TopologySource>;
  scheduleRender: ReturnType<typeof vi.fn>;
  fireHistoryChange: ReturnType<typeof vi.fn>;
  invalidateShapeCaches: ReturnType<typeof vi.fn>;
  clearSpatialIndexes: ReturnType<typeof vi.fn>;
} {
  const sources = new globalThis.Map<string, TopologySource>();
  const selection = new Selection();
  const history = new EditHistory();
  const scheduleRender = vi.fn();
  const fireHistoryChange = vi.fn();
  const invalidateShapeCaches = vi.fn();
  const clearSpatialIndexes = vi.fn();
  const layers = new LayerRegistry(sources);
  const host: any = {
    _removed: false,
    _sources: sources,
    _selection: selection,
    _history: history,
    _activeTransaction: null,
    _validators: { size: 0 },
    _workerPool: null,
    _workerMode: false,
    _workerThreshold: 1e9,
    layers,
    _resolveLayer: (s: string, l: string) => layers.resolve(s, l),
    _scheduleRender: scheduleRender,
    _fireHistoryChange: fireHistoryChange,
    _fireSelectionChange: () => undefined,
    _invalidateShapeCachesForSources: invalidateShapeCaches,
    _clearSpatialIndexesForSources: clearSpatialIndexes,
    _allowExpressionEvaluation: () => true,
    fire: () => undefined,
  };
  return {
    host,
    selection,
    history,
    sources,
    scheduleRender,
    fireHistoryChange,
    invalidateShapeCaches,
    clearSpatialIndexes,
  };
}

function makePolyLayer(name: string, shapes: number[][][]): MapshaperLayer {
  return {
    name,
    geometry_type: 'polygon',
    shapes: shapes as unknown as MapshaperLayer['shapes'],
  };
}

describe('splitSharedNode', () => {
  it('executes the split, records history, and returns detached vertex ids', () => {
    let nn = new Int32Array([2, 2, 2, 2]);
    let xx = new Float64Array([-1, 0, 0, 1, 1, 1, 0, 0]);
    let yy = new Float64Array([0, 0, 0, 0, 0, 1, 0, -1]);
    let ii = new Int32Array([0, 2, 4, 6]);
    const arcs = {
      size: () => nn.length,
      getVertexData: () => ({ xx, yy, nn, ii, zz: null }),
      updateVertexData(nextNn: Int32Array, nextXx: Float64Array, nextYy: Float64Array) {
        nn = new Int32Array(nextNn);
        xx = new Float64Array(nextXx);
        yy = new Float64Array(nextYy);
        ii = new Int32Array(nn.length);
        let offset = 0;
        for (let i = 0; i < nn.length; i++) {
          ii[i] = offset;
          offset += nn[i];
        }
      },
    } as unknown as ArcCollection;
    const target = makePolyLayer('target', [[[0, 1, 2]]]);
    const neighbor = makePolyLayer('neighbor', [[[~1, 3]]]);
    const source = makeSource('src', [target, neighbor], arcs);
    const ctx = makeHost();
    ctx.sources.set('src', source);
    const sessions = new EditSessions(ctx.host);

    const detachedVertexIds = sessions.splitSharedNode(
      { source: 'src', layer: 'target', id: 0 },
      1,
    );

    expect(detachedVertexIds).toEqual([1, 8]);
    expect(arcs.size()).toBe(5);
    expect(target.shapes?.[0]).toEqual([[0, 4, 2]]);
    expect(ctx.history.canUndo()).toBe(true);
    expect(ctx.fireHistoryChange).toHaveBeenCalledTimes(1);
    expect(ctx.invalidateShapeCaches).toHaveBeenCalledWith(['src']);
    expect(ctx.scheduleRender).toHaveBeenCalledTimes(1);

    ctx.history.undo();
    expect(arcs.size()).toBe(4);
    expect(target.shapes?.[0]).toEqual([[0, 1, 2]]);
  });

  it('separates coordinate-only sharing without adding a no-op history entry', () => {
    let nn = new Int32Array([2, 2]);
    let xx = new Float64Array([0, 1, 0, 0]);
    let yy = new Float64Array([0, 0, 0, 1]);
    let ii = new Int32Array([0, 2]);
    const arcs = {
      size: () => nn.length,
      getVertexData: () => ({ xx, yy, nn, ii, zz: null }),
      updateVertexData(nextNn: Int32Array, nextXx: Float64Array, nextYy: Float64Array) {
        nn = new Int32Array(nextNn);
        xx = new Float64Array(nextXx);
        yy = new Float64Array(nextYy);
        ii = new Int32Array([0, nn[0]]);
      },
    } as unknown as ArcCollection;
    const target = makePolyLayer('target', [[[0]]]);
    const neighbor = makePolyLayer('neighbor', [[[1]]]);
    const source = makeSource('src', [target, neighbor], arcs);
    const ctx = makeHost();
    ctx.sources.set('src', source);

    const detachedVertexIds = new EditSessions(ctx.host).splitSharedNode(
      { source: 'src', layer: 'target', id: 0 },
      0,
    );

    expect(detachedVertexIds).toEqual([0]);
    expect(arcs.size()).toBe(2);
    expect(ctx.history.canUndo()).toBe(false);
    expect(ctx.fireHistoryChange).not.toHaveBeenCalled();
    expect(ctx.invalidateShapeCaches).not.toHaveBeenCalled();
    expect(ctx.scheduleRender).not.toHaveBeenCalled();
  });
});

// ============================================================================
// translateSelected — synchronous direct API (no session)
// ============================================================================

describe('translateSelected', () => {
  it('returns Err.validation when selection is empty', () => {
    const ctx = makeHost();
    const sessions = new EditSessions(ctx.host);
    const r = sessions.translateSelected(10, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      if (r.error.kind === 'validation') expect(r.error.field).toBe('selection');
    }
  });

  it('returns Err.validation when dx and dy are both zero', () => {
    const ctx = makeHost();
    ctx.selection.apply([{ source: 's1', layer: 'parks', id: 0 }], 'replace');
    const sessions = new EditSessions(ctx.host);
    const r = sessions.translateSelected(0, 0);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'validation') expect(r.error.field).toBe('offset');
  });

  it('happy path: pushes one history entry, fires historychange, schedules render', () => {
    const ctx = makeHost();
    const layer = makePolyLayer('parks', [[[0]]]);
    ctx.sources.set('s1', makeSource('s1', [layer], makeArcs(1)));
    ctx.selection.apply([{ source: 's1', layer: 'parks', id: 0 }], 'replace');
    const sessions = new EditSessions(ctx.host);
    const r = sessions.translateSelected(10, 20);
    expect(r.ok).toBe(true);
    expect(ctx.history.size()).toBe(1);
    expect(ctx.fireHistoryChange).toHaveBeenCalledTimes(1);
    expect(ctx.scheduleRender).toHaveBeenCalled();
  });

  it('multi-source selection wraps into a CompositeCommand', () => {
    const ctx = makeHost();
    ctx.sources.set('s1', makeSource('s1', [makePolyLayer('parks', [[[0]]])], makeArcs(1)));
    ctx.sources.set('s2', makeSource('s2', [makePolyLayer('roads', [[[0]]])], makeArcs(1)));
    ctx.selection.apply(
      [
        { source: 's1', layer: 'parks', id: 0 },
        { source: 's2', layer: 'roads', id: 0 },
      ],
      'replace',
    );
    const sessions = new EditSessions(ctx.host);
    const r = sessions.translateSelected(10, 20);
    expect(r.ok).toBe(true);
    expect(ctx.history.size()).toBe(1);
    const top = (ctx.history as any)._undoStack.at(-1);
    expect(top).toBeInstanceOf(CompositeCommand);
  });

  it('Err.validation when selection refs no resolvable layer', () => {
    const ctx = makeHost();
    // Source registered but layer missing.
    ctx.sources.set('s1', makeSource('s1', [], makeArcs(1)));
    ctx.selection.apply([{ source: 's1', layer: 'gone', id: 0 }], 'replace');
    const sessions = new EditSessions(ctx.host);
    const r = sessions.translateSelected(10, 20);
    expect(r.ok).toBe(false);
    expect(ctx.history.size()).toBe(0);
  });
});

// ============================================================================
// rotateSelected / scaleSelected
// ============================================================================

describe('rotateSelected / scaleSelected', () => {
  it('rotate 0 degrees is a no-op', () => {
    const ctx = makeHost();
    ctx.selection.apply([{ source: 's1', layer: 'l', id: 0 }], 'replace');
    const sessions = new EditSessions(ctx.host);
    const r = sessions.rotateSelected(0);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'validation') expect(r.error.field).toBe('angleDegrees');
  });

  it('scale 1x1 is a no-op', () => {
    const ctx = makeHost();
    ctx.selection.apply([{ source: 's1', layer: 'l', id: 0 }], 'replace');
    const sessions = new EditSessions(ctx.host);
    const r = sessions.scaleSelected(1, 1);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'validation') expect(r.error.field).toBe('scale');
  });

  it('rotate empty selection returns Err.validation', () => {
    const ctx = makeHost();
    const sessions = new EditSessions(ctx.host);
    expect(sessions.rotateSelected(45).ok).toBe(false);
  });

  it('happy path: rotate pushes one history entry', () => {
    const ctx = makeHost();
    ctx.sources.set('s1', makeSource('s1', [makePolyLayer('parks', [[[0]]])], makeArcs(1)));
    ctx.selection.apply([{ source: 's1', layer: 'parks', id: 0 }], 'replace');
    const sessions = new EditSessions(ctx.host);
    const r = sessions.rotateSelected(90, [0, 0]);
    expect(r.ok).toBe(true);
    expect(ctx.history.size()).toBe(1);
  });

  it('happy path: scale pushes one history entry', () => {
    const ctx = makeHost();
    ctx.sources.set('s1', makeSource('s1', [makePolyLayer('parks', [[[0]]])], makeArcs(1)));
    ctx.selection.apply([{ source: 's1', layer: 'parks', id: 0 }], 'replace');
    const sessions = new EditSessions(ctx.host);
    const r = sessions.scaleSelected(2, 2, [0, 0]);
    expect(r.ok).toBe(true);
    expect(ctx.history.size()).toBe(1);
  });
});

// ============================================================================
// beginTranslateSession — drag lifecycle
// ============================================================================

describe('beginTranslateSession', () => {
  function setup() {
    const ctx = makeHost();
    ctx.sources.set('s1', makeSource('s1', [makePolyLayer('parks', [[[0]]])], makeArcs(1)));
    ctx.selection.apply([{ source: 's1', layer: 'parks', id: 0 }], 'replace');
    return { ctx, sessions: new EditSessions(ctx.host) };
  }

  it('returns null for an empty selection', () => {
    const ctx = makeHost();
    const sessions = new EditSessions(ctx.host);
    expect(sessions.beginTranslateSession()).toBeNull();
  });

  it('move() does not push history entries — only commit() does', () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginTranslateSession({ splitSharedArcs: false })!;
    expect(session).not.toBeNull();
    session.move(5, 5);
    session.move(3, 2);
    expect(ctx.history.size()).toBe(0);
    session.commit();
    expect(ctx.history.size()).toBe(1);
  });

  it('move(0, 0) is a no-op (no render scheduled)', () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginTranslateSession({ splitSharedArcs: false })!;
    ctx.scheduleRender.mockClear();
    session.move(0, 0);
    expect(ctx.scheduleRender).not.toHaveBeenCalled();
  });

  it('getAccumulated reports cumulative offset', () => {
    const { sessions } = setup();
    const session = sessions.beginTranslateSession({ splitSharedArcs: false })!;
    session.move(10, 5);
    session.move(3, 2);
    session.move(-1, 0);
    expect(session.getAccumulated()).toEqual([12, 7]);
  });

  it('commit() with zero accumulated movement returns false (and no history)', () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginTranslateSession({ splitSharedArcs: false })!;
    expect(session.commit()).toBe(false);
    expect(ctx.history.size()).toBe(0);
  });

  it('commit() with movement returns true', () => {
    const { sessions } = setup();
    const session = sessions.beginTranslateSession({ splitSharedArcs: false })!;
    session.move(10, 5);
    expect(session.commit()).toBe(true);
  });

  it('cancel() does not push history (and drops accumulated state)', () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginTranslateSession({ splitSharedArcs: false })!;
    session.move(10, 5);
    session.cancel();
    expect(ctx.history.size()).toBe(0);
  });

  it('after commit(), further move()/commit() are no-ops', () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginTranslateSession({ splitSharedArcs: false })!;
    session.move(10, 5);
    session.commit();
    expect(ctx.history.size()).toBe(1);
    session.move(20, 20);
    expect(session.commit()).toBe(false); // already closed
    expect(ctx.history.size()).toBe(1); // unchanged
  });

  it('after cancel(), further move()/commit() are no-ops', () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginTranslateSession({ splitSharedArcs: false })!;
    session.move(10, 5);
    session.cancel();
    session.move(20, 20);
    expect(session.commit()).toBe(false);
    expect(ctx.history.size()).toBe(0);
  });
});

// ============================================================================
// beginAffineSession — rotate/scale lifecycle
// ============================================================================

describe('beginAffineSession', () => {
  function setup() {
    const ctx = makeHost();
    ctx.sources.set('s1', makeSource('s1', [makePolyLayer('parks', [[[0]]])], makeArcs(1)));
    ctx.selection.apply([{ source: 's1', layer: 'parks', id: 0 }], 'replace');
    return { ctx, sessions: new EditSessions(ctx.host) };
  }

  // Pass an explicit origin so we skip `_computeSelectionCentroid`'s
  // arc-walking path (which our minimal mock arcs don't support).
  const ORIGIN: [number, number] = [0, 0];
  const NO_SPLIT = { splitSharedArcs: false } as const;

  it('returns null for an empty selection', () => {
    const ctx = makeHost();
    const sessions = new EditSessions(ctx.host);
    expect(sessions.beginAffineSession()).toBeNull();
  });

  it('exposes a numeric origin pivot', () => {
    const { sessions } = setup();
    const session = sessions.beginAffineSession(ORIGIN, NO_SPLIT)!;
    expect(session).not.toBeNull();
    expect(Array.isArray(session.origin)).toBe(true);
    expect(session.origin.length).toBe(2);
    expect(Number.isFinite(session.origin[0])).toBe(true);
    expect(Number.isFinite(session.origin[1])).toBe(true);
  });

  it('applyDelta(IDENTITY) is a no-op (no render scheduled)', async () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginAffineSession(ORIGIN, NO_SPLIT)!;
    ctx.scheduleRender.mockClear();
    const { IDENTITY_MATRIX } = await import('../edit/commands/feature-affine');
    session.applyDelta(IDENTITY_MATRIX);
    expect(ctx.scheduleRender).not.toHaveBeenCalled();
  });

  it('commit() with no transform returns false and no history', () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginAffineSession(ORIGIN, NO_SPLIT)!;
    expect(session.commit()).toBe(false);
    expect(ctx.history.size()).toBe(0);
  });

  it('cancel() does not push history', () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginAffineSession(ORIGIN, NO_SPLIT)!;
    session.cancel();
    expect(ctx.history.size()).toBe(0);
  });

  it('applyDelta + commit pushes one history entry', async () => {
    const { ctx, sessions } = setup();
    const session = sessions.beginAffineSession(ORIGIN, NO_SPLIT)!;
    const { rotateMatrix } = await import('../edit/commands/feature-affine');
    session.applyDelta(rotateMatrix(Math.PI / 4, 0, 0));
    expect(session.commit()).toBe(true);
    expect(ctx.history.size()).toBe(1);
  });
});

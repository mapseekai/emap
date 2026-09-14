import { describe, expect, it, vi } from 'vitest';
import { Transaction } from './transaction';
import { EditHistory } from './edit-history';
import { Selection } from '../../engine/map/selection';
import { CompositeCommand } from './commands/composite';
import type { EditCommand } from './edit-command';
import type { EmapHostInternal } from '../../engine/map/emap-host';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';

// Minimal stub host. Only the bits Transaction touches need to be real.
function makeHost(): {
  host: EmapHostInternal;
  history: EditHistory;
  selection: Selection;
  fireHistoryChange: ReturnType<typeof vi.fn>;
  fireSelectionChange: ReturnType<typeof vi.fn>;
  scheduleRender: ReturnType<typeof vi.fn>;
  setDatasetCalls: Array<{ source: string; dataset: MapshaperDataset }>;
  registerSource: (id: string, initial: MapshaperDataset) => void;
} {
  const history = new EditHistory();
  const selection = new Selection();
  const sources = new globalThis.Map<
    string,
    {
      setDataset: (d: MapshaperDataset) => void;
      getDataset: () => MapshaperDataset;
      current: MapshaperDataset;
    }
  >();
  const setDatasetCalls: Array<{ source: string; dataset: MapshaperDataset }> = [];
  const fireHistoryChange = vi.fn();
  const fireSelectionChange = vi.fn();
  const scheduleRender = vi.fn();
  const host: any = {
    _removed: false,
    _sources: sources,
    _history: history,
    _selection: selection,
    _activeTransaction: null,
    _workerPool: null,
    _workerMode: false,
    _workerThreshold: 1e9,
    layers: { resolve: () => null },
    _resolveLayer: () => null,
    _scheduleRender: scheduleRender,
    _fireHistoryChange: fireHistoryChange,
    _fireSelectionChange: fireSelectionChange,
    _invalidateShapeCachesForSources: () => undefined,
    _clearSpatialIndexesForSources: () => undefined,
    _allowExpressionEvaluation: () => true,
    fire: () => undefined,
  };
  return {
    host,
    history,
    selection,
    fireHistoryChange,
    fireSelectionChange,
    scheduleRender,
    setDatasetCalls,
    registerSource(id, initial) {
      const entry = {
        current: initial,
        getDataset: () => entry.current,
        setDataset: (d: MapshaperDataset) => {
          entry.current = d;
          setDatasetCalls.push({ source: id, dataset: d });
        },
      };
      sources.set(id, entry as any);
    },
  };
}

function ds(label: string): MapshaperDataset {
  return {
    layers: [{ name: label, shapes: null, geometry_type: 'polygon' } as any],
    info: {},
  } as MapshaperDataset;
}

function makeCmd(
  label: string,
): EditCommand & { do: ReturnType<typeof vi.fn>; undo: ReturnType<typeof vi.fn> } {
  return { do: vi.fn(), undo: vi.fn(), label };
}

describe('Transaction', () => {
  it('captures pushed commands without growing the undo stack', () => {
    const ctx = makeHost();
    const tx = new Transaction(ctx.host);

    expect(ctx.host._activeTransaction).toBe(tx);
    expect(ctx.history.isCapturing()).toBe(true);

    ctx.history.push(makeCmd('a'));
    ctx.history.push(makeCmd('b'));
    expect(ctx.history.size()).toBe(0);
    expect(ctx.history.canUndo()).toBe(false);
  });

  it('commit drains the buffer into one CompositeCommand', async () => {
    const ctx = makeHost();
    const tx = new Transaction(ctx.host);
    ctx.history.push(makeCmd('a'));
    ctx.history.push(makeCmd('b'));
    ctx.history.push(makeCmd('c'));

    const r = await tx.commit('Bundle');
    expect(r.ok).toBe(true);
    expect(ctx.history.size()).toBe(1);
    expect(ctx.history.canUndo()).toBe(true);
    expect(ctx.fireHistoryChange).toHaveBeenCalledTimes(1);
    expect(ctx.host._activeTransaction).toBeNull();
    expect(ctx.history.isCapturing()).toBe(false);
  });

  it('commit with empty buffer is a no-op (no history entry, no event)', async () => {
    const ctx = makeHost();
    const tx = new Transaction(ctx.host);
    const r = await tx.commit('Empty');
    expect(r.ok).toBe(true);
    expect(ctx.history.size()).toBe(0);
    expect(ctx.fireHistoryChange).not.toHaveBeenCalled();
  });

  it('committed CompositeCommand keeps the supplied label', async () => {
    const ctx = makeHost();
    const tx = new Transaction(ctx.host);
    ctx.history.push(makeCmd('child'));
    await tx.commit('Outer');
    const top = (ctx.history as any)._undoStack.at(-1) as CompositeCommand;
    expect(top).toBeInstanceOf(CompositeCommand);
    expect(top.label).toBe('Outer');
  });

  it('rollback restores the snapshot for every source touched', () => {
    const ctx = makeHost();
    const before = ds('before');
    ctx.registerSource('s1', before);

    const tx = new Transaction(ctx.host);
    // Simulate two ops in a transaction: each calls _captureFirstTouch
    // BEFORE swapping — the runner would do this in _applyDatasetReplace.
    tx._captureFirstTouch('s1', before);
    ctx.host._sources.get('s1')!.setDataset(ds('after-1'));
    tx._captureFirstTouch('s1', ds('after-1')); // should NOT overwrite first-touch
    ctx.host._sources.get('s1')!.setDataset(ds('after-2'));

    tx.rollback();

    // After rollback, the source's dataset should equal `before`, not after-1.
    expect((ctx.host._sources.get('s1') as any).current).toBe(before);
    expect(ctx.host._activeTransaction).toBeNull();
    expect(ctx.scheduleRender).toHaveBeenCalled();
  });

  it('rollback restores the selection if the transaction modified it', () => {
    const ctx = makeHost();
    ctx.selection.apply(
      [
        { source: 's1', layer: 'l', id: 1 },
        { source: 's1', layer: 'l', id: 2 },
      ],
      'replace',
    );
    expect(ctx.selection.size).toBe(2);

    const tx = new Transaction(ctx.host);
    ctx.selection.clear();
    expect(ctx.selection.size).toBe(0);

    tx.rollback();
    expect(ctx.selection.size).toBe(2);
    expect(ctx.fireSelectionChange).toHaveBeenCalled();
  });

  it('rollback discards the capture buffer', () => {
    const ctx = makeHost();
    const tx = new Transaction(ctx.host);
    ctx.history.push(makeCmd('a'));
    ctx.history.push(makeCmd('b'));
    tx.rollback();
    expect(ctx.history.size()).toBe(0);
    expect(ctx.history.isCapturing()).toBe(false);
  });

  it('throws on nested begin', () => {
    const ctx = makeHost();
    new Transaction(ctx.host);
    expect(() => new Transaction(ctx.host)).toThrow(/already active/);
  });

  it('throws when commit/rollback is called twice', async () => {
    const ctx = makeHost();
    const tx1 = new Transaction(ctx.host);
    await tx1.commit('first');
    await expect(tx1.commit('again')).rejects.toThrow(/already committed/);

    const tx2 = new Transaction(ctx.host);
    tx2.rollback();
    expect(() => tx2.rollback()).toThrow(/already committed/);
  });

  it('isOpen flips on commit / rollback', async () => {
    const ctx = makeHost();
    const tx = new Transaction(ctx.host);
    expect(tx.isOpen).toBe(true);
    await tx.commit('x');
    expect(tx.isOpen).toBe(false);
  });

  it('settles rejected pending operations without leaking an unhandled rejection', async () => {
    const ctx = makeHost();
    const tx = new Transaction(ctx.host);
    tx._trackOperation(Promise.reject(new Error('operation failed')));

    const result = await tx.commit('failed operation');

    expect(result.ok).toBe(true);
    expect(tx.isOpen).toBe(false);
  });

  it('_captureFirstTouch only records the FIRST snapshot per source', () => {
    const ctx = makeHost();
    const tx = new Transaction(ctx.host);
    const a = ds('a');
    const b = ds('b');
    tx._captureFirstTouch('s1', a);
    tx._captureFirstTouch('s1', b);
    ctx.registerSource('s1', b);
    tx.rollback();
    expect((ctx.host._sources.get('s1') as any).current).toBe(a);
  });
});

describe('EditHistory.beginCapture / endCapture', () => {
  it('capture diverts push() into the buffer', () => {
    const h = new EditHistory();
    h.beginCapture();
    expect(h.isCapturing()).toBe(true);
    h.push(makeCmd('a'));
    h.push(makeCmd('b'));
    expect(h.size()).toBe(0);
    const buf = h.endCapture();
    expect(buf).toHaveLength(2);
    expect(h.isCapturing()).toBe(false);
  });

  it('endCapture without begin returns []', () => {
    const h = new EditHistory();
    expect(h.endCapture()).toEqual([]);
  });

  it('nested beginCapture throws', () => {
    const h = new EditHistory();
    h.beginCapture();
    expect(() => h.beginCapture()).toThrow(/nested/);
  });

  it('captured commands skip merge/barrier semantics', () => {
    const h = new EditHistory();
    h.beginCapture();
    // A barrier-flagged command in capture mode must NOT mark prior
    // commands stale, because there are no priors in the visible stack.
    h.push({ do: vi.fn(), undo: vi.fn(), invalidatesPriorCommands: true } as EditCommand);
    h.push(makeCmd('after'));
    const buf = h.endCapture();
    expect(buf).toHaveLength(2);
    expect(buf.every((c) => !c.stale)).toBe(true);
  });
});

describe('rollback with in-place (direct) commands', () => {
  function makeRollbackHost(source: { getDataset(): any; setDataset(d: any): void }) {
    return {
      _removed: false,
      _sources: new Map([['s', source]]),
      _history: new EditHistory(),
      _selection: new Selection(),
      _activeTransaction: null as any,
      _fireHistoryChange: vi.fn(),
      _fireSelectionChange: vi.fn(),
      _scheduleRender: vi.fn(),
    } as any;
  }

  it('reverse-undoes captured commands instead of relying on dataset snapshots', () => {
    // The dataset is a plain object mutated IN PLACE by the fake direct
    // commands — the snapshot the transaction holds is the same reference,
    // so only reverse-order undo() can revert it.
    const dataset: any = { layers: [], arcs: null, editVersion: 0, marker: 0 };
    const source = { getDataset: () => dataset, setDataset: vi.fn() };
    const host = makeRollbackHost(source);
    const t = new Transaction(host);
    host._activeTransaction = t;
    t._captureFirstTouch('s', dataset); // runner behavior for direct ops
    const order: string[] = [];
    const directA = {
      label: 'A',
      do: () => {
        dataset.marker = 1;
      },
      undo: () => {
        order.push('undoA');
        dataset.marker = 0;
      },
    };
    const directB = {
      label: 'B',
      do: () => {
        dataset.marker = 2;
      },
      undo: () => {
        order.push('undoB');
        dataset.marker = 1;
      },
    };
    host._history.push(directA); // diverted to capture buffer
    host._history.push(directB);
    directA.do();
    directB.do();
    t.rollback();
    expect(order).toEqual(['undoB', 'undoA']); // strict reverse order
    expect(dataset.marker).toBe(0); // in-place state actually reverted
    expect(host._history.size()).toBe(0);
    // Snapshot re-attach still happens (acts as data notification for the source).
    expect(source.setDataset).toHaveBeenCalledWith(dataset);
  });

  it('logs failed captured undos while continuing rollback', () => {
    const dataset = { layers: [], arcs: null, editVersion: 0 } as MapshaperDataset;
    const source = { getDataset: () => dataset, setDataset: vi.fn() };
    const host = makeRollbackHost(source);
    const t = new Transaction(host);
    const order: string[] = [];
    const failure = new Error('undo failed');
    host._activeTransaction = t;
    t._captureFirstTouch('s', dataset);
    host._history.push({
      label: 'succeeds',
      do: () => undefined,
      undo: () => {
        order.push('succeeds');
      },
    });
    host._history.push({
      label: 'fails',
      do: () => undefined,
      undo: () => {
        order.push('fails');
        throw failure;
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(() => t.rollback()).not.toThrow();
      expect(order).toEqual(['fails', 'succeeds']);
      expect(source.setDataset).toHaveBeenCalledWith(dataset);
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('fails'), failure);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('replacement-only rollback keeps working exactly as before', () => {
    const before: any = { layers: [], marker: 'before' };
    const after: any = { layers: [], marker: 'after' };
    let live = before;
    const source = {
      getDataset: () => live,
      setDataset: vi.fn((d: any) => {
        live = d;
      }),
    };
    const host = makeRollbackHost(source);
    const t = new Transaction(host);
    host._activeTransaction = t;
    t._captureFirstTouch('s', before);
    const replacement = {
      label: 'R',
      invalidatesPriorCommands: true,
      do: () => {
        live = after;
      },
      undo: () => {
        live = before;
      },
    };
    replacement.do();
    host._history.push(replacement);
    t.rollback();
    expect(live).toBe(before);
    expect(host._history.size()).toBe(0);
  });
});

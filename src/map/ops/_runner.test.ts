import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import { DatasetReplaceSelectionCommand } from '../../edit/commands/dataset-replace-selection';
import { EditHistory } from '../../edit/edit-history';
import { Selection } from '../selection';
import { Err } from '../op-result';
import {
  _runPreparedDatasetMutation,
  _runPreparedEditCommand,
  _runPreparedEditCommandMany,
  enqueueMultiSourceOperation,
  inferEffect,
} from './_runner';
import * as runnerModule from './_runner';

describe('inferEffect (PR-10)', () => {
  it.each([
    // shape-count: feature added / removed / reordered
    ['-target X -clip source=Y', 'shape-count'],
    ['-target X -erase source=Y', 'shape-count'],
    ['-target X -dissolve foo', 'shape-count'],
    ['-target X -dissolve2', 'shape-count'],
    ['-target X -explode', 'shape-count'],
    ['-target X -filter "this.pop > 100"', 'shape-count'],
    ['-target X -drop', 'shape-count'],
    ['-target X -buffer 5', 'shape-count'],
    ['-target X -mosaic', 'shape-count'],
    ['-target X,Y -union', 'shape-count'],
    ['-split-selected', 'shape-count'],

    // topology-only: arc storage rebuilt, feature ids stable
    ['-target X -clean', 'topology-only'],
    ['-target X -snap', 'topology-only'],
    ['-target X -simplify 10%', 'topology-only'],

    // attribute-only: only data table changes
    ['-target X -each "this.x = 1"', 'attribute-only'],
    ['-target X -join data.csv keys=k,s', 'attribute-only'],
    ['-target X -rename-fields A=B', 'attribute-only'],
    ['-target X -filter-fields a,b', 'attribute-only'],
    ['-target X -sort foo', 'feature-order'],

    // crs-only: coords reprojected
    ['-target X -proj EPSG:3857', 'crs-only'],
    ['-target X -project EPSG:3857', 'crs-only'],

    // strongest-effect rule: shape-count wins over the rest
    ['-target X -each "this.x = 1" -dissolve foo', 'shape-count'],
    ['-target X -sort foo -clean', 'feature-order'],

    // unknown command falls through to `unknown` (clear selection)
    ['-target X -wat', 'unknown'],
    ['-target X -fancy-new-op foo', 'unknown'],

    // empty / target-only ⇒ unknown (the runner won't invoke this with no
    // action anyway, but exercise the path)
    ['', 'unknown'],
    ['-target X', 'unknown'],
  ])('infers effect for %p as %p', (cmd, expected) => {
    expect(inferEffect(cmd)).toBe(expected);
  });
});

describe('prepared dataset mutation runner', () => {
  it('commits the payload and final selection in one history transition', async () => {
    const original = {
      layers: [{ name: 'original', geometry_type: 'polygon', shapes: [null] }],
    } as MapshaperDataset;
    const working = {
      layers: [{ name: 'working', geometry_type: 'polygon', shapes: [null] }],
    } as MapshaperDataset;
    const source = {
      getDataset: vi.fn(() => original),
      setDataset: vi.fn(),
      fire: vi.fn(),
    };
    const selection = new Selection();
    selection.apply([{ source: 'source', layer: 'roads', id: 9 }], 'replace');
    const host = {
      _activeTransaction: null,
      _removed: false,
      _sources: new Map([['source', source]]),
      _history: { push: vi.fn(), isCapturing: () => false },
      _selection: selection,
      _invalidateShapeCachesForSources: vi.fn(),
      _scheduleRender: vi.fn(),
      _fireHistoryChange: vi.fn(),
      _fireSelectionChange: vi.fn(),
      fire: vi.fn(),
    };
    const adapter = getDefaultMapshaperAdapter();
    const copyDataset = vi.spyOn(adapter, 'copyDataset').mockReturnValue(working);
    const refs = [
      { source: 'source', layer: 'roads', id: 0 },
      { source: 'source', layer: 'roads', id: 1 },
    ];

    try {
      const result = await _runPreparedDatasetMutation(
        host as never,
        'source',
        (value) => `Split ${value.count} features`,
        (dataset) => {
          dataset.layers[0].name = 'mutated';
          return { value: { count: 2 }, selection: refs };
        },
      );

      expect(result).toEqual({ ok: true, value: { count: 2 } });
      expect(source.setDataset).toHaveBeenCalledWith(working, false);
      expect(host._fireSelectionChange).toHaveBeenCalledTimes(1);
      expect(host._selection.getAll()).toEqual(refs);
      expect(host._history.push).toHaveBeenCalledWith(expect.any(DatasetReplaceSelectionCommand));
      expect(host._history.push.mock.calls[0][0]).toMatchObject({ label: 'Split 2 features' });
    } finally {
      copyDataset.mockRestore();
    }
  });

  it('undoes each cross-source commit to the selection that preceded it', async () => {
    const originalA = {
      layers: [{ name: 'a', geometry_type: 'polygon', shapes: [null] }],
    } as MapshaperDataset;
    const originalB = {
      layers: [{ name: 'b', geometry_type: 'polygon', shapes: [null] }],
    } as MapshaperDataset;
    const sourceA = {
      getDataset: vi.fn(() => originalA),
      setDataset: vi.fn(),
      fire: vi.fn(),
    };
    const sourceB = {
      getDataset: vi.fn(() => originalB),
      setDataset: vi.fn(),
      fire: vi.fn(),
    };
    const selection = new Selection();
    const initialRefs = [{ source: 'a', layer: 'roads', id: 9 }];
    const bRefs = [{ source: 'b', layer: 'roads', id: 1 }];
    const aRefs = [{ source: 'a', layer: 'roads', id: 2 }];
    selection.apply(initialRefs, 'replace');
    const history = { push: vi.fn(), isCapturing: () => false };
    const host = {
      _activeTransaction: null,
      _removed: false,
      _sources: new Map([
        ['a', sourceA],
        ['b', sourceB],
      ]),
      _history: history,
      _selection: selection,
      _invalidateShapeCachesForSources: vi.fn(),
      _scheduleRender: vi.fn(),
      _fireHistoryChange: vi.fn(),
      _fireSelectionChange: vi.fn(),
      fire: vi.fn(),
    };
    const adapter = getDefaultMapshaperAdapter();
    const copyDataset = vi.spyOn(adapter, 'copyDataset').mockImplementation((dataset) => ({
      ...dataset,
      layers: [...dataset.layers],
    }));
    const aStarted = Promise.withResolvers<void>();
    const aResult = Promise.withResolvers<{
      value: { count: number };
      selection: typeof aRefs;
    }>();

    try {
      const pendingA = _runPreparedDatasetMutation(host as never, 'a', 'split A', () => {
        aStarted.resolve();
        return aResult.promise;
      });
      await aStarted.promise;

      await _runPreparedDatasetMutation(host as never, 'b', 'split B', () => ({
        value: { count: 1 },
        selection: bRefs,
      }));
      aResult.resolve({ value: { count: 1 }, selection: aRefs });
      await pendingA;

      const [commitB, commitA] = history.push.mock.calls.map(([command]) => command);
      expect(selection.getAll()).toEqual(aRefs);
      (commitA as DatasetReplaceSelectionCommand).undo();
      expect(selection.getAll()).toEqual(bRefs);
      (commitB as DatasetReplaceSelectionCommand).undo();
      expect(selection.getAll()).toEqual(initialRefs);
    } finally {
      copyDataset.mockRestore();
    }
  });
});

describe('prepared parsed-command runner', () => {
  it('prepares an isolated working copy before parsed command dispatch', async () => {
    type PreparedRunner = (
      host: unknown,
      sourceId: string,
      commands: Array<{ name: string; options: Record<string, unknown> }>,
      label: string,
      prepare: (working: MapshaperDataset, original: MapshaperDataset) => void,
    ) => Promise<unknown>;
    const candidate = Reflect.get(runnerModule, '_runPreparedDatasetCommandParsed') as unknown;
    expect(candidate).toBeTypeOf('function');
    if (typeof candidate !== 'function') return;
    const runPrepared = candidate as PreparedRunner;

    const original = {
      layers: [{ name: 'original', geometry_type: 'polygon', shapes: [null] }],
    } as MapshaperDataset;
    const working = {
      layers: [{ name: 'working', geometry_type: 'polygon', shapes: [null] }],
    } as MapshaperDataset;
    const after = {
      layers: [{ name: 'after', geometry_type: 'polygon', shapes: [null] }],
    } as MapshaperDataset;
    const source = {
      getDataset: vi.fn(() => original),
      setDataset: vi.fn(),
      fire: vi.fn(),
    };
    const host = {
      _activeTransaction: null,
      _removed: false,
      _sources: new Map([['source', source]]),
      _workerPool: null,
      _workerMode: false,
      _workerThreshold: 50_000,
      _history: { push: vi.fn(), isCapturing: () => false },
      _selection: { clear: () => null },
      _invalidateShapeCachesForSources: vi.fn(),
      _scheduleRender: vi.fn(),
      _fireHistoryChange: vi.fn(),
      _fireSelectionChange: vi.fn(),
      fire: vi.fn(),
    };
    const adapter = getDefaultMapshaperAdapter();
    const copyDataset = vi.spyOn(adapter, 'copyDataset').mockReturnValue(working);
    let dispatched: MapshaperDataset | undefined;
    const runOnDatasetParsed = vi
      .spyOn(adapter, 'runOnDatasetParsed')
      .mockImplementation(async (_commands, dataset) => {
        dispatched = dataset;
        return after;
      });
    const prepare = vi.fn((dataset: MapshaperDataset) => {
      dataset.layers[0].name = 'prepared';
    });

    try {
      const result = await runPrepared(
        host,
        'source',
        [{ name: 'filter', options: { remove_empty: true } }],
        'Prepared command',
        prepare,
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prepare).toHaveBeenCalledWith(working, original);
      expect(dispatched).toBe(working);
      expect(dispatched?.layers[0].name).toBe('prepared');
      expect(original.layers[0].name).toBe('original');
      expect(source.setDataset).toHaveBeenCalledWith(after, false);
    } finally {
      copyDataset.mockRestore();
      runOnDatasetParsed.mockRestore();
    }
  });
});

describe('_runPreparedEditCommand', () => {
  function makeHost(source: any) {
    return {
      _removed: false,
      _sources: new Map([['s', source]]),
      _selection: new Selection(),
      _history: new EditHistory(),
      _activeTransaction: null,
      _scheduleRender: vi.fn(),
      _fireHistoryChange: vi.fn(),
      _fireSelectionChange: vi.fn(),
      _invalidateShapeCachesForSources: vi.fn(),
      _clearSpatialIndexesForSources: vi.fn(),
      fire: vi.fn(),
    } as any;
  }

  it('runs planner on the live dataset, commits the command, publishes once', async () => {
    const dataset = { layers: [], arcs: null, editVersion: 0 };
    const source = { getDataset: () => dataset, fire: vi.fn(), markDisplayArcsDirty: vi.fn() };
    const host = makeHost(source);
    const command = { do: vi.fn(), undo: vi.fn(), publish: vi.fn(), label: 'X' };
    const result = await _runPreparedEditCommand(host as any, 's', 'X', (planned, plannedSource) => {
      expect(planned).toBe(dataset); // live, NOT a copy
      expect(plannedSource).toBe(source);
      return { value: 42, command, affectedSourceIds: ['s'] };
    });
    expect(result).toEqual({ ok: true, value: 42 });
    expect(command.do).toHaveBeenCalledTimes(1);
    expect(command.publish).toHaveBeenCalledTimes(1);
    expect(host._history.size()).toBe(1);
    expect(host._fireHistoryChange).toHaveBeenCalledTimes(1);
    // Side effects ride on publish's data event — runner must NOT duplicate them:
    expect(host._invalidateShapeCachesForSources).not.toHaveBeenCalled();
    expect(host._scheduleRender).not.toHaveBeenCalled();
  });

  it('returns planner failure without touching history', async () => {
    const dataset = { layers: [], arcs: null };
    const source = { getDataset: () => dataset };
    const host = makeHost(source);
    const result = await _runPreparedEditCommand(host as any, 's', 'X', () =>
      Err.validation('ring', 'nope'),
    );
    expect(result.ok).toBe(false);
    expect(host._history.size()).toBe(0);
  });

  it('rejects with stale-operation when editVersion changed during planning', async () => {
    const dataset: any = { layers: [], arcs: null, editVersion: 0 };
    const source = { getDataset: () => dataset };
    const host = makeHost(source);
    const command = { do: vi.fn(), undo: vi.fn() };
    const result = await _runPreparedEditCommand(host as any, 's', 'X', () => {
      dataset.editVersion = 1; // concurrent edit slipped in
      return { value: undefined, command, affectedSourceIds: ['s'] };
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
    expect(command.do).not.toHaveBeenCalled();
    expect(host._history.size()).toBe(0);
  });

  it('undoes a throwing do() and reports a mapshaper error without pushing history', async () => {
    const dataset = { layers: [], arcs: null };
    const source = { getDataset: () => dataset };
    const host = makeHost(source);
    const command = {
      do: vi.fn(() => { throw new Error('boom'); }),
      undo: vi.fn(),
    };
    const result = await _runPreparedEditCommand(host as any, 's', 'X', () => ({
      value: undefined,
      command,
      affectedSourceIds: ['s'],
    }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'mapshaper' } });
    expect(command.undo).toHaveBeenCalledTimes(1);
    expect(host._history.size()).toBe(0);
  });

  it('diverts the command into an active transaction capture buffer', async () => {
    const dataset = { layers: [], arcs: null };
    const source = { getDataset: () => dataset };
    const host = makeHost(source);
    host._history.beginCapture();
    host._activeTransaction = {
      isOpen: true,
      _captureFirstTouch: vi.fn(),
      _trackOperation: vi.fn(),
    };
    const command = { do: vi.fn(), undo: vi.fn(), publish: vi.fn() };
    const result = await _runPreparedEditCommand(host as any, 's', 'X', () => ({
      value: undefined,
      command,
      affectedSourceIds: ['s'],
    }));
    expect(result.ok).toBe(true);
    expect(host._history.size()).toBe(0); // captured, not pushed
    expect(host._history.endCapture()).toEqual([command]);
    expect(host._fireHistoryChange).not.toHaveBeenCalled();
    expect(host._activeTransaction._captureFirstTouch).toHaveBeenCalledWith('s', dataset);
  });
});

describe('multi-source direct edit runner', () => {
  function makeHost(sources: Map<string, unknown>) {
    return {
      _removed: false,
      _sources: sources,
      _selection: new Selection(),
      _history: new EditHistory(),
      _activeTransaction: null,
      _scheduleRender: vi.fn(),
      _fireHistoryChange: vi.fn(),
      _fireSelectionChange: vi.fn(),
      _invalidateShapeCachesForSources: vi.fn(),
      _clearSpatialIndexesForSources: vi.fn(),
      fire: vi.fn(),
    } as any;
  }

  it('serializes intersecting source sets without blocking a disjoint operation', async () => {
    const host = makeHost(new Map());
    const releaseFirst = Promise.withResolvers<void>();
    const startedFirst = Promise.withResolvers<void>();
    const events: string[] = [];
    const first = enqueueMultiSourceOperation(host, ['a', 'b'], async () => {
      events.push('first:start');
      startedFirst.resolve();
      await releaseFirst.promise;
      events.push('first:end');
    });
    await startedFirst.promise;
    const overlapping = enqueueMultiSourceOperation(host, ['b', 'c'], async () => {
      events.push('overlap:start');
    });
    const disjoint = enqueueMultiSourceOperation(host, ['d'], async () => {
      events.push('disjoint:start');
    });

    await disjoint;
    expect(events).toEqual(['first:start', 'disjoint:start']);
    releaseFirst.resolve();
    await Promise.all([first, overlapping]);
    expect(events).toEqual(['first:start', 'disjoint:start', 'first:end', 'overlap:start']);
  });

  it('checks every unique source after planning before any child command runs', async () => {
    const datasetA: any = { layers: [], arcs: null, editVersion: 0 };
    const datasetB = { layers: [], arcs: null, editVersion: 0 };
    const commandA = { do: vi.fn(), undo: vi.fn() };
    const commandB = { do: vi.fn(), undo: vi.fn() };
    const host = makeHost(
      new Map([
        ['a', { getDataset: () => datasetA }],
        ['b', { getDataset: () => datasetB }],
      ]),
    );
    const plannedIds: string[] = [];

    const result = await _runPreparedEditCommandMany(host, ['a', 'b', 'a'], 'Reshape', (sourceId) => {
      plannedIds.push(sourceId);
      if (sourceId === 'b') datasetA.editVersion += 1;
      return {
        value: sourceId,
        command: sourceId === 'a' ? commandA : commandB,
        affectedSourceIds: [sourceId],
      };
    });

    expect(plannedIds).toEqual(['a', 'b']);
    expect(result).toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
    expect(commandA.do).not.toHaveBeenCalled();
    expect(commandB.do).not.toHaveBeenCalled();
    expect(host._history.size()).toBe(0);
  });

  it('restores completed children even when the failing child cannot undo', async () => {
    const datasetA = { layers: [], arcs: null };
    const datasetB = { layers: [], arcs: null };
    const commandA = { do: vi.fn(), undo: vi.fn(), publish: vi.fn() };
    const commandB = {
      do: vi.fn(() => {
        throw new Error('boom');
      }),
      undo: vi.fn(() => {
        throw new Error('never ran');
      }),
      publish: vi.fn(),
    };
    const host = makeHost(
      new Map([
        ['a', { getDataset: () => datasetA }],
        ['b', { getDataset: () => datasetB }],
      ]),
    );

    const result = await _runPreparedEditCommandMany(host, ['a', 'b'], 'Reshape', (sourceId) => ({
      value: sourceId,
      command: sourceId === 'a' ? commandA : commandB,
      affectedSourceIds: [sourceId],
    }));

    expect(result).toMatchObject({ ok: false, error: { kind: 'mapshaper' } });
    expect(commandA.undo).toHaveBeenCalledTimes(1);
    expect(commandB.undo).toHaveBeenCalledTimes(1);
    expect(host._history.size()).toBe(0);
    expect(host._fireHistoryChange).not.toHaveBeenCalled();
  });

  it('leaves an atomically rolled-back composite redoable when a later redo child throws', async () => {
    const datasetA = { layers: [], arcs: null };
    const datasetB = { layers: [], arcs: null };
    const state = { a: false, b: false };
    let failRedo = false;
    const commandA = {
      do: vi.fn(() => {
        state.a = true;
      }),
      undo: vi.fn(() => {
        state.a = false;
      }),
    };
    const commandB = {
      do: vi.fn(() => {
        state.b = true;
        if (failRedo) throw new Error('redo boom');
      }),
      undo: vi.fn(() => {
        state.b = false;
      }),
    };
    const host = makeHost(
      new Map([
        ['a', { getDataset: () => datasetA }],
        ['b', { getDataset: () => datasetB }],
      ]),
    );
    await _runPreparedEditCommandMany(host, ['a', 'b'], 'Reshape', (sourceId) => ({
      value: sourceId,
      command: sourceId === 'a' ? commandA : commandB,
      affectedSourceIds: [sourceId],
    }));
    host._history.undo();
    failRedo = true;

    expect(() => host._history.redo()).toThrow('redo boom');
    expect(state).toEqual({ a: false, b: false });
    expect(host._history.canRedo()).toBe(true);
  });

  it('returns a no-plan validation without history, publish, or transaction capture', async () => {
    const dataset = { layers: [], arcs: null };
    const host = makeHost(new Map([['a', { getDataset: () => dataset }]]));
    host._activeTransaction = {
      isOpen: true,
      _captureFirstTouch: vi.fn(),
      _trackOperation: vi.fn(),
    };

    const result = await _runPreparedEditCommandMany(host, ['a'], 'Reshape', () => null);

    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(host._history.size()).toBe(0);
    expect(host._fireHistoryChange).not.toHaveBeenCalled();
    expect(host._activeTransaction._captureFirstTouch).not.toHaveBeenCalled();
  });

  it('continues past a validation-only plan and commits another source', async () => {
    const datasetA = { layers: [], arcs: null };
    const datasetB = { layers: [], arcs: null };
    const command = { do: vi.fn(), undo: vi.fn(), publish: vi.fn() };
    const host = makeHost(
      new Map([
        ['a', { getDataset: () => datasetA }],
        ['b', { getDataset: () => datasetB }],
      ]),
    );

    const result = await _runPreparedEditCommandMany(host, ['a', 'b'], 'Reshape', (sourceId) =>
      sourceId === 'a'
        ? Err.validation('geometry', 'invalid')
        : { value: sourceId, command, affectedSourceIds: ['b'] },
    );

    expect(result).toEqual({ ok: true, value: ['b'] });
    expect(command.do).toHaveBeenCalledTimes(1);
    expect(host._history.size()).toBe(1);
  });

  it('captures only sources a planned command declares as affected', async () => {
    const datasetA = { layers: [], arcs: null };
    const datasetB = { layers: [], arcs: null };
    const command = { do: vi.fn(), undo: vi.fn() };
    const host = makeHost(
      new Map([
        ['a', { getDataset: () => datasetA }],
        ['b', { getDataset: () => datasetB }],
      ]),
    );
    host._activeTransaction = {
      isOpen: true,
      _captureFirstTouch: vi.fn(),
      _trackOperation: vi.fn(),
    };

    await _runPreparedEditCommandMany(host, ['a', 'b'], 'Reshape', (sourceId) =>
      sourceId === 'a' ? { value: undefined, command, affectedSourceIds: ['a'] } : null,
    );

    expect(host._activeTransaction._captureFirstTouch).toHaveBeenCalledTimes(1);
    expect(host._activeTransaction._captureFirstTouch).toHaveBeenCalledWith('a', datasetA);
  });

  it('rejects an affected source that was not locked before any child runs', async () => {
    const dataset = { layers: [], arcs: null };
    const command = { do: vi.fn(), undo: vi.fn() };
    const host = makeHost(new Map([['a', { getDataset: () => dataset }]]));

    const result = await _runPreparedEditCommandMany(host, ['a'], 'Reshape', () => ({
      value: undefined,
      command,
      affectedSourceIds: ['outside'],
    }));

    expect(result).toMatchObject({ ok: false, error: { kind: 'validation', field: 'source' } });
    expect(command.do).not.toHaveBeenCalled();
    expect(host._history.size()).toBe(0);
  });
});

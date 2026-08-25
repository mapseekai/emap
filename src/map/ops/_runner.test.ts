import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import { DatasetReplaceSelectionCommand } from '../../edit/commands/dataset-replace-selection';
import { Selection } from '../selection';
import { _runPreparedDatasetMutation, inferEffect } from './_runner';
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

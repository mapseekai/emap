import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { EditCommand } from '../../edit/edit-command';
import type { EmapHostInternal } from '../emap-host';
import { okValue, type OpResult } from '../op-result';
import { Selection } from '../selection';
import type { FeatureRef } from '../types';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { OpContext } from './_context';
import { _runPreparedEditCommand, _runPreparedEditCommandMany } from './_runner';
import { reshapeSelected } from './reshape-selected';

const FIXTURE_NAME = 'reshape-selected.geojson';

interface ReshapeStateSnapshot {
  layers: unknown;
  arcs: {
    count: number;
    ii: number[];
    nn: number[];
    xx: number[];
    yy: number[];
    zz: number[] | null;
  };
  referencedArcIds: number[];
  selection: unknown;
}

async function importDataset(
  yOffset = 0,
  selectedCoordinates: number[][] = [
    [0, 0],
    [10, 0],
  ],
): Promise<MapshaperDataset> {
  return getDefaultMapshaperAdapter().runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'selected' },
          geometry: {
            type: 'LineString',
            coordinates: selectedCoordinates.map(([x, y]) => [x, y + yOffset]),
          },
        },
        {
          type: 'Feature',
          properties: { name: 'unselected' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, yOffset + 10],
              [10, yOffset + 10],
            ],
          },
        },
      ],
    }),
  });
}

function exportCoordinates(dataset: MapshaperDataset): unknown[] {
  const file = getDefaultMapshaperAdapter().exportFileContent(dataset, { format: 'geojson' })[0]!;
  const collection = JSON.parse(String(file.content)) as GeoJSON.FeatureCollection;
  return collection.features.map((feature) => feature.geometry!.coordinates);
}

function referencedArcIds(dataset: MapshaperDataset): number[] {
  const ids = new Set<number>();
  for (const layer of dataset.layers) {
    for (const shape of layer.shapes ?? []) {
      if (!shape) continue;
      for (const reference of (shape as number[][]).flat())
        ids.add(reference < 0 ? ~reference : reference);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

function snapshotState(dataset: MapshaperDataset, selection: Selection): ReshapeStateSnapshot {
  const arcs = dataset.arcs!;
  const { ii, nn, xx, yy, zz } = arcs.getVertexData!();
  return {
    layers: dataset.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      geometryType: layer.geometry_type,
      shapes: structuredClone(layer.shapes),
      records: layer.data?.getRecords ? structuredClone(layer.data.getRecords()) : undefined,
    })),
    arcs: {
      count: arcs.size(),
      ii: Array.from(ii),
      nn: Array.from(nn),
      xx: Array.from(xx),
      yy: Array.from(yy),
      zz: zz ? Array.from(zz) : null,
    },
    referencedArcIds: referencedArcIds(dataset),
    selection: structuredClone(selection.getAll()),
  };
}

function expectAppendOnlyArcGrowth(prior: ReshapeStateSnapshot, next: ReshapeStateSnapshot): void {
  expect(next.arcs.count).toBeGreaterThan(prior.arcs.count);
  expect(next.arcs.ii.slice(0, prior.arcs.ii.length)).toEqual(prior.arcs.ii);
  expect(next.arcs.nn.slice(0, prior.arcs.nn.length)).toEqual(prior.arcs.nn);
  expect(next.arcs.xx.slice(0, prior.arcs.xx.length)).toEqual(prior.arcs.xx);
  expect(next.arcs.yy.slice(0, prior.arcs.yy.length)).toEqual(prior.arcs.yy);
  expect(next.arcs.zz?.slice(0, prior.arcs.zz?.length ?? 0) ?? null).toEqual(prior.arcs.zz);
  expect(
    prior.referencedArcIds.some(
      (arcId) => arcId < prior.arcs.count && !next.referencedArcIds.includes(arcId),
    ),
  ).toBe(true);
}

async function createFixture(
  refs: FeatureRef[] = [{ source: 'source', layer: 'reshape-selected', id: 0 }],
  selectedCoordinates?: number[][],
) {
  let dataset = await importDataset(0, selectedCoordinates);
  let before: MapshaperDataset | undefined;
  const undone: EditCommand[] = [];
  const entries: EditCommand[] = [];
  const selection = new Selection();
  selection.apply(refs, 'replace');
  const historyChange = vi.fn();
  const selectionChange = vi.fn();
  const source = {
    getDataset: () => dataset,
    getArcs: () => dataset.arcs,
    fire: vi.fn(),
  };
  const resolve = (layers: MapshaperDataset['layers'], sourceId: string, layerId: string) =>
    sourceId === 'source' && layerId === 'reshape-selected'
      ? (layers.find((layer) => layer.name === layerId) ?? null)
      : null;
  const host = {
    _removed: false,
    _activeTransaction: null,
    _selection: selection,
    _sources: new Map([['source', source]]),
    _history: {
      push: (command: EditCommand) => {
        entries.push(command);
        undone.length = 0;
      },
      isCapturing: () => false,
    },
    _fireHistoryChange: historyChange,
    _fireSelectionChange: selectionChange,
    fire: vi.fn(),
    layers: {
      resolve: (sourceId: string, layerId: string) => resolve(dataset.layers, sourceId, layerId),
      resolveInLayers: (layers: MapshaperDataset['layers'], layerId: string) =>
        layers.find((layer) => layer.name === layerId) ?? null,
    },
  } as unknown as EmapHostInternal;
  const ctx: OpContext = {
    host,
    runDatasetCommand: async () => ({ ok: true, value: undefined }),
    runDatasetCommandParsed: async () => ({ ok: true, value: undefined }),
    runPreparedDatasetCommandParsed: async () => ({ ok: true, value: undefined }),
    runPreparedDatasetMutation: async <T>(_sourceId, _label, mutate): Promise<OpResult<T>> => {
      const original = dataset;
      const working = getDefaultMapshaperAdapter().copyDataset(original);
      const outcome = await mutate(working, original);
      if ('ok' in outcome) return outcome;
      before = original;
      dataset = working;
      return okValue(outcome.value);
    },
    runPreparedEditCommand: (sourceId, label, plan) =>
      _runPreparedEditCommand(host, sourceId, label, plan),
    runPreparedEditCommandMany: (sourceIds, label, plan) =>
      _runPreparedEditCommandMany(host, sourceIds, label, plan),
  };
  return {
    ctx,
    host,
    dataset: () => dataset,
    historyEntries: () => entries.length,
    historyChanges: () => historyChange.mock.calls.length,
    selectionChanges: () => selectionChange.mock.calls.length,
    undo: () => {
      const command = entries.pop();
      if (command) {
        command.undo();
        command.publish?.();
        undone.push(command);
        return;
      }
      if (before) dataset = before;
    },
    redo: () => {
      const command = undone.pop();
      if (!command) return;
      command.do();
      command.publish?.();
      entries.push(command);
    },
  };
}

async function createMultiSourceFixture(aOffset = 0, bOffset = 0) {
  const aDataset = await importDataset(aOffset);
  let lastUndone: EditCommand | undefined;
  const bDataset = await importDataset(bOffset);
  const entries: EditCommand[] = [];
  const selection = new Selection();
  selection.apply(
    [
      { source: 'a', layer: 'reshape-selected', id: 0 },
      { source: 'b', layer: 'reshape-selected', id: 0 },
    ],
    'replace',
  );
  const historyChange = vi.fn();
  const selectionChange = vi.fn();
  const sourceA = {
    getDataset: () => aDataset,
    getArcs: () => aDataset.arcs,
    fire: vi.fn(),
  };
  const sourceB = {
    getDataset: () => bDataset,
    getArcs: () => bDataset.arcs,
    fire: vi.fn(),
  };
  const datasets = new Map([
    ['a', aDataset],
    ['b', bDataset],
  ]);
  const host = {
    _removed: false,
    _activeTransaction: null,
    _selection: selection,
    _sources: new Map([
      ['a', sourceA],
      ['b', sourceB],
    ]),
    _history: {
      push: (command: EditCommand) => entries.push(command),
      isCapturing: () => false,
    },
    _fireHistoryChange: historyChange,
    _fireSelectionChange: selectionChange,
    fire: vi.fn(),
    layers: {
      resolve: (sourceId: string, layerId: string) =>
        datasets.get(sourceId)?.layers.find((layer) => layer.name === layerId) ?? null,
      resolveInLayers: (layers: MapshaperDataset['layers'], layerId: string) =>
        layers.find((layer) => layer.name === layerId) ?? null,
    },
  } as unknown as EmapHostInternal;
  const ctx: OpContext = {
    host,
    runDatasetCommand: async () => okValue(undefined),
    runDatasetCommandParsed: async () => okValue(undefined),
    runPreparedDatasetCommandParsed: async () => okValue(undefined),
    runPreparedDatasetMutation: async <T>(): Promise<OpResult<T>> => okValue(undefined as T),
    runPreparedEditCommand: (sourceId, label, plan) =>
      _runPreparedEditCommand(host, sourceId, label, plan),
    runPreparedEditCommandMany: (sourceIds, label, plan) =>
      _runPreparedEditCommandMany(host, sourceIds, label, plan),
  };
  return {
    ctx,
    historyEntries: () => entries.length,
    dataset: (sourceId: 'a' | 'b') => datasets.get(sourceId)!,
    historyChanges: () => historyChange.mock.calls.length,
    selectionChanges: () => selectionChange.mock.calls.length,
    undo: () => {
      const command = entries.pop();
      if (!command) return;
      command.undo();
      command.publish?.();
      lastUndone = command;
    },
    redo: () => {
      if (!lastUndone) return;
      lastUndone.do();
      lastUndone.publish?.();
      entries.push(lastUndone);
      lastUndone = undefined;
    },
  };
}

describe('reshapeSelected', () => {
  it('keeps three direct reshapes as independent exact history stages', async () => {
    const refs = [{ source: 'source', layer: 'reshape-selected', id: 0 }];
    const fixture = await createFixture(refs);
    const liveDataset = fixture.dataset();
    const stages = [snapshotState(liveDataset, fixture.ctx.host._selection)];

    for (const y of [2, -2, 4]) {
      const prior = stages.at(-1)!;
      await expect(
        reshapeSelected(fixture.ctx, {
          line: [
            [3, 0],
            [5, y],
            [7, 0],
          ],
        }),
      ).resolves.toEqual({ ok: true, value: { reshapedCount: 1 } });
      expect(fixture.dataset()).toBe(liveDataset);
      expect(exportCoordinates(liveDataset)[0]).toEqual([
        [0, 0],
        [3, 0],
        [5, y],
        [7, 0],
        [10, 0],
      ]);
      const next = snapshotState(liveDataset, fixture.ctx.host._selection);
      expectAppendOnlyArcGrowth(prior, next);
      stages.push(next);
      expect(fixture.ctx.host._selection.getAll()).toEqual(refs);
    }

    expect(fixture.historyEntries()).toBe(3);
    expect(fixture.historyChanges()).toBe(3);
    expect(fixture.selectionChanges()).toBe(0);

    for (let index = 2; index >= 0; index--) {
      fixture.undo();
      expect(fixture.dataset()).toBe(liveDataset);
      expect(snapshotState(liveDataset, fixture.ctx.host._selection)).toEqual(stages[index]);
    }

    for (let index = 1; index <= 3; index++) {
      fixture.redo();
      expect(fixture.dataset()).toBe(liveDataset);
      expect(snapshotState(liveDataset, fixture.ctx.host._selection)).toEqual(stages[index]);
    }
  });

  it('preserves simplification thresholds through direct reshape history', async () => {
    const fixture = await createFixture(
      [{ source: 'source', layer: 'reshape-selected', id: 0 }],
      [
        [0, 0],
        [2, 0],
        [4, 0],
        [6, 0],
        [8, 0],
        [10, 0],
      ],
    );
    const dataset = fixture.dataset();
    const adapter = getDefaultMapshaperAdapter();
    await adapter.runOnDataset('-simplify 50%', dataset);
    const retained = dataset.arcs!.getRetainedInterval!();
    const before = snapshotState(dataset, fixture.ctx.host._selection);
    expect(retained).toBeGreaterThan(0);
    expect(exportCoordinates(dataset)[0]).toEqual([
      [0, 0],
      [2, 0],
      [6, 0],
      [10, 0],
    ]);

    await expect(
      reshapeSelected(fixture.ctx, {
        line: [
          [1, 0],
          [5, 2],
          [9, 0],
        ],
      }),
    ).resolves.toEqual({ ok: true, value: { reshapedCount: 1 } });

    expect(exportCoordinates(dataset)[0]).toEqual([
      [0, 0],
      [1, 0],
      [5, 2],
      [9, 0],
      [10, 0],
    ]);
    expect(dataset.arcs!.getRetainedInterval!()).toBe(retained);
    const after = snapshotState(dataset, fixture.ctx.host._selection);
    expectAppendOnlyArcGrowth(before, after);

    fixture.undo();
    expect(snapshotState(dataset, fixture.ctx.host._selection)).toEqual(before);
    expect(dataset.arcs!.getRetainedInterval!()).toBe(retained);
    fixture.redo();
    expect(snapshotState(dataset, fixture.ctx.host._selection)).toEqual(after);
    expect(dataset.arcs!.getRetainedInterval!()).toBe(retained);
  });

  it('commits contacted sources as one entry and undoes/redoes both together', async () => {
    const fixture = await createMultiSourceFixture();
    const beforeA = exportCoordinates(fixture.dataset('a'));
    const beforeB = exportCoordinates(fixture.dataset('b'));
    const originalArcCountA = fixture.dataset('a').arcs!.size();
    const originalArcCountB = fixture.dataset('b').arcs!.size();
    const reshaped = [
      [
        [0, 0],
        [3, 0],
        [5, 2],
        [7, 0],
        [10, 0],
      ],
      [
        [0, 10],
        [10, 10],
      ],
    ];

    await expect(
      reshapeSelected(fixture.ctx, {
        line: [
          [3, 0],
          [5, 2],
          [7, 0],
        ],
      }),
    ).resolves.toEqual({ ok: true, value: { reshapedCount: 2 } });
    expect(exportCoordinates(fixture.dataset('a'))).toEqual(reshaped);
    expect(exportCoordinates(fixture.dataset('b'))).toEqual(reshaped);
    expect(fixture.historyEntries()).toBe(1);
    expect(fixture.historyChanges()).toBe(1);
    expect(fixture.selectionChanges()).toBe(0);

    fixture.undo();
    expect(exportCoordinates(fixture.dataset('a'))).toEqual(beforeA);
    expect(fixture.dataset('a').arcs!.size()).toBe(originalArcCountA);
    expect(exportCoordinates(fixture.dataset('b'))).toEqual(beforeB);
    expect(fixture.dataset('b').arcs!.size()).toBe(originalArcCountB);
    fixture.redo();
    expect(exportCoordinates(fixture.dataset('a'))).toEqual(reshaped);
    expect(exportCoordinates(fixture.dataset('b'))).toEqual(reshaped);
  });

  it('continues after an earlier source has no contact', async () => {
    const fixture = await createMultiSourceFixture(20, 0);
    const beforeA = exportCoordinates(fixture.dataset('a'));
    const beforeB = exportCoordinates(fixture.dataset('b'));

    await expect(
      reshapeSelected(fixture.ctx, {
        line: [
          [3, 0],
          [5, 2],
          [7, 0],
        ],
      }),
    ).resolves.toEqual({ ok: true, value: { reshapedCount: 1 } });
    expect(exportCoordinates(fixture.dataset('a'))).toEqual(beforeA);
    expect(exportCoordinates(fixture.dataset('b'))).toEqual([
      [
        [0, 0],
        [3, 0],
        [5, 2],
        [7, 0],
        [10, 0],
      ],
      [
        [0, 10],
        [10, 10],
      ],
    ]);
    expect(beforeB).not.toEqual(exportCoordinates(fixture.dataset('b')));
    expect(fixture.historyEntries()).toBe(1);
    expect(fixture.historyChanges()).toBe(1);
    expect(fixture.selectionChanges()).toBe(0);
  });

  it('rejects a line that does not contact two points of a selected feature', async () => {
    const fixture = await createFixture();
    await expect(
      reshapeSelected(fixture.ctx, {
        line: [
          [5, 1],
          [5, -1],
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'line' },
    });
    expect(fixture.historyEntries()).toBe(0);
    expect(fixture.historyChanges()).toBe(0);
  });

  it('reshapes selected polygon target layers', async () => {
    const fixture = await createFixture();
    fixture.dataset().layers[0]!.geometry_type = 'polygon';
    await expect(
      reshapeSelected(fixture.ctx, {
        line: [
          [3, 0],
          [5, 2],
          [7, 0],
        ],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { reshapedCount: 1 },
    });
  });

  it('reshapes contacted features without any selection', async () => {
    const fixture = await createFixture([]);
    await expect(
      reshapeSelected(fixture.ctx, {
        line: [
          [3, 0],
          [5, 2],
          [7, 0],
        ],
      }),
    ).resolves.toEqual({
      ok: true,
      value: { reshapedCount: 1 },
    });
    expect(exportCoordinates(fixture.dataset())).toEqual([
      [
        [0, 0],
        [3, 0],
        [5, 2],
        [7, 0],
        [10, 0],
      ],
      [
        [0, 10],
        [10, 10],
      ],
    ]);
  });

  it('reshapes every contacted feature, not just selected ones', async () => {
    const fixture = await createFixture();
    await expect(
      reshapeSelected(fixture.ctx, {
        line: [
          [3, 0],
          [5, 2],
          [7, 0],
          [5, 4],
          [3, 10],
          [5, 12],
          [7, 10],
        ],
      }),
    ).resolves.toEqual({ ok: true, value: { reshapedCount: 2 } });
    expect(exportCoordinates(fixture.dataset())).toEqual([
      [
        [0, 0],
        [3, 0],
        [5, 2],
        [7, 0],
        [10, 0],
      ],
      [
        [0, 10],
        [3, 10],
        [5, 12],
        [7, 10],
        [10, 10],
      ],
    ]);
  });

  it('rejects a reshape whose prepared edit version becomes stale', async () => {
    const fixture = await createFixture();
    const before = exportCoordinates(fixture.dataset());
    fixture.ctx.runPreparedEditCommandMany = <T>(sourceIds, label, plan) =>
      _runPreparedEditCommandMany(fixture.host, sourceIds, label, (sourceId, planned, source) => {
        const outcome = plan(sourceId, planned, source);
        planned.editVersion = (planned.editVersion ?? 0) + 1;
        return outcome;
      });
    await expect(
      reshapeSelected(fixture.ctx, {
        line: [
          [3, 0],
          [5, 2],
          [7, 0],
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'stale-operation' },
    });
    expect(exportCoordinates(fixture.dataset())).toEqual(before);
    expect(fixture.historyChanges()).toBe(0);
  });
});

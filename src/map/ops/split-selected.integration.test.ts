import { describe, expect, it, vi } from 'vitest';
import { EditHistory } from '../../edit/edit-history';
import { Transaction } from '../../edit/transaction';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { EmapHostInternal } from '../emap-host';
import { MapshaperOps } from '../mapshaper-ops';
import { Selection } from '../selection';
import { _runPreparedDatasetMutation } from './_runner';
import * as splitLine from './split-selected-line';
import type { FeatureRef } from '../types';
async function importDataset(features: GeoJSON.Feature[]): Promise<MapshaperDataset> {
  return getDefaultMapshaperAdapter().runImport('-i split-selected.geojson', {
    'split-selected.geojson': JSON.stringify({ type: 'FeatureCollection', features }),
  });
}

function line(coordinates: number[][], properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates } };
}

function polygon(
  coordinates: number[][][],
  properties: Record<string, unknown> = {},
): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates } };
}
function point(coordinates: number[], properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates } };
}

function exportFeatures(dataset: MapshaperDataset): GeoJSON.Feature[] {
  const [file] = getDefaultMapshaperAdapter().exportFileContent(dataset, { format: 'geojson' });
  return (JSON.parse(String(file!.content)) as GeoJSON.FeatureCollection).features;
}

function polygonArea(coordinates: number[][][]): number {
  return Math.abs(
    coordinates[0]!.reduce(
      (sum, [x, y], index, ring) =>
        sum + x! * ring[(index + 1) % ring.length]![1]! - y! * ring[(index + 1) % ring.length]![0]!,
      0,
    ) / 2,
  );
}

interface SplitHarness {
  source: { getDataset(): MapshaperDataset; fire: () => void };
  selection: Selection;
  history: { entries: unknown[] };
  events: { selection: () => void; history: () => void };
}

function expectNoSplitSideEffects(
  state: SplitHarness,
  original: MapshaperDataset,
  selection: readonly FeatureRef[],
) {
  expect(state.source.getDataset()).toBe(original);
  expect(state.source.getDataset().layers).toEqual(original.layers);
  expect(state.selection.getAll()).toEqual(selection);
  expect(state.history.entries).toHaveLength(0);
  expect(state.events.selection).not.toHaveBeenCalled();
  expect(state.events.history).not.toHaveBeenCalled();
  expect(state.source.fire).not.toHaveBeenCalled();
}

function addLayer(dataset: MapshaperDataset, name: string): void {
  dataset.layers.push({ name, geometry_type: 'point', shapes: [] } as MapshaperLayer);
}

function harness(
  dataset: MapshaperDataset,
  selected: number[],
): {
  ops: MapshaperOps;
  host: EmapHostInternal;
  source: {
    getDataset(): MapshaperDataset;
    getLayers(): MapshaperLayer[];
    setDataset(value: MapshaperDataset): void;
    fire: ReturnType<typeof vi.fn>;
  };
  selection: Selection;
  history: { entries: unknown[]; push(entry: unknown): void; isCapturing(): boolean };
  events: { selection: ReturnType<typeof vi.fn>; history: ReturnType<typeof vi.fn> };
} {
  let current = dataset;
  const source = {
    getDataset: () => current,
    getLayers: () => current.layers,
    setDataset: (value: MapshaperDataset) => {
      current = value;
    },
    fire: vi.fn(),
  };
  const selection = new Selection();
  selection.apply(
    selected.map((id) => ({ source: 'source', layer: 'split-selected', id })),
    'replace',
  );
  const history = {
    entries: [] as unknown[],
    push(entry: unknown) {
      this.entries.push(entry);
    },
    isCapturing: () => false,
  };
  const events = { selection: vi.fn(), history: vi.fn() };
  const host = {
    _activeTransaction: null,
    _removed: false,
    _sources: new Map([['source', source]]),
    _history: history,
    _selection: selection,
    layers: {
      resolve: (sourceId: string, layerId: string) =>
        sourceId === 'source'
          ? (current.layers.find(
              (candidate) => candidate.name === layerId || candidate.id === layerId,
            ) ?? null)
          : null,
      resolveInLayers: (layers: readonly MapshaperLayer[], layerId: string) =>
        layers.find((candidate) => candidate.name === layerId || candidate.id === layerId) ?? null,
    },
    _invalidateShapeCachesForSources: vi.fn(),
    _scheduleRender: vi.fn(),
    _fireHistoryChange: events.history,
    _fireSelectionChange: events.selection,
    fire: vi.fn(),
  };
  const typedHost = host as unknown as EmapHostInternal; // complete runner host surface is intentionally limited to exercised paths
  return { ops: new MapshaperOps(typedHost), host: typedHost, source, selection, history, events };
}

describe('MapshaperOps.splitSelected integration', () => {
  it('keeps the unequal largest line piece at the original id, preserves its schema, and emits one data event', async () => {
    const dataset = await importDataset([
      line(
        [
          [0, 0],
          [10, 0],
        ],
        { name: 'road' },
      ),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    const fields = dataset.layers[0]!.data!.getFields!();
    const { ops, source, selection, history, events } = harness(dataset, [0]);

    const result = await ops.splitSelected({ cutter: { type: 'point', coordinates: [8, 0] } });

    expect(result).toMatchObject({
      ok: true,
      value: {
        splitTargetCount: 1,
        resultFeatures: [
          { source: 'source', layer: 'split-selected', id: 0 },
          { source: 'source', layer: 'split-selected', id: 1 },
        ],
      },
    });
    const split = source.getDataset();
    const records = split.layers[0]!.data!.getRecords!();
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(records[1]);
    expect(records[0]).not.toBe(records[1]);
    expect(split.layers[0]!.data!.getFields!()).toEqual(fields);
    const features = exportFeatures(split);
    expect(features.map((feature) => feature.geometry!.coordinates)).toEqual([
      [
        [0, 0],
        [8, 0],
      ],
      [
        [8, 0],
        [10, 0],
      ],
    ]);
    expect(split.layers).toHaveLength(1);
    expect(selection.getAll()).toEqual(result.ok ? result.value.resultFeatures : []);
    expect(history.entries).toHaveLength(1);
    expect(events.selection).toHaveBeenCalledTimes(1);
    expect(events.history).toHaveBeenCalledTimes(1);
    expect(source.fire).toHaveBeenCalledTimes(1);
    expect(source.fire).toHaveBeenCalledWith('data', { reason: 'replace' });
    const entry = history.entries[0] as { label: string; undo(): void; do(): void };
    expect(entry.label).toBe('Split 1 feature');
    entry.undo();
    expect(source.getDataset()).toBe(dataset);
    expect(selection.getAll()).toEqual([{ source: 'source', layer: 'split-selected', id: 0 }]);
    entry.do();
    expect(selection.getAll()).toHaveLength(2);
  });

  it('keeps unhit selected and unselected original ids while appending split results after every original feature', async () => {
    const dataset = await importDataset([
      line(
        [
          [0, 0],
          [10, 0],
        ],
        { id: 'first' },
      ),
      line(
        [
          [0, 10],
          [10, 10],
        ],
        { id: 'unhit' },
      ),
      line(
        [
          [0, 20],
          [10, 20],
        ],
        { id: 'last' },
      ),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    const { ops, source } = harness(dataset, [0, 1]);

    const result = await ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } });

    expect(result).toMatchObject({
      ok: true,
      value: { splitTargetCount: 1, resultFeatures: [{ id: 0 }, { id: 1 }, { id: 3 }] },
    });
    const records = source.getDataset().layers[0]!.data!.getRecords!();
    expect(records.map((record) => record.id)).toEqual(['first', 'unhit', 'last', 'first']);
    expect(new Set(records).size).toBe(records.length);
  });

  it('preserves layers without an attribute table and exports only the target layer after cleanup', async () => {
    const dataset = await importDataset([
      line([
        [0, 0],
        [10, 0],
      ]),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    dataset.layers[0]!.data = undefined;
    const { ops, source } = harness(dataset, [0]);

    await expect(
      ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
    ).resolves.toMatchObject({ ok: true });
    const split = source.getDataset();
    expect(split.layers).toHaveLength(1);
    expect(split.layers[0]!.data).toBeUndefined();
    const output = getDefaultMapshaperAdapter().exportFileContent(split, { format: 'geojson' });
    expect(output).toHaveLength(1);
  });

  it('rejects malformed cutters and point polygon cutters atomically', async () => {
    const dataset = await importDataset([
      polygon([
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ]),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    const state = harness(dataset, [0]);
    const beforeSelection = state.selection.getAll();
    const invalid = {
      cutter: {
        type: 'polyline',
        coordinates: [
          [0, 0],
          [0, 0],
        ],
      },
    } as unknown as Parameters<MapshaperOps['splitSelected']>[0];
    await expect(state.ops.splitSelected(invalid)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'cutter' },
    });
    await expect(
      state.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 5] } }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'validation', field: 'cutter' } });
    expectNoSplitSideEffects(state, dataset, beforeSelection);
  });

  it('rejects empty, non-finite, cross-layer, missing-shape, null-shape, and point-target selections atomically', async () => {
    const emptyDataset = await importDataset([
      line([
        [0, 0],
        [10, 0],
      ]),
    ]);
    emptyDataset.layers[0]!.name = 'split-selected';
    const empty = harness(emptyDataset, []);
    await expect(
      empty.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'selection' },
    });
    expectNoSplitSideEffects(empty, emptyDataset, []);

    const finiteDataset = await importDataset([
      line([
        [0, 0],
        [10, 0],
      ]),
    ]);
    finiteDataset.layers[0]!.name = 'split-selected';
    const nonFinite = harness(finiteDataset, [0]);
    const nonFiniteSelection = nonFinite.selection.getAll();
    await expect(
      nonFinite.ops.splitSelected({
        cutter: { type: 'point', coordinates: [Number.POSITIVE_INFINITY, 0] },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'cutter' },
    });
    expectNoSplitSideEffects(nonFinite, finiteDataset, nonFiniteSelection);

    const crossDataset = await importDataset([
      line([
        [0, 0],
        [10, 0],
      ]),
    ]);
    crossDataset.layers[0]!.name = 'split-selected';
    addLayer(crossDataset, 'other');
    const crossLayer = harness(crossDataset, [0]);
    crossLayer.selection.apply([{ source: 'source', layer: 'other', id: 0 }], 'add');
    const crossSelection = crossLayer.selection.getAll();
    await expect(
      crossLayer.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'selection' },
    });
    expectNoSplitSideEffects(crossLayer, crossDataset, crossSelection);

    for (const corrupt of [
      (dataset: MapshaperDataset) => {
        dataset.layers[0]!.shapes = undefined;
      },
      (dataset: MapshaperDataset) => {
        dataset.layers[0]!.shapes![0] = null;
      },
    ]) {
      const corruptDataset = await importDataset([
        line([
          [0, 0],
          [10, 0],
        ]),
      ]);
      corruptDataset.layers[0]!.name = 'split-selected';
      corrupt(corruptDataset);
      const corruptState = harness(corruptDataset, [0]);
      const corruptSelection = corruptState.selection.getAll();
      await expect(
        corruptState.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'validation' },
      });
      expectNoSplitSideEffects(corruptState, corruptDataset, corruptSelection);
    }

    const pointDataset = await importDataset([point([5, 0])]);
    pointDataset.layers[0]!.name = 'split-selected';
    const pointTarget = harness(pointDataset, [0]);
    const pointSelection = pointTarget.selection.getAll();
    await expect(
      pointTarget.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'layer' },
    });
    expectNoSplitSideEffects(pointTarget, pointDataset, pointSelection);
  });
  it.each([
    [
      'invalid-only',
      [0],
      (dataset: MapshaperDataset) => {
        dataset.layers[0]!.shapes![0] = [[999]];
      },
    ],
    [
      'bitwise-alias arc id',
      [0],
      (dataset: MapshaperDataset) => {
        dataset.layers[0]!.shapes![0] = [[-4294967297]];
      },
    ],
    [
      'unsafe arc id',
      [0],
      (dataset: MapshaperDataset) => {
        dataset.layers[0]!.shapes![0] = [[Number.MAX_SAFE_INTEGER + 1]];
      },
    ],
    [
      'mixed-valid-invalid',
      [0, 1],
      (dataset: MapshaperDataset) => {
        dataset.layers[0]!.shapes![1] = [[999]];
      },
    ],
  ] as const)('rejects %s polyline geometry atomically', async (_name, selected, corrupt) => {
    const dataset = await importDataset([
      line([
        [0, 0],
        [10, 0],
      ]),
      line([
        [0, 10],
        [10, 10],
      ]),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    corrupt(dataset);
    const state = harness(dataset, selected);
    const beforeSelection = state.selection.getAll();

    await expect(
      state.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        kind: 'validation',
        field: 'geometry',
        reason: 'selected polyline geometry is invalid',
      },
    });
    expectNoSplitSideEffects(state, dataset, beforeSelection);
  });
  it('returns observable facade errors for mixed selections and missing source or layer without events', async () => {
    const dataset = await importDataset([
      line([
        [0, 0],
        [10, 0],
      ]),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    const mixed = harness(dataset, [0]);
    mixed.selection.apply([{ source: 'other', layer: 'split-selected', id: 0 }], 'add');
    const mixedSelection = mixed.selection.getAll();
    await expect(
      mixed.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'selection' },
    });
    expectNoSplitSideEffects(mixed, dataset, mixedSelection);

    const missingLayer = harness(dataset, [0]);
    missingLayer.selection.apply([{ source: 'source', layer: 'missing', id: 0 }], 'replace');
    const missingLayerSelection = missingLayer.selection.getAll();
    await expect(
      missingLayer.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-found', what: 'layer' },
    });
    expectNoSplitSideEffects(missingLayer, dataset, missingLayerSelection);

    const missingSource = harness(dataset, [0]);
    missingSource.selection.apply(
      [{ source: 'missing', layer: 'split-selected', id: 0 }],
      'replace',
    );
    const missingSourceSelection = missingSource.selection.getAll();
    await expect(
      missingSource.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-found', what: 'source' },
    });
    expectNoSplitSideEffects(missingSource, dataset, missingSourceSelection);
  });
  it('splits a real polygon through the facade, returning refs whose exported pieces preserve area', async () => {
    const dataset = await importDataset([
      polygon(
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
        { name: 'parcel' },
      ),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    const { ops, source, history, selection, events } = harness(dataset, [0]);
    const result = await ops.splitSelected({
      cutter: {
        type: 'polyline',
        coordinates: [
          [-1, 5],
          [11, 5],
        ],
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        splitTargetCount: 1,
        resultFeatures: [
          { source: 'source', layer: 'split-selected', id: 0 },
          { source: 'source', layer: 'split-selected', id: 1 },
        ],
      },
    });
    const exported = exportFeatures(source.getDataset());
    const coordinates = exported.map((feature) => feature.geometry!.coordinates as number[][][]);
    expect(coordinates).toHaveLength(2);
    expect(coordinates.map(polygonArea)).toEqual([50, 50]);
    expect(coordinates.reduce((sum, coordinate) => sum + polygonArea(coordinate), 0)).toBe(100);
    const records = source.getDataset().layers[0]!.data!.getRecords!();
    expect(records[0]).toEqual(records[1]);
    expect(records[0]).not.toBe(records[1]);

    const untouched = source.getDataset();
    const beforeSelection = selection.getAll();
    const beforeHistory = history.entries.length;
    const beforeSelectionEvents = events.selection.mock.calls.length;
    const beforeDataEvents = source.fire.mock.calls.length;
    const beforeHistoryEvents = events.history.mock.calls.length;
    const noCut = await ops.splitSelected({
      cutter: {
        type: 'polyline',
        coordinates: [
          [-1, 20],
          [11, 20],
        ],
      },
    });
    expect(noCut).toMatchObject({ ok: false, error: { kind: 'validation', field: 'cutter' } });
    expect(source.getDataset()).toBe(untouched);
    expect(selection.getAll()).toEqual(beforeSelection);
    expect(history.entries).toHaveLength(beforeHistory);
    expect(events.selection).toHaveBeenCalledTimes(beforeSelectionEvents);
    expect(events.history).toHaveBeenCalledTimes(beforeHistoryEvents);
    expect(source.fire).toHaveBeenCalledTimes(beforeDataEvents);
  });
  it('rolls split transactions back exactly and commits them as one undoable selection step', async () => {
    const original = await importDataset([
      line(
        [
          [0, 0],
          [10, 0],
        ],
        { name: 'road' },
      ),
    ]);
    original.layers[0]!.name = 'split-selected';
    const rollback = harness(original, [0]);
    const rollbackHistory = new EditHistory();
    rollback.host._history = rollbackHistory;
    const beforeSelection = rollback.selection.getAll();

    const rollbackTx = new Transaction(rollback.host);
    await expect(
      rollback.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
    ).resolves.toMatchObject({ ok: true, value: { splitTargetCount: 1 } });
    expect(rollback.source.getDataset()).not.toBe(original);
    rollbackTx.rollback();
    expect(rollback.source.getDataset()).toBe(original);
    expect(rollback.selection.getAll()).toEqual(beforeSelection);
    expect(rollbackHistory.size()).toBe(0);

    const committedOriginal = await importDataset([
      line(
        [
          [0, 0],
          [10, 0],
        ],
        { name: 'road' },
      ),
    ]);
    committedOriginal.layers[0]!.name = 'split-selected';
    const committed = harness(committedOriginal, [0]);
    const committedHistory = new EditHistory();
    committed.host._history = committedHistory;
    const committedBeforeSelection = committed.selection.getAll();
    const commitTx = new Transaction(committed.host);
    const split = await committed.ops.splitSelected({
      cutter: { type: 'point', coordinates: [5, 0] },
    });
    expect(split).toMatchObject({ ok: true, value: { splitTargetCount: 1 } });
    const splitDataset = committed.source.getDataset();

    await expect(commitTx.commit('Split transaction')).resolves.toMatchObject({ ok: true });
    expect(committedHistory.size()).toBe(1);
    committedHistory.undo();
    expect(committed.source.getDataset()).toBe(committedOriginal);
    expect(committed.selection.getAll()).toEqual(committedBeforeSelection);
    committedHistory.redo();
    expect(committed.source.getDataset()).toBe(splitDataset);
    expect(committed.selection.getAll()).toEqual(split.ok ? split.value.resultFeatures : []);
  });

  it.each([
    [
      'adds a layer',
      (working: MapshaperDataset) => {
        working.layers.unshift({
          name: 'prior-layer',
          geometry_type: 'point',
          shapes: [],
        } as MapshaperLayer);
      },
      ['prior-layer', 'split-selected', 'retained'],
    ],
    [
      'reorders layers',
      (working: MapshaperDataset) => {
        working.layers.reverse();
      },
      ['retained', 'split-selected'],
    ],
    [
      'removes a layer',
      (working: MapshaperDataset) => {
        working.layers.splice(1, 1);
      },
      ['split-selected'],
    ],
  ] as const)('rejects a split queued behind a prior mutation that %s while preserving its result', async (_name, mutate, expectedLayers) => {
    const dataset = await importDataset([
      line(
        [
          [0, 0],
          [10, 0],
        ],
        { name: 'road' },
      ),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    addLayer(dataset, 'retained');
    const { ops, host, source, selection, history, events } = harness(dataset, [0]);
    const releasePrior = Promise.withResolvers<void>();
    const priorStarted = Promise.withResolvers<void>();
    const prior = _runPreparedDatasetMutation(host, 'source', 'Prior mutation', async (working) => {
      priorStarted.resolve();
      await releasePrior.promise;
      mutate(working);
      return { value: undefined, selection: selection.getAll() };
    });
    await priorStarted.promise;
    const pendingSplit = ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } });
    releasePrior.resolve();
    await expect(prior).resolves.toMatchObject({ ok: true });
    const afterPrior = source.getDataset();
    const selectionAfterPrior = selection.getAll();
    const historyCount = history.entries.length;
    const dataEvents = source.fire.mock.calls.length;
    const selectionEvents = events.selection.mock.calls.length;
    const historyEvents = events.history.mock.calls.length;

    await expect(pendingSplit).resolves.toMatchObject({
      ok: false,
      error: { kind: 'stale-operation' },
    });
    expect(source.getDataset()).toBe(afterPrior);
    expect(source.getDataset().layers.map((layer) => layer.name)).toEqual(expectedLayers);
    expect(
      source.getDataset().layers.some((layer) => layer.name?.startsWith('__emap_split_selected')),
    ).toBe(false);
    expect(selection.getAll()).toEqual(selectionAfterPrior);
    expect(history.entries).toHaveLength(historyCount);
    expect(source.fire).toHaveBeenCalledTimes(dataEvents);
    expect(events.selection).toHaveBeenCalledTimes(selectionEvents);
    expect(events.history).toHaveBeenCalledTimes(historyEvents);
  });

  it('splits a selected complemented arc while preserving its reversed exported orientation', async () => {
    const dataset = await importDataset([
      line(
        [
          [0, 0],
          [10, 0],
        ],
        { name: 'reversed' },
      ),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    dataset.layers[0]!.shapes![0] = [[-1]];
    const { ops, source, selection } = harness(dataset, [0]);

    const result = await ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } });

    expect(result).toMatchObject({
      ok: true,
      value: {
        splitTargetCount: 1,
        resultFeatures: [
          { source: 'source', layer: 'split-selected', id: 0 },
          { source: 'source', layer: 'split-selected', id: 1 },
        ],
      },
    });
    expect(
      exportFeatures(source.getDataset()).map((feature) => feature.geometry!.coordinates),
    ).toEqual([
      [
        [10, 0],
        [5, 0],
      ],
      [
        [5, 0],
        [0, 0],
      ],
    ]);
    expect(selection.getAll()).toEqual(result.ok ? result.value.resultFeatures : []);
  });

  it('returns mapshaper errors from a splitter seam without committing split side effects', async () => {
    const dataset = await importDataset([
      line(
        [
          [0, 0],
          [10, 0],
        ],
        { name: 'road' },
      ),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    const { ops, source, selection, history, events } = harness(dataset, [0]);
    const beforeSelection = selection.getAll();
    const throwFromSplitter = vi
      .spyOn(splitLine, 'splitSelectedPolylines')
      .mockImplementationOnce(() => {
        throw new Error('injected splitter failure');
      });

    try {
      await expect(
        ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } }),
      ).resolves.toMatchObject({ ok: false, error: { kind: 'mapshaper' } });
    } finally {
      throwFromSplitter.mockRestore();
    }
    expect(source.getDataset()).toBe(dataset);
    expect(selection.getAll()).toEqual(beforeSelection);
    expect(history.entries).toHaveLength(0);
    expect(events.selection).not.toHaveBeenCalled();
    expect(events.history).not.toHaveBeenCalled();
    expect(source.fire).not.toHaveBeenCalled();
  });
});

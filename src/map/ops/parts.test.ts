import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { EmapHostInternal } from '../emap-host';
import { MapshaperOps } from '../mapshaper-ops';
import type { MapshaperDataset, MapshaperLayer } from '../../types/mapshaper-types';
import type { FeatureRef } from '../types';
import type { OpContext } from './_context';
import { Err, okValue, type OpResult } from '../op-result';
import { Selection } from '../selection';
import { addPart, deletePart } from './parts';
import { shapeSegments, shoelaceArea } from './geometry-2d';

const adapter = getDefaultMapshaperAdapter();
type Position = [number, number];
type PathGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.LineString | GeoJSON.MultiLineString;

async function importDataset(geometry: PathGeometry): Promise<MapshaperDataset> {
  return adapter.runImport('-i "parts.geojson"', {
    'parts.geojson': JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'selected' }, geometry }],
    }),
  });
}

function exported(dataset: MapshaperDataset): PathGeometry {
  const file = adapter.exportFileContent(dataset, { format: 'geojson' })[0]!;
  const collection = JSON.parse(String(file.content)) as GeoJSON.FeatureCollection;
  return collection.features[0]!.geometry as PathGeometry;
}

async function createFixture(geometry: PathGeometry, refs: FeatureRef[] = [{ source: 'source', layer: 'parts', id: 0 }]) {
  let dataset = await importDataset(geometry);
  const source = { getDataset: () => dataset };
  const resolve = (layers: MapshaperDataset['layers'], sourceId: string, layerId: string) =>
    sourceId === 'source' && layerId === 'parts' ? (layers.find((layer) => layer.name === layerId) ?? null) : null;
  const host = {
    _selection: { getAll: () => refs },
    _sources: new Map([['source', source]]),
    layers: {
      resolve: (sourceId: string, layerId: string) => resolve(dataset.layers, sourceId, layerId),
      resolveInLayers: (layers: MapshaperDataset['layers'], layerId: string) => layers.find((layer) => layer.name === layerId) ?? null,
    },
  } as unknown as EmapHostInternal;
  const ctx: OpContext = {
    host,
    runDatasetCommand: async () => okValue(undefined),
    runDatasetCommandParsed: async () => okValue(undefined),
    runPreparedDatasetCommandParsed: async () => okValue(undefined),
    runPreparedDatasetMutation: async <T>(_sourceId, _label, mutate): Promise<OpResult<T>> => {
      const original = dataset;
      const outcome = await mutate(adapter.copyDataset(original), original);
      if ('ok' in outcome) return outcome;
      dataset = adapter.copyDataset(original);
      const committed = await mutate(dataset, original);
      return 'ok' in committed ? committed : okValue(committed.value);
    },
  };
  return { ctx, dataset: () => dataset };
}

function integrationHarness(dataset: MapshaperDataset, selectionRefs: FeatureRef[] = [{ source: 'source', layer: 'parts', id: 0 }]) {
  let current = dataset;
  const source = { getDataset: () => current, getLayers: () => current.layers, setDataset: (value: MapshaperDataset) => { current = value; }, fire: vi.fn() };
  const selection = new Selection();
  selection.apply(selectionRefs, 'replace');
  const history = { entries: [] as Array<{ undo(): void }>, push(entry: { undo(): void }) { this.entries.push(entry); }, isCapturing: () => false };
  const host = {
    _activeTransaction: null, _removed: false, _sources: new Map([['source', source]]), _history: history, _selection: selection,
    layers: {
      resolve: (sourceId: string, layerId: string) => sourceId === 'source' ? (current.layers.find((layer) => layer.name === layerId || layer.id === layerId) ?? null) : null,
      resolveInLayers: (layers: readonly MapshaperLayer[], layerId: string) => layers.find((layer) => layer.name === layerId || layer.id === layerId) ?? null,
    },
    _invalidateShapeCachesForSources: vi.fn(), _scheduleRender: vi.fn(), _fireHistoryChange: vi.fn(), _fireSelectionChange: vi.fn(), fire: vi.fn(),
  } as unknown as EmapHostInternal;
  return { ops: new MapshaperOps(host), source, selection, history };
}

const square: Position[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe('addPart', () => {
  it('adds an independent polygon exterior with the existing exterior orientation', async () => {
    const fixture = await createFixture({ type: 'Polygon', coordinates: [square] });
    await expect(addPart(fixture.ctx, { coordinates: [[20, 0], [30, 0], [30, 10], [20, 10]] })).resolves.toEqual({ ok: true, value: undefined });
    const shape = fixture.dataset().layers[0]!.shapes![0]!;
    expect(shape).toHaveLength(2);
    const first = shoelaceArea(shapeSegments([shape[0]!], fixture.dataset().arcs!).map(([start]) => start));
    const second = shoelaceArea(shapeSegments([shape[1]!], fixture.dataset().arcs!).map(([start]) => start));
    expect(Math.sign(first)).toBe(Math.sign(second));
  });

  it('rejects a stale prepared dataset without mutating or recording history', async () => {
    const fixture = await createFixture({ type: 'Polygon', coordinates: [square] });
    const before = exported(fixture.dataset());
    let historyEntries = 0;
    fixture.ctx.runPreparedDatasetMutation = async <T>(_sourceId, _label, mutate): Promise<OpResult<T>> => {
      const dataset = fixture.dataset();
      const result = await mutate(adapter.copyDataset(dataset), { ...dataset });
      if (result.ok) historyEntries++;
      return result;
    };

    await expect(addPart(fixture.ctx, { coordinates: [[20, 0], [30, 0], [30, 10], [20, 10]] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'stale-operation' },
    });
    expect(exported(fixture.dataset())).toEqual(before);
    expect(historyEntries).toBe(0);
  });

  it('allows an island inside an existing hole', async () => {
    const fixture = await createFixture({ type: 'Polygon', coordinates: [square, [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]]] });
    await expect(addPart(fixture.ctx, { coordinates: [[3, 3], [5, 3], [5, 5], [3, 5]] })).resolves.toMatchObject({ ok: true });
    const shape = fixture.dataset().layers[0]!.shapes![0]!;
    expect(shape).toHaveLength(3);
  });

  it.each([
    ['overlap', [[8, 2], [12, 2], [12, 6], [8, 6]]],
    ['crosses a boundary', [[-1, 4], [5, 4], [5, 6], [-1, 6]]],
    ['encloses an existing exterior', [[-1, -1], [11, -1], [11, 11], [-1, 11]]],
  ])('rejects a polygon part that %s', async (_name, coordinates) => {
    const fixture = await createFixture({ type: 'Polygon', coordinates: [square] });
    await expect(addPart(fixture.ctx, { coordinates })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'part' },
    });
  });

  it('adds an independent line part', async () => {
    const fixture = await createFixture({ type: 'LineString', coordinates: [[0, 0], [10, 0]] });
    await expect(addPart(fixture.ctx, { coordinates: [[0, 2], [10, 2]] })).resolves.toEqual({ ok: true, value: undefined });
    expect(exported(fixture.dataset())).toEqual({ type: 'MultiLineString', coordinates: [[[0, 0], [10, 0]], [[0, 2], [10, 2]]] });
  });

  it.each([
    ['has fewer than two vertices', [[1, 1]]],
    ['self-intersects', [[0, 2], [4, 6], [0, 6], [4, 2]]],
    ['conflicts with an existing line', [[0, 0], [10, 0]]],
  ])('rejects a line part that %s', async (_name, coordinates) => {
    const fixture = await createFixture({ type: 'LineString', coordinates: [[0, 0], [10, 0]] });
    await expect(addPart(fixture.ctx, { coordinates })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'part' },
    });
  });

  it('rejects a zero-area polygon part', async () => {
    const fixture = await createFixture({ type: 'Polygon', coordinates: [square] });
    await expect(addPart(fixture.ctx, { coordinates: [[20, 0], [25, 0], [30, 0]] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'part' },
    });
  });
});

describe('deletePart', () => {
  it('deletes a polygon island and a hole by hit point', async () => {
    const geometry: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [[square, [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]]], [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]]] };
    const islandFixture = await createFixture(geometry);
    await expect(deletePart(islandFixture.ctx, { point: [25, 5] })).resolves.toMatchObject({ ok: true });
    expect((exported(islandFixture.dataset()) as GeoJSON.Polygon).coordinates).toHaveLength(2);
    const holeFixture = await createFixture(geometry);
    await expect(deletePart(holeFixture.ctx, { point: [3, 3] })).resolves.toMatchObject({ ok: true });
    expect((exported(holeFixture.dataset()) as GeoJSON.MultiPolygon).coordinates[0]).toHaveLength(1);
  });

  it('deletes an island before the enclosing hole when their hit areas overlap', async () => {
    const fixture = await createFixture({
      type: 'Polygon',
      coordinates: [square, [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]]],
    });
    await expect(addPart(fixture.ctx, { coordinates: [[3, 3], [5, 3], [5, 5], [3, 5]] })).resolves.toMatchObject({ ok: true });
    await expect(deletePart(fixture.ctx, { point: [4, 4] })).resolves.toMatchObject({ ok: true });
    const shape = fixture.dataset().layers[0]!.shapes![0]!;
    expect(shape).toHaveLength(2);
    const exteriorArea = shoelaceArea(shapeSegments([shape[0]!], fixture.dataset().arcs!).map(([start]) => start));
    const remainingArea = shoelaceArea(shapeSegments([shape[1]!], fixture.dataset().arcs!).map(([start]) => start));
    expect(Math.sign(remainingArea)).toBe(-Math.sign(exteriorArea));
  });

  it('deletes the closest line part within tolerance', async () => {
    const fixture = await createFixture({ type: 'MultiLineString', coordinates: [[[0, 0], [10, 0]], [[0, 5], [10, 5]]] });
    await expect(deletePart(fixture.ctx, { point: [4, 5.2], tolerance: 0.25 })).resolves.toMatchObject({ ok: true });
    expect(exported(fixture.dataset())).toEqual({ type: 'LineString', coordinates: [[0, 0], [10, 0]] });
  });

  it('deletes the whole feature when its last part is removed, without any selection', async () => {
    const single = await createFixture({ type: 'Polygon', coordinates: [square] }, []);
    await expect(deletePart(single.ctx, { point: [5, 5] })).resolves.toMatchObject({ ok: true });
    expect(single.dataset().layers[0]!.shapes).toHaveLength(0);
    expect(single.dataset().layers[0]!.data?.getRecords?.()).toHaveLength(0);
  });

  it('drops the removed feature from the selection through the real runner', async () => {
    const dataset = await importDataset({ type: 'Polygon', coordinates: [square] });
    dataset.layers[0]!.name = 'parts';
    const fixture = integrationHarness(dataset);
    await expect(fixture.ops.deletePart({ point: [5, 5] })).resolves.toEqual({ ok: true, value: undefined });
    expect(fixture.source.getDataset().layers[0]!.shapes).toHaveLength(0);
    expect(fixture.selection.getAll()).toEqual([]);
  });

  it('drops alias-addressed refs of the removed feature from the selection', async () => {
    const dataset = await importDataset({ type: 'Polygon', coordinates: [square] });
    dataset.layers[0]!.name = 'parts';
    dataset.layers[0]!.id = 'parts-alias';
    const fixture = integrationHarness(dataset, [{ source: 'source', layer: 'parts-alias', id: 0 }]);
    await expect(fixture.ops.deletePart({ point: [5, 5] })).resolves.toEqual({ ok: true, value: undefined });
    expect(fixture.selection.getAll()).toEqual([]);
  });

  it('propagates non-validation runner failures instead of reporting a miss', async () => {
    const fixture = await createFixture({ type: 'Polygon', coordinates: [square] });
    fixture.ctx.runPreparedDatasetMutation = async () => Err.hostRemoved();
    await expect(deletePart(fixture.ctx, { point: [5, 5] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'host-removed' },
    });
  });

  it('rejects a line point outside tolerance', async () => {
    const line = await createFixture({ type: 'MultiLineString', coordinates: [[[0, 0], [10, 0]], [[0, 5], [10, 5]]] });
    await expect(deletePart(line.ctx, { point: [4, 3], tolerance: 0.25 })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'part', reason: 'no part near the point' },
    });
  });

  it('records one undoable history entry and restores selection', async () => {
    const dataset = await importDataset({ type: 'Polygon', coordinates: [square] });
    dataset.layers[0]!.name = 'parts';
    const before = exported(dataset);
    const fixture = integrationHarness(dataset);
    await expect(fixture.ops.addPart({ coordinates: [[20, 0], [30, 0], [30, 10], [20, 10]] })).resolves.toEqual({ ok: true, value: undefined });
    expect(fixture.history.entries).toHaveLength(1);
    expect(fixture.selection.getAll()).toEqual([{ source: 'source', layer: 'parts', id: 0 }]);
    fixture.history.entries[0]!.undo();
    expect(exported(fixture.source.getDataset())).toEqual(before);
    expect(fixture.selection.getAll()).toEqual([{ source: 'source', layer: 'parts', id: 0 }]);
  });
});

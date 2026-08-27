import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { EmapHostInternal } from '../emap-host';
import { Err, okValue, type OpResult } from '../op-result';
import type { FeatureRef } from '../types';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { MapshaperLayer } from '../../types/mapshaper-types';
import type { OpContext } from './_context';
import { MapshaperOps } from '../mapshaper-ops';
import { Selection } from '../selection';
import { addRing, deleteRing } from './rings';
import { collectPolygonExteriors } from './reshape-selected-polygon';

const adapter = getDefaultMapshaperAdapter();
const FIXTURE_NAME = 'rings.geojson';
type Position = [number, number];

async function importDataset(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): Promise<MapshaperDataset> {
  const geometries = Array.isArray(geometry) ? geometry : [geometry];
  return adapter.runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({
      type: 'FeatureCollection',
      features: geometries.map((entry, index) => ({
        type: 'Feature',
        properties: { name: `feature-${index}` },
        geometry: entry,
      })),
    }),
  });
}

function exported(dataset: MapshaperDataset): GeoJSON.Polygon {
  const file = adapter.exportFileContent(dataset, { format: 'geojson' })[0]!;
  const collection = JSON.parse(String(file.content)) as GeoJSON.FeatureCollection;
  return collection.features[0]!.geometry as GeoJSON.Polygon;
}

async function createFixture(
  rings: Position[][] = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
  refs: FeatureRef[] = [{ source: 'source', layer: 'rings', id: 0 }],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | Array<GeoJSON.Polygon | GeoJSON.MultiPolygon> = { type: 'Polygon', coordinates: rings },
) {
  let dataset = await importDataset(geometry);
  let before: MapshaperDataset | undefined;
  const source = { getDataset: () => dataset };
  const resolve = (layers: MapshaperDataset['layers'], sourceId: string, layerId: string) =>
    sourceId === 'source' && layerId === 'rings'
      ? (layers.find((layer) => layer.name === layerId) ?? null)
      : null;
  const host = {
    _selection: { getAll: () => refs },
    _sources: new Map([['source', source]]),
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
      const working = adapter.copyDataset(original);
      const outcome = await mutate(working, original);
      if ('ok' in outcome) return outcome;
      before = original;
      dataset = working;
      return okValue(outcome.value);
    },
  };
  return { ctx, dataset: () => dataset, refs, undo: () => { if (before) dataset = before; } };
}

function expectRingValidation(result: OpResult<void>) {
  expect(result).toMatchObject({ ok: false, error: { kind: 'validation', field: 'ring' } });
}

function integrationHarness(dataset: MapshaperDataset) {
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
  selection.apply([{ source: 'source', layer: 'rings', id: 0 }], 'replace');
  const history = {
    entries: [] as Array<{ undo(): void }>,
    push(entry: { undo(): void }) {
      this.entries.push(entry);
    },
    isCapturing: () => false,
  };
  const host = {
    _activeTransaction: null,
    _removed: false,
    _sources: new Map([['source', source]]),
    _history: history,
    _selection: selection,
    layers: {
      resolve: (sourceId: string, layerId: string) =>
        sourceId === 'source'
          ? (current.layers.find((candidate) => candidate.name === layerId || candidate.id === layerId) ??
            null)
          : null,
      resolveInLayers: (layers: readonly MapshaperLayer[], layerId: string) =>
        layers.find((candidate) => candidate.name === layerId || candidate.id === layerId) ?? null,
    },
    _invalidateShapeCachesForSources: vi.fn(),
    _scheduleRender: vi.fn(),
    _fireHistoryChange: vi.fn(),
    _fireSelectionChange: vi.fn(),
    fire: vi.fn(),
  } as unknown as EmapHostInternal;
  return { ops: new MapshaperOps(host), source, selection, history };
}

describe('addRing', () => {
  it('adds a centered hole, preserves selection, and supports undo', async () => {
    const fixture = await createFixture();
    const before = exported(fixture.dataset());

    await expect(addRing(fixture.ctx, { ring: [[3, 3], [7, 3], [7, 7], [3, 7]] })).resolves.toEqual({ ok: true, value: undefined });

    const polygon = exported(fixture.dataset());
    expect(polygon.coordinates).toHaveLength(2);
    expect(Math.sign(area(polygon.coordinates[0]!))).not.toBe(Math.sign(area(polygon.coordinates[1]!)));
    expect(fixture.ctx.host._selection.getAll()).toEqual(fixture.refs);
    fixture.undo();
    expect(exported(fixture.dataset())).toEqual(before);
  });

  it('records one undoable history entry through the real operation runner', async () => {
    const dataset = await importDataset({
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    });
    dataset.layers[0]!.name = 'rings';
    const before = exported(dataset);
    const fixture = integrationHarness(dataset);

    await expect(fixture.ops.addRing({ ring: [[3, 3], [7, 3], [7, 7], [3, 7]] })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(fixture.history.entries).toHaveLength(1);
    expect(fixture.selection.getAll()).toEqual([{ source: 'source', layer: 'rings', id: 0 }]);

    fixture.history.entries[0]!.undo();
    expect(exported(fixture.source.getDataset())).toEqual(before);
    expect(fixture.selection.getAll()).toEqual([{ source: 'source', layer: 'rings', id: 0 }]);
  });

  it('rejects a stale prepared dataset without mutating or recording history', async () => {
    const fixture = await createFixture();
    const before = exported(fixture.dataset());
    let historyEntries = 0;
    fixture.ctx.runPreparedDatasetMutation = async <T>(_sourceId, _label, mutate): Promise<OpResult<T>> => {
      const dataset = fixture.dataset();
      const result = await mutate(adapter.copyDataset(dataset), { ...dataset });
      if (result.ok) historyEntries++;
      return result;
    };

    await expect(addRing(fixture.ctx, { ring: [[3, 3], [7, 3], [7, 7], [3, 7]] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'stale-operation' },
    });
    expect(exported(fixture.dataset())).toEqual(before);
    expect(historyEntries).toBe(0);
  });

  it('automatically closes an unclosed input ring', async () => {
    const fixture = await createFixture();
    await expect(addRing(fixture.ctx, { ring: [[3, 3], [7, 3], [7, 7], [3, 7]] })).resolves.toMatchObject({ ok: true });
    const hole = exported(fixture.dataset()).coordinates[1]!;
    expect(hole[0]).toEqual(hole.at(-1));
  });

  it('adds a hole after the exterior that contains it in a multi-exterior feature', async () => {
    const fixture = await createFixture(
      undefined,
      undefined,
      {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
          [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]],
        ],
      },
    );

    await expect(addRing(fixture.ctx, { ring: [[23, 3], [27, 3], [27, 7], [23, 7]] })).resolves.toEqual({
      ok: true,
      value: undefined,
    });

    const shape = fixture.dataset().layers[0]!.shapes![0]!;
    expect(collectPolygonExteriors(shape, fixture.dataset().arcs!, adapter)).toEqual([
      { exteriorIndex: 0, holeIndexes: [] },
      { exteriorIndex: 1, holeIndexes: [2] },
    ]);
    const geometry = exported(fixture.dataset()) as unknown as GeoJSON.MultiPolygon;
    expect(geometry.coordinates).toHaveLength(2);
    expect(geometry.coordinates[1]).toHaveLength(2);
    expect(Math.sign(area(geometry.coordinates[1]![0]!))).not.toBe(
      Math.sign(area(geometry.coordinates[1]![1]!)),
    );
  });

  it.each([
    ['self-intersection', [[3, 3], [7, 7], [3, 7], [7, 3]]],
    ['zero area', [[3, 3], [5, 3], [7, 3]]],
    ['vertex outside', [[3, 3], [12, 3], [7, 7]]],
    ['crosses exterior', [[3, 3], [12, 3], [7, 7]]],
  ] as const)('rejects a ring with %s', async (_name, ring) => {
    const fixture = await createFixture();
    expectRingValidation(await addRing(fixture.ctx, { ring: [...ring] }));
  });

  it('rejects an island inside an existing hole', async () => {
    const fixture = await createFixture([
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]],
    ]);
    expectRingValidation(await addRing(fixture.ctx, { ring: [[3, 3], [7, 3], [7, 7], [3, 7]] }));
  });

  it('rejects a ring that overlaps an existing hole boundary', async () => {
    const fixture = await createFixture([
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
    ]);
    expectRingValidation(await addRing(fixture.ctx, { ring: [[4, 3], [6, 3], [6, 6], [3, 6]] }));
  });

  it('adds the ring to the feature that contains it, without any selection', async () => {
    const fixture = await createFixture(undefined, [], [
      { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
      { type: 'Polygon', coordinates: [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]] },
    ]);

    await expect(addRing(fixture.ctx, { ring: [[23, 3], [27, 3], [27, 7], [23, 7]] })).resolves.toEqual({
      ok: true,
      value: undefined,
    });

    const shapes = fixture.dataset().layers[0]!.shapes!;
    expect(shapes[0]).toHaveLength(1);
    expect(shapes[1]).toHaveLength(2);
  });

  it('rejects the ring when no polygon contains it', async () => {
    expectRingValidation(await addRing((await createFixture([], [])).ctx, { ring: [[3, 3], [7, 3], [7, 7]] }));
    const nonPolygon = await createFixture();
    nonPolygon.dataset().layers[0]!.geometry_type = 'polyline';
    expectRingValidation(await addRing(nonPolygon.ctx, { ring: [[3, 3], [7, 3], [7, 7]] }));
  });


  it('rejects stale prepared datasets', async () => {
    const fixture = await createFixture();
    fixture.ctx.runPreparedDatasetMutation = async <T>(_sourceId, _label, mutate): Promise<OpResult<T>> => {
      const dataset = fixture.dataset();
      return mutate(adapter.copyDataset(dataset), { ...dataset });
    };
    await expect(addRing(fixture.ctx, { ring: [[3, 3], [7, 3], [7, 7]] })).resolves.toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
  });
});

describe('source-scan error flow', () => {
  it('propagates non-validation runner failures instead of reporting a miss', async () => {
    const fixture = await createFixture();
    fixture.ctx.runPreparedDatasetMutation = async () => Err.hostRemoved();
    await expect(addRing(fixture.ctx, { ring: [[3, 3], [7, 3], [7, 7]] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'host-removed' },
    });
    await expect(deleteRing(fixture.ctx, { point: [5, 5] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'host-removed' },
    });
  });

  it('prefers a specific boundary reason over a later generic miss', async () => {
    const conflict = await createFixture([
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ]);
    const other = await createFixture(undefined, undefined, {
      type: 'Polygon',
      coordinates: [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]],
    });
    const ctx: OpContext = {
      ...conflict.ctx,
      host: {
        ...conflict.ctx.host,
        _sources: new Map([
          ['conflict', { getDataset: () => conflict.dataset() }],
          ['other', { getDataset: () => other.dataset() }],
        ]),
      } as unknown as EmapHostInternal,
      runPreparedDatasetMutation: async <T,>(
        sourceId: string,
        _label: string | ((value: T) => string),
        mutate: (working: MapshaperDataset, original: MapshaperDataset) => OpResult<T> | { value: T; selection: FeatureRef[] },
      ): Promise<OpResult<T>> => {
        const dataset = (sourceId === 'conflict' ? conflict : other).dataset();
        const outcome = await mutate(adapter.copyDataset(dataset), dataset);
        return 'ok' in outcome ? outcome : okValue(outcome.value);
      },
    };

    await expect(addRing(ctx, { ring: [[3, 5], [7, 5], [7, 7], [3, 7]] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'ring', reason: 'ring intersects a polygon boundary' },
    });
  });
});

describe('deleteRing', () => {
  it('deletes the hole containing the point without any selection', async () => {
    const fixture = await createFixture(
      [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]],
      ],
      [],
    );
    await expect(deleteRing(fixture.ctx, { point: [5, 5] })).resolves.toEqual({ ok: true, value: undefined });
    expect(exported(fixture.dataset()).coordinates).toHaveLength(1);
  });

  it('deletes the hole containing the point', async () => {
    const fixture = await createFixture([
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]],
    ]);
    await expect(deleteRing(fixture.ctx, { point: [5, 5] })).resolves.toEqual({ ok: true, value: undefined });
    expect(exported(fixture.dataset()).coordinates).toHaveLength(1);
  });
  it('deletes only the hole containing the selected point', async () => {
    const fixture = await createFixture([
      [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]],
      [[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]],
      [[12, 12], [18, 12], [18, 18], [12, 18], [12, 12]],
    ]);

    await expect(deleteRing(fixture.ctx, { point: [4, 4] })).resolves.toMatchObject({ ok: true });
    expect(exported(fixture.dataset()).coordinates).toHaveLength(2);
    expect(exported(fixture.dataset()).coordinates[1]).toContainEqual([12, 12]);

    const secondFixture = await createFixture([
      [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]],
      [[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]],
      [[12, 12], [18, 12], [18, 18], [12, 18], [12, 12]],
    ]);
    await expect(deleteRing(secondFixture.ctx, { point: [14, 14] })).resolves.toMatchObject({ ok: true });
    expect(exported(secondFixture.dataset()).coordinates).toHaveLength(2);
    expect(exported(secondFixture.dataset()).coordinates[1]).toContainEqual([2, 2]);
  });

  it.each([
    ['on the exterior boundary', [0, 5]],
    ['in blank exterior space', [11, 5]],
  ] as const)('rejects a point %s', async (_name, point) => {
    const fixture = await createFixture([
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]],
    ]);
    expectRingValidation(await deleteRing(fixture.ctx, { point }));
  });

  it('rejects deletion from a polygon with no holes', async () => {
    const fixture = await createFixture();
    expectRingValidation(await deleteRing(fixture.ctx, { point: [5, 5] }));
  });
});

function area(ring: Position[]): number {
  return ring.slice(1).reduce((sum, point, index) => {
    const previous = ring[index]!;
    return sum + previous[0] * point[1] - previous[1] * point[0];
  }, 0) / 2;
}

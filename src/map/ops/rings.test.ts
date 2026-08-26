import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { EmapHostInternal } from '../emap-host';
import { okValue, type OpResult } from '../op-result';
import type { FeatureRef } from '../types';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { OpContext } from './_context';
import { addRing, deleteRing } from './rings';

const adapter = getDefaultMapshaperAdapter();
const FIXTURE_NAME = 'rings.geojson';
type Position = [number, number];

async function importDataset(rings: Position[][]): Promise<MapshaperDataset> {
  return adapter.runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'selected' }, geometry: { type: 'Polygon', coordinates: rings } }],
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
) {
  let dataset = await importDataset(rings);
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

function expectSelectionValidation(result: OpResult<void>) {
  expect(result).toMatchObject({ ok: false, error: { kind: 'validation', field: 'selection' } });
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

  it('automatically closes an unclosed input ring', async () => {
    const fixture = await createFixture();
    await expect(addRing(fixture.ctx, { ring: [[3, 3], [7, 3], [7, 7], [3, 7]] })).resolves.toMatchObject({ ok: true });
    const hole = exported(fixture.dataset()).coordinates[1]!;
    expect(hole[0]).toEqual(hole.at(-1));
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

  it('rejects empty, multi-feature, and non-polygon selections', async () => {
    expectSelectionValidation(await addRing((await createFixture([], [])).ctx, { ring: [[3, 3], [7, 3], [7, 7]] }));
    const multiple = await createFixture(undefined, [
      { source: 'source', layer: 'rings', id: 0 },
      { source: 'source', layer: 'rings', id: 1 },
    ]);
    expectSelectionValidation(await addRing(multiple.ctx, { ring: [[3, 3], [7, 3], [7, 7]] }));
    const nonPolygon = await createFixture();
    nonPolygon.dataset().layers[0]!.geometry_type = 'polyline';
    expectSelectionValidation(await addRing(nonPolygon.ctx, { ring: [[3, 3], [7, 3], [7, 7]] }));
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

describe('deleteRing', () => {
  it('deletes the hole containing the point', async () => {
    const fixture = await createFixture([
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]],
    ]);
    await expect(deleteRing(fixture.ctx, { point: [5, 5] })).resolves.toEqual({ ok: true, value: undefined });
    expect(exported(fixture.dataset()).coordinates).toHaveLength(1);
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

import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { EmapHostInternal } from '../emap-host';
import { okValue, type OpResult } from '../op-result';
import type { FeatureRef } from '../types';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { OpContext } from './_context';
import { reshapeSelected } from './reshape-selected';

const FIXTURE_NAME = 'reshape-selected.geojson';

async function importDataset(): Promise<MapshaperDataset> {
  return getDefaultMapshaperAdapter().runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'selected' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [10, 0],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { name: 'unselected' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 10],
              [10, 10],
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

async function createFixture(
  refs: FeatureRef[] = [{ source: 'source', layer: 'reshape-selected', id: 0 }],
) {
  let dataset = await importDataset();
  let before: MapshaperDataset | undefined;
  const source = { getDataset: () => dataset };
  const resolve = (layers: MapshaperDataset['layers'], sourceId: string, layerId: string) =>
    sourceId === 'source' && layerId === 'reshape-selected'
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
      const working = getDefaultMapshaperAdapter().copyDataset(original);
      const outcome = await mutate(working, original);
      if ('ok' in outcome) return outcome;
      before = original;
      dataset = working;
      return okValue(outcome.value);
    },
  };
  return {
    ctx,
    dataset: () => dataset,
    undo: () => {
      if (before) dataset = before;
    },
  };
}

describe('reshapeSelected', () => {
  it('reshapes selected lines while preserving attributes, selection, and undo data', async () => {
    const refs = [{ source: 'source', layer: 'reshape-selected', id: 0 }];
    const fixture = await createFixture(refs);
    const before = exportCoordinates(fixture.dataset());

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
    expect(fixture.dataset().layers[0]!.data?.getRecords?.()[0]).toEqual({ name: 'selected' });
    expect(fixture.ctx.host._selection.getAll()).toEqual(refs);

    fixture.undo();
    expect(exportCoordinates(fixture.dataset())).toEqual(before);
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

  it('rejects stale prepared datasets', async () => {
    const fixture = await createFixture();
    fixture.ctx.runPreparedDatasetMutation = async <T>(
      _sourceId,
      _label,
      mutate,
    ): Promise<OpResult<T>> => {
      const dataset = fixture.dataset();
      return mutate(getDefaultMapshaperAdapter().copyDataset(dataset), { ...dataset });
    };
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
  });
});

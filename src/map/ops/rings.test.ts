import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { EditCommand } from '../../edit/edit-command';
import { EditHistory } from '../../edit/edit-history';
import type { EmapHostInternal } from '../emap-host';
import { Err, okValue, type OpResult } from '../op-result';
import type { FeatureRef } from '../types';
import type { MapshaperDataset, MapshaperLayer, PathShape } from '../../types/mapshaper-types';
import type { OpContext } from './_context';
import { MapshaperOps } from '../mapshaper-ops';
import { Selection } from '../selection';
import { addRing, deleteRing, fillRing } from './rings';
import { collectPolygonExteriors } from './reshape-selected-polygon';
import { _runPreparedDatasetMutation } from './_runner';

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
  rings: Position[][] = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
  refs: FeatureRef[] = [{ source: 'source', layer: 'rings', id: 0 }],
  geometry:
    | GeoJSON.Polygon
    | GeoJSON.MultiPolygon
    | Array<GeoJSON.Polygon | GeoJSON.MultiPolygon> = { type: 'Polygon', coordinates: rings },
) {
  let dataset = await importDataset(geometry);
  const entries: EditCommand[] = [];
  const source = {
    getDataset: () => dataset,
    getArcs: () => dataset.arcs,
  };
  const resolve = (layers: MapshaperDataset['layers'], sourceId: string, layerId: string) =>
    sourceId === 'source' && layerId === 'rings'
      ? (layers.find((layer) => layer.name === layerId) ?? null)
      : null;
  const selection = new Selection();
  selection.apply(refs, 'replace');
  const host = {
    _selection: selection,
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
      dataset = working;
      return okValue(outcome.value);
    },
    runPreparedEditCommand: async <T>(
      _sourceId: string,
      _label: string,
      plan: (planned: MapshaperDataset, plannedSource: unknown) => any,
    ): Promise<OpResult<T>> => {
      const outcome = plan(dataset, source);
      if ('ok' in outcome) return outcome;
      outcome.command.do();
      entries.push(outcome.command);
      return okValue(outcome.value);
    },
  };
  return {
    ctx,
    dataset: () => dataset,
    refs,
    entries,
    undo: () => {
      entries.at(-1)?.undo();
    },
  };
}

function expectRingValidation(result: OpResult<void>) {
  expect(result).toMatchObject({ ok: false, error: { kind: 'validation', field: 'ring' } });
}

function integrationHarness(dataset: MapshaperDataset) {
  let current = dataset;
  const source = {
    getDataset: () => current,
    getArcs: () => current.arcs,
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
          ? (current.layers.find(
              (candidate) => candidate.name === layerId || candidate.id === layerId,
            ) ?? null)
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
  it('accepts a target polygon whose existing hole touches the shell at one point', async () => {
    // GEOS-valid tangent contact (a simplified hole vertex snapped onto the
    // shell edge) must not block adding another hole.
    const fixture = await createFixture([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [10, 5],
        [8, 5],
        [8, 7],
        [10, 5],
      ],
    ]);
    await expect(
      addRing(fixture.ctx, {
        ring: [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
        ],
      }),
    ).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(exported(fixture.dataset()).coordinates).toHaveLength(3);
  });

  it('adds a centered hole, preserves selection, and supports undo', async () => {
    const fixture = await createFixture();
    const before = exported(fixture.dataset());

    await expect(
      addRing(fixture.ctx, {
        ring: [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
      }),
    ).resolves.toEqual({ ok: true, value: undefined });

    const polygon = exported(fixture.dataset());
    expect(polygon.coordinates).toHaveLength(2);
    expect(Math.sign(area(polygon.coordinates[0]!))).not.toBe(
      Math.sign(area(polygon.coordinates[1]!)),
    );
    expect(fixture.ctx.host._selection.getAll()).toEqual(fixture.refs);
    fixture.undo();
    expect(exported(fixture.dataset())).toEqual(before);
  });

  it('records one undoable history entry through the real operation runner', async () => {
    const dataset = await importDataset({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    });
    dataset.layers[0]!.name = 'rings';
    const before = exported(dataset);
    const fixture = integrationHarness(dataset);

    await expect(
      fixture.ops.addRing({
        ring: [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
      }),
    ).resolves.toEqual({
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
    fixture.ctx.runPreparedEditCommand = async <T>(
      _sourceId,
      _label,
      plan,
    ): Promise<OpResult<T>> => {
      const dataset = fixture.dataset();
      const result = plan({ ...dataset } as any, {
        getDataset: () => dataset,
        getArcs: () => dataset.arcs,
      });
      if (result.ok) historyEntries++;
      return result;
    };

    await expect(
      addRing(fixture.ctx, {
        ring: [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'stale-operation' },
    });
    expect(exported(fixture.dataset())).toEqual(before);
    expect(historyEntries).toBe(0);
  });

  it('automatically closes an unclosed input ring', async () => {
    const fixture = await createFixture();
    await expect(
      addRing(fixture.ctx, {
        ring: [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
      }),
    ).resolves.toMatchObject({ ok: true });
    const hole = exported(fixture.dataset()).coordinates[1]!;
    expect(hole[0]).toEqual(hole.at(-1));
  });

  it('adds a hole after the exterior that contains it in a multi-exterior feature', async () => {
    const fixture = await createFixture(undefined, undefined, {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
        [
          [
            [20, 0],
            [30, 0],
            [30, 10],
            [20, 10],
            [20, 0],
          ],
        ],
      ],
    });

    await expect(
      addRing(fixture.ctx, {
        ring: [
          [23, 3],
          [27, 3],
          [27, 7],
          [23, 7],
        ],
      }),
    ).resolves.toEqual({
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
    [
      'self-intersection',
      [
        [3, 3],
        [7, 7],
        [3, 7],
        [7, 3],
      ],
    ],
    [
      'zero area',
      [
        [3, 3],
        [5, 3],
        [7, 3],
      ],
    ],
    [
      'vertex outside',
      [
        [3, 3],
        [12, 3],
        [7, 7],
      ],
    ],
    [
      'crosses exterior',
      [
        [3, 3],
        [12, 3],
        [7, 7],
      ],
    ],
  ] as const)('rejects a ring with %s', async (_name, ring) => {
    const fixture = await createFixture();
    expectRingValidation(await addRing(fixture.ctx, { ring: [...ring] }));
  });

  it('rejects an island inside an existing hole', async () => {
    const fixture = await createFixture([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [2, 2],
        [8, 2],
        [8, 8],
        [2, 8],
        [2, 2],
      ],
    ]);
    expectRingValidation(
      await addRing(fixture.ctx, {
        ring: [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
      }),
    );
  });

  it('rejects a ring that overlaps an existing hole boundary', async () => {
    const fixture = await createFixture([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 4],
        [2, 2],
      ],
    ]);
    expectRingValidation(
      await addRing(fixture.ctx, {
        ring: [
          [4, 3],
          [6, 3],
          [6, 6],
          [3, 6],
        ],
      }),
    );
  });

  it('adds the ring to the feature that contains it, without any selection', async () => {
    const fixture = await createFixture(
      undefined,
      [],
      [
        {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        },
        {
          type: 'Polygon',
          coordinates: [
            [
              [20, 0],
              [30, 0],
              [30, 10],
              [20, 10],
              [20, 0],
            ],
          ],
        },
      ],
    );

    await expect(
      addRing(fixture.ctx, {
        ring: [
          [23, 3],
          [27, 3],
          [27, 7],
          [23, 7],
        ],
      }),
    ).resolves.toEqual({
      ok: true,
      value: undefined,
    });

    const shapes = fixture.dataset().layers[0]!.shapes!;
    expect(shapes[0]).toHaveLength(1);
    expect(shapes[1]).toHaveLength(2);
  });

  it('rejects the ring when no polygon contains it', async () => {
    expectRingValidation(
      await addRing((await createFixture([], [])).ctx, {
        ring: [
          [3, 3],
          [7, 3],
          [7, 7],
        ],
      }),
    );
    const nonPolygon = await createFixture();
    nonPolygon.dataset().layers[0]!.geometry_type = 'polyline';
    expectRingValidation(
      await addRing(nonPolygon.ctx, {
        ring: [
          [3, 3],
          [7, 3],
          [7, 7],
        ],
      }),
    );
  });

  it('rejects stale prepared datasets', async () => {
    const fixture = await createFixture();
    fixture.ctx.runPreparedEditCommand = async <T>(
      _sourceId,
      _label,
      plan,
    ): Promise<OpResult<T>> => {
      const dataset = fixture.dataset();
      return plan({ ...dataset } as any, { getDataset: () => dataset });
    };
    await expect(
      addRing(fixture.ctx, {
        ring: [
          [3, 3],
          [7, 3],
          [7, 7],
        ],
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
  });
});

describe('source-scan error flow', () => {
  it('propagates non-validation runner failures instead of reporting a miss', async () => {
    const fixture = await createFixture();
    fixture.ctx.runPreparedDatasetMutation = async () => Err.hostRemoved();
    fixture.ctx.runPreparedEditCommand = async () => Err.hostRemoved();
    await expect(
      addRing(fixture.ctx, {
        ring: [
          [3, 3],
          [7, 3],
          [7, 7],
        ],
      }),
    ).resolves.toMatchObject({
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
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ]);
    const other = await createFixture(undefined, undefined, {
      type: 'Polygon',
      coordinates: [
        [
          [20, 0],
          [30, 0],
          [30, 10],
          [20, 10],
          [20, 0],
        ],
      ],
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
      runPreparedEditCommand: async <T>(
        sourceId,
        _label,
        plan,
      ): Promise<OpResult<T>> => {
        const dataset = (sourceId === 'conflict' ? conflict : other).dataset();
        const outcome = plan(dataset, { getDataset: () => dataset });
        return 'ok' in outcome ? outcome : okValue(outcome.value);
      },
    };

    await expect(
      addRing(ctx, {
        ring: [
          [3, 5],
          [7, 5],
          [7, 7],
          [3, 7],
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'ring', reason: 'ring intersects a polygon boundary' },
    });
  });
});

describe('deleteRing', () => {
  it('deletes a hole that touches the shell at one point', async () => {
    const fixture = await createFixture([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [10, 5],
        [8, 5],
        [8, 7],
        [10, 5],
      ],
    ]);
    await expect(deleteRing(fixture.ctx, { point: [9, 6] })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(exported(fixture.dataset()).coordinates).toHaveLength(1);
  });

  it('deletes the hole containing the point without any selection', async () => {
    const fixture = await createFixture(
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [8, 2],
          [8, 8],
          [2, 8],
          [2, 2],
        ],
      ],
      [],
    );
    await expect(deleteRing(fixture.ctx, { point: [5, 5] })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(exported(fixture.dataset()).coordinates).toHaveLength(1);
  });

  it('deletes the hole containing the point', async () => {
    const fixture = await createFixture([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [2, 2],
        [8, 2],
        [8, 8],
        [2, 8],
        [2, 2],
      ],
    ]);
    await expect(deleteRing(fixture.ctx, { point: [5, 5] })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(exported(fixture.dataset()).coordinates).toHaveLength(1);
  });
  it('deletes only the hole containing the selected point', async () => {
    const fixture = await createFixture([
      [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ],
      [
        [2, 2],
        [6, 2],
        [6, 6],
        [2, 6],
        [2, 2],
      ],
      [
        [12, 12],
        [18, 12],
        [18, 18],
        [12, 18],
        [12, 12],
      ],
    ]);

    await expect(deleteRing(fixture.ctx, { point: [4, 4] })).resolves.toMatchObject({ ok: true });
    expect(exported(fixture.dataset()).coordinates).toHaveLength(2);
    expect(exported(fixture.dataset()).coordinates[1]).toContainEqual([12, 12]);

    const secondFixture = await createFixture([
      [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ],
      [
        [2, 2],
        [6, 2],
        [6, 6],
        [2, 6],
        [2, 2],
      ],
      [
        [12, 12],
        [18, 12],
        [18, 18],
        [12, 18],
        [12, 12],
      ],
    ]);
    await expect(deleteRing(secondFixture.ctx, { point: [14, 14] })).resolves.toMatchObject({
      ok: true,
    });
    expect(exported(secondFixture.dataset()).coordinates).toHaveLength(2);
    expect(exported(secondFixture.dataset()).coordinates[1]).toContainEqual([2, 2]);
  });

  it.each([
    ['on the exterior boundary', [0, 5]],
    ['in blank exterior space', [11, 5]],
  ] as const)('rejects a point %s', async (_name, point) => {
    const fixture = await createFixture([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [2, 2],
        [8, 2],
        [8, 8],
        [2, 8],
        [2, 2],
      ],
    ]);
    expectRingValidation(await deleteRing(fixture.ctx, { point }));
  });

  it('rejects deletion from a polygon with no holes', async () => {
    const fixture = await createFixture();
    expectRingValidation(await deleteRing(fixture.ctx, { point: [5, 5] }));
  });
});

describe('fillRing', () => {
  const HOLED: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
        [3, 3],
      ], // hole — click target [5, 5]
    ],
  };

  it('fills the hole containing the point, keeping the hole on the host', async () => {
    const fixture = await createFixture(undefined, undefined, HOLED);
    const arcs = fixture.dataset().arcs!;
    const arcCount = arcs.size();
    const layer = fixture.dataset().layers[0]!;
    await expect(fillRing(fixture.ctx, { point: [5, 5] })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(layer.shapes).toHaveLength(2);
    // Host keeps its hole.
    expect(exported(fixture.dataset()).coordinates).toHaveLength(2);
    // New shape references the hole part's arcs in reverse — no arc appended.
    expect(arcs.size()).toBe(arcCount);
    const holePart = (layer.shapes[0] as PathShape)[1]!;
    expect(layer.shapes[1]).toEqual([holePart.slice().reverse().map((id) => ~id)]);
    // Empty attribute record appended.
    const records = layer.data!.getRecords();
    expect(records).toHaveLength(2);
    expect(records[1]).toEqual({});
  });

  it('undo/redo round-trips exactly without touching arcs', async () => {
    const fixture = await createFixture(undefined, undefined, HOLED);
    const arcs = fixture.dataset().arcs!;
    const arcCount = arcs.size();
    await fillRing(fixture.ctx, { point: [5, 5] });
    fixture.entries[0]!.undo();
    expect(fixture.dataset().layers[0]!.shapes).toHaveLength(1);
    expect(fixture.dataset().layers[0]!.data!.getRecords()).toHaveLength(1);
    expect(arcs.size()).toBe(arcCount);
    fixture.entries[0]!.do();
    expect(fixture.dataset().layers[0]!.shapes).toHaveLength(2);
    expect(arcs.size()).toBe(arcCount);
  });

  it('keeps the current selection unchanged', async () => {
    const fixture = await createFixture(undefined, undefined, HOLED);
    await fillRing(fixture.ctx, { point: [5, 5] });
    expect(fixture.ctx.host._selection.getAll()).toEqual([
      { source: 'source', layer: 'rings', id: 0 },
    ]);
  });

  it('rejects a polygon with no holes and a point outside every ring', async () => {
    const noHole = await createFixture();
    expectRingValidation(await fillRing(noHole.ctx, { point: [5, 5] }));
    const holed = await createFixture(undefined, undefined, HOLED);
    expectRingValidation(await fillRing(holed.ctx, { point: [50, 50] }));
    expect(holed.dataset().layers[0]!.shapes).toHaveLength(1);
  });

  it('rejects invalid point coordinates', async () => {
    const fixture = await createFixture(undefined, undefined, HOLED);
    expectRingValidation(await fillRing(fixture.ctx, { point: [Number.NaN, 5] as any }));
  });

  it('reverses a multi-arc hole part arc-by-arc (shared-boundary fixture)', async () => {
    // Neighbour polygon lies inside the hole and shares only part of its right
    // edge; topology import splits that hole boundary into multiple arcs.
    const multi: Array<GeoJSON.Polygon> = [
      {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
          [
            [2, 2],
            [8, 2],
            [8, 3],
            [8, 7],
            [8, 8],
            [2, 8],
            [2, 2],
          ],
        ],
      },
      {
        type: 'Polygon',
        coordinates: [
          [
            [8, 3],
            [7, 3],
            [7, 7],
            [8, 7],
            [8, 3],
          ],
        ],
      },
    ];
    const fixture = await createFixture(undefined, undefined, multi);
    const layer = fixture.dataset().layers[0]!;
    await expect(fillRing(fixture.ctx, { point: [5, 5] })).resolves.toMatchObject({ ok: true });
    // 3 features now: host (hole kept), neighbour, filling feature.
    expect(layer.shapes).toHaveLength(3);
    const holePart = (layer.shapes[0] as PathShape)[1]!;
    const neighbourPart = (layer.shapes[1] as PathShape)[0]!;
    const holeArcIds = new Set(holePart.map((id) => (id < 0 ? ~id : id)));
    expect(neighbourPart.some((id) => holeArcIds.has(id < 0 ? ~id : id))).toBe(true);
    expect(holePart.length).toBeGreaterThan(1); // fixture must actually split arcs
    expect(layer.shapes[2]).toEqual([holePart.slice().reverse().map((id) => ~id)]);
  });
});

function area(ring: Position[]): number {
  return (
    ring.slice(1).reduce((sum, point, index) => {
      const previous = ring[index]!;
      return sum + previous[0] * point[1] - previous[1] * point[0];
    }, 0) / 2
  );
}

describe('addRing direct edit (multi-level undo)', () => {
  const SHELL: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  };
  const HOLE_A: [number, number][] = [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
  ];
  const HOLE_B: [number, number][] = [
    [4, 1],
    [5, 1],
    [5, 2],
    [4, 2],
  ];
  const HOLE_C: [number, number][] = [
    [7, 1],
    [8, 1],
    [8, 2],
    [7, 2],
  ];

  it('commits an in-place command without copying the dataset', async () => {
    const fixture = await createFixture(undefined, undefined, SHELL);
    const live = fixture.dataset();
    const copySpy = vi.spyOn(adapter, 'copyDataset');
    try {
      const result = await addRing(fixture.ctx, { ring: HOLE_A });
      expect(result.ok).toBe(true);
      expect(copySpy).not.toHaveBeenCalled();
      expect(fixture.dataset()).toBe(live); // same object, mutated in place
      expect(fixture.entries).toHaveLength(1);
      expect(fixture.entries[0]!.label).toBe('Add ring');
      expect((fixture.entries[0] as any).invalidatesPriorCommands).toBeUndefined();
    } finally {
      copySpy.mockRestore();
    }
  });

  it('three consecutive addRings undo/redo level by level with stable arc ids', async () => {
    const fixture = await createFixture(undefined, undefined, SHELL);
    const arcs = fixture.dataset().arcs!;
    const originalArcCount = arcs.size();
    const ringCount = () => exported(fixture.dataset()).coordinates.length;

    await addRing(fixture.ctx, { ring: HOLE_A });
    await addRing(fixture.ctx, { ring: HOLE_B });
    await addRing(fixture.ctx, { ring: HOLE_C });
    expect(ringCount()).toBe(4);
    expect(arcs.size()).toBe(originalArcCount + 3);
    expect(fixture.entries).toHaveLength(3);

    fixture.entries[2]!.undo();
    expect(ringCount()).toBe(3);
    fixture.entries[1]!.undo();
    expect(ringCount()).toBe(2);
    fixture.entries[0]!.undo();
    expect(ringCount()).toBe(1);
    expect(arcs.size()).toBe(originalArcCount);

    fixture.entries[0]!.do();
    fixture.entries[1]!.do();
    fixture.entries[2]!.do();
    expect(ringCount()).toBe(4);
    expect(arcs.size()).toBe(originalArcCount + 3); // redo reuses the same ids
  });
});

describe('deleteRing direct edit', () => {
  const TWO_HOLES: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [8, 4],
        [9, 4],
        [9, 6],
        [8, 6],
        [8, 4],
      ], // hole A — click target [8.5, 5]
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
        [1, 1],
      ], // hole B
    ],
  };

  it('does not compact arcs: orphan ring arc survives, later arc ids unchanged', async () => {
    const fixture = await createFixture(undefined, undefined, TWO_HOLES);
    const arcs = fixture.dataset().arcs!;
    const arcCount = arcs.size();
    const cleanSpy = vi.spyOn(adapter, 'cleanArcReferences');
    try {
      const result = await deleteRing(fixture.ctx, { point: [8.5, 5] });
      expect(result.ok).toBe(true);
      expect(cleanSpy).not.toHaveBeenCalled();
      expect(arcs.size()).toBe(arcCount); // hole A's arc retained as orphan
      expect(exported(fixture.dataset()).coordinates).toHaveLength(2);
    } finally {
      cleanSpy.mockRestore();
    }
    fixture.entries[0]!.undo();
    expect(exported(fixture.dataset()).coordinates).toHaveLength(3);
    expect(arcs.size()).toBe(arcCount);
    fixture.entries[0]!.do();
    expect(exported(fixture.dataset()).coordinates).toHaveLength(2);
  });

  it('addRing → deleteRing → undo × 2 / redo × 2 round-trips exactly', async () => {
    const fixture = await createFixture(); // single shell, no holes
    const ringCount = () => exported(fixture.dataset()).coordinates.length;
    const initial = ringCount();
    await addRing(fixture.ctx, {
      ring: [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
      ],
    });
    expect(ringCount()).toBe(2);
    await deleteRing(fixture.ctx, { point: [5, 5] });
    expect(ringCount()).toBe(initial);
    fixture.entries[1]!.undo(); // undo delete → hole returns
    expect(ringCount()).toBe(2);
    fixture.entries[0]!.undo(); // undo add → back to initial
    expect(ringCount()).toBe(initial);
    fixture.entries[0]!.do();
    fixture.entries[1]!.do();
    expect(ringCount()).toBe(initial);
  });
});

it('barrier probe: direct → replacement → undo replacement restores captured identity', async () => {
  const dataset = await importDataset({
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  });
  dataset.layers[0]!.name = 'rings';
  const harness = integrationHarness(dataset);
  const realHistory = new EditHistory(); // import from '../../edit/edit-history'
  (harness.ops as any)._emap._history = realHistory;

  const liveBefore = harness.source.getDataset();
  await expect(
    harness.ops.addRing({ ring: [[3, 3], [7, 3], [7, 7], [3, 7]] }),
  ).resolves.toMatchObject({ ok: true });
  expect(harness.source.getDataset()).toBe(liveBefore); // in-place: same identity
  expect(realHistory.size()).toBe(1);

  // Replacement through the real prepared-mutation runner (no-op mutation,
  // but the commit path pushes a DatasetReplaceSelectionCommand barrier).
  const result = await _runPreparedDatasetMutation(
    (harness.ops as any)._emap,
    'source',
    'Probe replace',
    () => ({ value: undefined, selection: [] }),
  );
  expect(result.ok).toBe(true);
  expect(realHistory.size()).toBe(2); // stale placeholder + barrier command
  expect(realHistory.snapshot().staleCount).toBe(1);

  realHistory.undo(); // undo replacement: re-attaches the exact pre-replace object
  expect(harness.source.getDataset()).toBe(liveBefore);
  // Current global barrier semantics skip the direct command below the stale
  // placeholder, so the hole stays on the map. MAP-182 tracks narrowing this
  // barrier by source/identity where replacement can prove safety.
  realHistory.undo();
  expect(realHistory.snapshot().skippedStale).toBe(true);
  expect(exported(harness.source.getDataset()).coordinates).toHaveLength(2);
});

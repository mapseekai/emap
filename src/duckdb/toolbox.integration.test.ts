import { createRequire } from 'node:module';
import { tableToIPC, type Table } from 'apache-arrow';
import type { DuckDBBundles } from '@duckdb/duckdb-wasm/blocking';
import { afterAll, describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from './runtime';
import {
  attributeJoin,
  collect,
  densify,
  dissolve,
  duckDbToolbox,
  extractVertices,
  lineToPolygon,
  merge,
  multipartToSinglepart,
  nearest,
  pointToLine,
  reproject,
  spatialFilter,
  spatialJoin,
  symmetricDifference,
  union,
} from './index';

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const require = createRequire(import.meta.url);
let runtime: DuckDbRuntime | undefined;

type BlockingDuckDbConnectionLike = {
  insertArrowFromIPCStream(buffer: Uint8Array, opts: { name: string; create?: boolean }): void;
  query(sql: string): Table;
  close(): void;
};

async function createBlockingDuckDbRuntime(): Promise<DuckDbRuntime> {
  const duckdb = await import('@duckdb/duckdb-wasm/blocking');
  const bundles = {
    mvp: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker: '',
    },
    eh: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
      mainWorker: '',
    },
  } satisfies DuckDBBundles;
  const db = await duckdb.createDuckDB(bundles, new duckdb.ConsoleLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  let spatialReady: Promise<void> | null = null;

  function wrapConnection(): DuckDbConnection {
    const conn = db.connect() as unknown as BlockingDuckDbConnectionLike;
    return {
      async insertArrowTable(table, opts) {
        conn.insertArrowFromIPCStream(tableToIPC(table, 'stream'), { ...opts, create: true });
      },
      async query(sql) {
        return conn.query(sql);
      },
      async close() {
        conn.close();
      },
    };
  }

  return {
    async connect() {
      return wrapConnection();
    },
    ensureSpatial() {
      const ready =
        spatialReady ??
        (async () => {
          const conn = wrapConnection();
          try {
            await conn.query('INSTALL spatial; LOAD spatial;');
          } finally {
            await conn.close?.();
          }
        })();
      spatialReady = ready;
      ready.catch(() => {
        if (spatialReady === ready) spatialReady = null;
      });
      return ready;
    },
    async close() {
      await (db as { terminate?: () => Promise<unknown> }).terminate?.();
    },
  };
}

async function getRuntime(): Promise<DuckDbRuntime> {
  runtime ??= await createBlockingDuckDbRuntime();
  return runtime;
}

afterAll(async () => {
  await runtime?.close?.();
});

async function dataset(fc: unknown, crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const result = await datasetFromGeoJSON(fc);
  result.info = { ...result.info, crs_string: crs };
  return result;
}

const POLYGONS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1, group: 'a' },
      geometry: {
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
    },
    {
      type: 'Feature',
      properties: { id: 2, group: 'a' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [10, 0],
            [20, 0],
            [20, 10],
            [10, 10],
            [10, 0],
          ],
        ],
      },
    },
  ],
};

const MASK = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 10 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [5, -5],
            [15, -5],
            [15, 15],
            [5, 15],
            [5, -5],
          ],
        ],
      },
    },
  ],
};

const POINTS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1, route: 'r', seq: 1 },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
    {
      type: 'Feature',
      properties: { id: 2, route: 'r', seq: 2 },
      geometry: { type: 'Point', coordinates: [9, 9] },
    },
    {
      type: 'Feature',
      properties: { id: 3, route: 'r', seq: 3 },
      geometry: { type: 'Point', coordinates: [19, 9] },
    },
  ],
};

const LINES = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      },
    },
  ],
};

const MULTIPOLYGON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1 },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 4],
              [0, 0],
            ],
          ],
          [
            [
              [6, 0],
              [10, 0],
              [10, 4],
              [6, 4],
              [6, 0],
            ],
          ],
        ],
      },
    },
  ],
};

describeDuckDbIntegration('DuckDB toolbox integration', () => {
  it('runs dissolve, collect, densify, multipart, and vertex extraction', async () => {
    const rt = await getRuntime();
    const polygons = await dataset(POLYGONS);

    const dissolved = await dissolve(polygons, { groupBy: ['group'] }, rt);
    expect(dissolved.layers[0]?.shapes?.length).toBe(1);

    const collected = await collect(polygons, { groupBy: ['group'] }, rt);
    expect(collected.layers[0]?.shapes?.length).toBe(1);

    const densified = await densify(polygons, { maxSegmentLength: 2 }, rt);
    expect(densified.layers[0]?.shapes?.length).toBe(2);

    const multipart = await dataset(MULTIPOLYGON);
    const singles = await multipartToSinglepart(multipart, {}, rt);
    expect(singles.layers[0]?.shapes?.length).toBe(2);

    const vertices = await extractVertices(polygons, {}, rt);
    expect(vertices.layers[0]?.shapes?.length).toBeGreaterThan(4);
  }, 30_000);

  it('runs point-to-line and line-to-polygon transforms', async () => {
    const rt = await getRuntime();
    const points = await dataset(POINTS);
    const lines = await pointToLine(points, { groupBy: ['route'], orderBy: 'seq' }, rt);
    expect(lines.layers[0]?.shapes?.length).toBe(1);

    const closedLines = await dataset(LINES);
    const polygons = await lineToPolygon(closedLines, {}, rt);
    expect(polygons.layers[0]?.shapes?.length).toBe(1);
  });

  it('runs overlay coverage union and symmetric difference', async () => {
    const rt = await getRuntime();
    const left = await dataset(POLYGONS);
    const right = await dataset(MASK);

    const unionResult = await union(left, right, {}, rt);
    expect(unionResult.layers[0]?.shapes?.length).toBe(1);

    const sym = await symmetricDifference(left, right, {}, rt);
    expect(sym.layers[0]?.shapes?.length).toBe(1);
  });

  it('runs attribute join, spatial join, spatial filter, and nearest', async () => {
    const rt = await getRuntime();
    const polygons = await dataset(POLYGONS);
    const points = await dataset(POINTS);

    const joinedById = await attributeJoin(
      polygons,
      points,
      { leftKey: 'id', rightKey: 'id', joinType: 'left' },
      rt,
    );
    expect(joinedById.layers[0]?.shapes?.length).toBe(2);

    const spatialJoined = await spatialJoin(
      polygons,
      points,
      { predicate: 'contains', joinType: 'left' },
      rt,
    );
    expect(spatialJoined.layers[0]?.shapes?.length).toBeGreaterThanOrEqual(2);

    const filtered = await spatialFilter(polygons, points, { predicate: 'contains' }, rt);
    expect(filtered.layers[0]?.shapes?.length).toBe(2);

    const nearestResult = await nearest(polygons, points, { nearestIdField: 'id' }, rt);
    const records = nearestResult.layers[0]?.data?.getRecords?.() ?? [];
    expect(records).toHaveLength(2);
    expect(records[0]?.nearest_id).toBeDefined();
    expect(records[0]?.nearest_distance).toBeDefined();
  });

  it.each([
    'mixed',
    'all-null',
    'empty',
  ] as const)('reproject preserves %s geometry rows and attributes', async (mode) => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const layer = input.layers[0]!;
    if (mode === 'mixed') layer.shapes![1] = null;
    if (mode === 'all-null') layer.shapes = layer.shapes!.map(() => null);
    if (mode === 'empty') {
      layer.shapes = [];
      layer.data!.getRecords().splice(0);
    }
    const before = structuredClone(layer.data!.getRecords());
    const result = await reproject(input, { targetCrs: 'EPSG:4326' }, rt);
    expect(result.layers[0]?.data?.getRecords() ?? []).toEqual(before);
    expect(result.layers[0]?.shapes ?? []).toHaveLength(layer.shapes!.length);
    expect(result.info?.crs_string).toBe('EPSG:4326');
    expect(result.layers[0]?.geometry_type).toBe('point');
    expect(input.info?.crs_string).toBe('EPSG:3857');
    if (mode === 'mixed') expect(result.layers[0]?.shapes?.[1]).toBeNull();
    if (mode === 'all-null') expect(result.layers[0]?.shapes).toEqual([null, null, null]);
  });

  it.each([
    'direct',
    'toolbox',
  ] as const)('nearest rejects geographic and unknown CRS through the %s entry point', async (entry) => {
    const rt = await getRuntime();
    for (const crs of ['EPSG:4326', 'EPSG:4490', undefined]) {
      const input = await dataset(POINTS);
      const reference = await dataset(POINTS);
      input.info = crs ? { crs_string: crs } : {};
      const run = () =>
        entry === 'direct'
          ? nearest(input, reference, {}, rt)
          : duckDbToolbox.execute('nearest', { inputs: { input, reference }, runtime: rt });
      await expect(Promise.resolve().then(run)).rejects.toMatchObject({
        kind: 'validation',
        field: 'crs',
      });
    }
  });

  it('nearest isolates generated IDs from user fields and breaks distance ties by row order', async () => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const reference = await dataset(POINTS);
    reference.layers[0]!.data!.getRecords().forEach((record, index) => {
      record.__nearest_rowid = 777 + index;
      record.__NEAREST_ROWID_1 = 888 + index;
    });
    const result = await nearest(input, reference, {}, rt);
    expect(result.layers[0]?.data?.getRecords().map((record) => record.nearest_id)).toEqual([
      0, 1, 2,
    ]);
    expect(result.layers[0]?.data?.getRecords().map((record) => record.nearest_distance)).toEqual([
      0, 0, 0,
    ]);
    reference.layers[0]!.shapes![1] = reference.layers[0]!.shapes![0];
    const tied = await nearest(input, reference, {}, rt);
    expect(tied.layers[0]?.data?.getRecords()[0]?.nearest_id).toBe(0);
  });

  it('nearest rejects colliding output columns instead of overwriting input attributes', async () => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const reference = await dataset(POINTS);
    input.layers[0]!.data!.getRecords()[0]!.NEAREST_ID = 123;
    await expect(
      Promise.resolve().then(() => nearest(input, reference, {}, rt)),
    ).rejects.toMatchObject({
      kind: 'validation',
      field: 'outputNearestIdColumn',
    });
    await expect(
      Promise.resolve().then(() =>
        nearest(
          input,
          reference,
          {
            outputNearestIdColumn: 'distance',
            outputDistanceColumn: 'DISTANCE',
          },
          rt,
        ),
      ),
    ).rejects.toMatchObject({ kind: 'validation', field: 'outputDistanceColumn' });
  });

  it('nearest leaves null geometry unmatched rather than assigning an arbitrary feature', async () => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const reference = await dataset(POINTS);
    input.layers[0]!.shapes![1] = null;
    const result = await nearest(input, reference, {}, rt);
    expect(result.layers[0]?.data?.getRecords()[1]).toMatchObject({
      id: 2,
      nearest_id: null,
      nearest_distance: null,
    });
  });

  it.each([
    'all-null-input',
    'empty-reference',
    'null-reference',
  ] as const)('nearest handles %s without losing records or geometry type', async (mode) => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const reference = await dataset(POINTS);
    if (mode === 'all-null-input') input.layers[0]!.shapes = [null, null, null];
    if (mode === 'null-reference') reference.layers[0]!.shapes = [null, null, null];
    if (mode === 'empty-reference') {
      reference.layers[0]!.shapes = [];
      reference.layers[0]!.data!.getRecords().splice(0);
    }
    const result = await nearest(input, reference, {}, rt);
    expect(result.layers[0]?.geometry_type).toBe('point');
    expect(result.layers[0]?.shapes).toHaveLength(3);
    expect(
      result.layers[0]?.data
        ?.getRecords()
        .map((record) => [record.id, record.nearest_id, record.nearest_distance]),
    ).toEqual([
      [1, null, null],
      [2, null, null],
      [3, null, null],
    ]);
  });

  it('runs merge and reproject', async () => {
    const rt = await getRuntime();
    const left = await dataset(POLYGONS);
    const right = await dataset(MASK);

    const merged = await merge(left, right, {}, rt);
    expect(merged.layers[0]?.shapes?.length).toBe(3);

    const projected = await reproject(left, { sourceCrs: 'EPSG:3857', targetCrs: 'EPSG:4326' }, rt);
    expect(projected.layers[0]?.shapes?.length).toBe(2);
  });
});

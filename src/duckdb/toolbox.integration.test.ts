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
  const result = await datasetFromGeoJSON(fc, { crs });
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
  });

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

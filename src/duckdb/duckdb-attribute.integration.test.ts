import { tableToIPC, type Table } from 'apache-arrow';
import type * as DuckDBBundles from '@duckdb/duckdb-wasm/blocking';
import { afterAll, describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import {
  areaDatasetWithDuckDb,
  centroidXDatasetWithDuckDb,
  centroidYDatasetWithDuckDb,
  geometryTypeDatasetWithDuckDb,
  isValidDatasetWithDuckDb,
  xDatasetWithDuckDb,
  yDatasetWithDuckDb,
} from './duckdb-attribute-ops';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';

const describeDuckDbIntegration = process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const POLYGON_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'parcel-a' },
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
  ],
};

const POINT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'point-a' },
      geometry: { type: 'Point', coordinates: [3, 4] },
    },
  ],
};

type BlockingDuckDbConnectionLike = {
  insertArrowFromIPCStream(buffer: Uint8Array, opts: { name: string; create?: boolean }): void;
  query(sql: string): Table;
  close(): void;
};

let runtime: DuckDbRuntime | undefined;

async function datasetFromFeatureCollection(
  featureCollection: unknown,
  crs = 'EPSG:3857',
): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(featureCollection);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

async function createBlockingDuckDbRuntime(): Promise<DuckDbRuntime> {
  const duckdb = await import('@duckdb/duckdb-wasm/blocking');
  const bundles = {
    mvp: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker: null,
    },
  } satisfies DuckDBBundles.DuckDBBundles;
  const db = await duckdb.createDuckDB(bundles, new duckdb.ConsoleLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  let spatialReady: Promise<void> | undefined;

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
    async ensureSpatial() {
      spatialReady ??= (async () => {
        const conn = wrapConnection();
        await conn.query('INSTALL spatial; LOAD spatial;');
        await conn.close?.();
      })();
      await spatialReady;
    },
    async close() {
      await (db as { terminate?: () => void | Promise<void> }).terminate?.();
    },
  };
}

async function getIntegrationRuntime(): Promise<DuckDbRuntime> {
  runtime ??= await createBlockingDuckDbRuntime();
  return runtime;
}

afterAll(async () => {
  await runtime?.close?.();
});

describeDuckDbIntegration('DuckDB-Wasm attribute integration', () => {
  it('adds projected area attributes without replacing geometry', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const dataset = await datasetFromFeatureCollection(POLYGON_FC);

    const result = await areaDatasetWithDuckDb(dataset, { outputLayer: 'area' }, duckDbRuntime);

    const records = result.layers[0]?.data?.getRecords?.();
    expect(result.layers[0]?.name).toBe('area');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(records?.[0]?.name).toBe('parcel-a');
    expect(records?.[0]?.duckdb_area).toBe(100);
  }, 60_000);

  it('adds geometry type, validity, and point coordinate attributes', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const pointDataset = await datasetFromFeatureCollection(POINT_FC, 'EPSG:4326');

    const withType = await geometryTypeDatasetWithDuckDb(pointDataset, {}, duckDbRuntime);
    const withValidity = await isValidDatasetWithDuckDb(pointDataset, {}, duckDbRuntime);
    const withX = await xDatasetWithDuckDb(pointDataset, {}, duckDbRuntime);
    const withY = await yDatasetWithDuckDb(pointDataset, {}, duckDbRuntime);

    expect(withType.layers[0]?.data?.getRecords?.()[0]?.duckdb_geometry_type).toBeTruthy();
    expect(withValidity.layers[0]?.data?.getRecords?.()[0]?.duckdb_is_valid).toBe(true);
    expect(withX.layers[0]?.data?.getRecords?.()[0]?.duckdb_x).toBe(3);
    expect(withY.layers[0]?.data?.getRecords?.()[0]?.duckdb_y).toBe(4);
  }, 60_000);

  it('adds coordinate attributes for WGS84 polygons using centroid coordinates', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const polygonDataset = await datasetFromFeatureCollection(POLYGON_FC, 'EPSG:4326');

    const withX = await centroidXDatasetWithDuckDb(polygonDataset, {}, duckDbRuntime);
    const withY = await centroidYDatasetWithDuckDb(polygonDataset, {}, duckDbRuntime);

    expect(withX.layers[0]?.data?.getRecords?.()[0]?.duckdb_centroid_x).toBe(5);
    expect(withY.layers[0]?.data?.getRecords?.()[0]?.duckdb_centroid_y).toBe(5);
  }, 60_000);
});

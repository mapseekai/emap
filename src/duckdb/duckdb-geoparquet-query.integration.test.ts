import { createRequire } from 'node:module';
import type { Table } from 'apache-arrow';
import type { DuckDBBundles } from '@duckdb/duckdb-wasm/blocking';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportGeoParquet } from '../arrow/geoparquet-io';
import { datasetFromGeoJSON, injectParquetWasmForTests } from '../arrow/test-utils';
import { queryGeoParquetWithDuckDb } from './duckdb-geoparquet-query-op';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const POINT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'alpha', population: 100, active: false },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    {
      type: 'Feature',
      properties: { name: 'beta', population: 200, active: true },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
    {
      type: 'Feature',
      properties: { name: 'gamma', population: 300, active: true },
      geometry: { type: 'Point', coordinates: [2, 2] },
    },
  ],
};

const require = createRequire(import.meta.url);
let runtime: DuckDbRuntime | undefined;

type BlockingDuckDbConnectionLike = {
  query(sql: string): Table;
  close(): void;
};

async function geoParquetBytes(): Promise<Uint8Array> {
  const dataset = await datasetFromGeoJSON(POINT_FC);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
  return exportGeoParquet(dataset, { reprojectToWgs84: false });
}

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

  function wrapConnection(): DuckDbConnection {
    const conn = db.connect() as unknown as BlockingDuckDbConnectionLike;
    return {
      async insertArrowTable() {
        throw new Error('queryGeoParquetWithDuckDb should not insert Arrow tables');
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
      throw new Error('queryGeoParquetWithDuckDb should not load the DuckDB spatial extension');
    },
    async registerFileBuffer(name, buffer) {
      const fileDb = db as {
        registerFileBuffer(name: string, buffer: Uint8Array): void;
      };
      fileDb.registerFileBuffer(name, buffer);
    },
    async dropFile(name) {
      const fileDb = db as { dropFile?: (name: string) => void };
      fileDb.dropFile?.(name);
    },
    async close() {
      await (db as { terminate?: () => Promise<unknown> }).terminate?.();
    },
  };
}

async function getIntegrationRuntime(): Promise<DuckDbRuntime> {
  runtime ??= await createBlockingDuckDbRuntime();
  return runtime;
}

afterAll(async () => {
  await runtime?.close?.();
  runtime = undefined;
});

describeDuckDbIntegration('DuckDB-Wasm GeoParquet query integration', () => {
  beforeAll(async () => {
    await injectParquetWasmForTests();
  });

  it('filters GeoParquet bytes with DuckDB read_parquet and returns a map layer', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const bytes = await geoParquetBytes();

    const result = await queryGeoParquetWithDuckDb(
      bytes,
      {
        layerName: 'active_points',
        sql: 'SELECT geometry, name, population FROM input WHERE active = true ORDER BY population DESC LIMIT 1',
      },
      duckDbRuntime,
    );

    expect(result.layers[0]?.name).toBe('active_points');
    expect(result.layers[0]?.geometry_type).toBe('point');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(result.layers[0]?.data?.getRecords?.()).toEqual([{ name: 'gamma', population: 300 }]);
    expect(result.info?.crs_string).toBe('EPSG:4326');
  }, 60_000);

  it('fails when the projection omits geometry', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const bytes = await geoParquetBytes();

    await expect(
      queryGeoParquetWithDuckDb(bytes, { sql: 'SELECT name FROM input' }, duckDbRuntime),
    ).rejects.toMatchObject({ kind: 'conversion-failed' });
  }, 60_000);

  it('blocks direct read_parquet SQL before execution', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const bytes = await geoParquetBytes();

    await expect(
      queryGeoParquetWithDuckDb(
        bytes,
        { sql: "SELECT * FROM read_parquet('other.parquet')" },
        duckDbRuntime,
      ),
    ).rejects.toMatchObject({ kind: 'validation' });
  }, 60_000);
});

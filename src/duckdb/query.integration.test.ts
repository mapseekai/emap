import { createRequire } from 'node:module';
import { tableToIPC, type Table } from 'apache-arrow';
import type { DuckDBBundles } from '@duckdb/duckdb-wasm/blocking';
import { afterAll, describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { queryDatasetWithDuckDb } from './query-executor';
import type { DuckDbConnection, DuckDbRuntime } from './runtime';

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
  insertArrowFromIPCStream(buffer: Uint8Array, opts: { name: string; create?: boolean }): void;
  query(sql: string): Table;
  close(): void;
};

async function pointDataset(): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POINT_FC);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
  return dataset;
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
      throw new Error('queryDatasetWithDuckDb should not load the DuckDB spatial extension');
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

describeDuckDbIntegration('DuckDB-Wasm query integration', () => {
  it('filters, projects, orders, and limits rows with the real DuckDB-Wasm runtime', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const dataset = await pointDataset();

    const result = await queryDatasetWithDuckDb(
      dataset,
      {
        sql: 'SELECT name, population, active FROM input WHERE active = true ORDER BY population DESC LIMIT 1',
        outputLayer: 'top_active',
      },
      duckDbRuntime,
    );

    expect(result.layers[0]?.name).toBe('top_active');
    expect(result.layers[0]?.data?.getRecords?.()).toEqual([
      { name: 'gamma', population: 300, active: true },
    ]);
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(result.info?.crs_string).toBe('EPSG:4326');
  }, 60_000);

  it('blocks unsafe SQL before DuckDB execution', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const dataset = await pointDataset();

    await expect(
      queryDatasetWithDuckDb(
        dataset,
        { sql: 'DROP TABLE input', outputLayer: 'dropped' },
        duckDbRuntime,
      ),
    ).rejects.toMatchObject({ kind: 'validation' });
  }, 60_000);
});

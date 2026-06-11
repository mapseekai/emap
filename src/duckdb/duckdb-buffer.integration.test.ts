import { createRequire } from 'node:module';
import { tableToIPC, type Table } from 'apache-arrow';
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import { afterAll, describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { bufferDatasetWithDuckDb } from './duckdb-buffer';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';

const describeDuckDbIntegration = process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const POLYGON_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'a' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
            [0, 0],
          ],
        ],
      },
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

async function step<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? `; cause: ${err.cause.message}` : '';
    throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}${cause}`, { cause: err });
  }
}

async function polygonDataset(): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POLYGON_FC);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
  return dataset;
}

async function createBlockingDuckDbRuntime(): Promise<DuckDbRuntime> {
  const bundles = {
    mvp: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker: '',
    },
    eh: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
      mainWorker: '',
    },
  } satisfies duckdb.DuckDBBundles;
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
      spatialReady ??= (async () => {
        const conn = wrapConnection();
        try {
          await conn.query('INSTALL spatial; LOAD spatial;');
        } finally {
          await conn.close?.();
        }
      })();
      return spatialReady;
    },
    async close() {},
  };
}

afterAll(async () => {
  await runtime?.close?.();
});

describeDuckDbIntegration('DuckDB-Wasm buffer integration', () => {
  it('buffers a projected polygon dataset with the real DuckDB-Wasm runtime', async () => {
    const adapter = await step('create mapshaper adapter', () => getDefaultMapshaperAdapter());
    const dataset = await step('create input dataset', () => polygonDataset());
    const inputBounds = adapter.getDatasetBounds(dataset);
    runtime = await step('create DuckDB-Wasm runtime', () => createBlockingDuckDbRuntime());

    const result = await step('buffer dataset with DuckDB-Wasm', () =>
      bufferDatasetWithDuckDb(dataset, { distance: 10, outputLayer: 'buffered' }, runtime),
    );
    const resultBounds = adapter.getDatasetBounds(result);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.name).toBe('buffered');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(result.info?.crs_string).toBe('EPSG:3857');
    expect(resultBounds.xmin).toBeLessThan(inputBounds.xmin);
    expect(resultBounds.ymin).toBeLessThan(inputBounds.ymin);
    expect(resultBounds.xmax).toBeGreaterThan(inputBounds.xmax);
    expect(resultBounds.ymax).toBeGreaterThan(inputBounds.ymax);
  }, 60_000);
});

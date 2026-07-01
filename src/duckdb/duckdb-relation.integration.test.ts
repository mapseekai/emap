import { createRequire } from 'node:module';
import { tableToIPC, type Table } from 'apache-arrow';
import type * as DuckDBBundles from '@duckdb/duckdb-wasm/blocking';
import { afterAll, describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type MapshaperDataset from '../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import {
  distanceDatasetWithDuckDb,
  distanceWithinDatasetWithDuckDb,
  intersectsAttributeDatasetWithDuckDb,
  intersectsDatasetWithDuckDb,
} from './duckdb-relation-ops';

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const INPUT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'touching' },
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
      properties: { id: 'near' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [15, 0],
            [25, 0],
            [25, 10],
            [15, 10],
            [15, 0],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { id: 'far' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [50, 0],
            [60, 0],
            [60, 10],
            [50, 10],
            [50, 0],
          ],
        ],
      },
    },
  ],
};

const MASK_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'mask' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [5, -5],
            [12, -5],
            [12, 12],
            [5, 12],
            [5, -5],
          ],
        ],
      },
    },
  ],
};

let runtime: DuckDbRuntime | undefined;

type BlockingDuckDbConnectionLike = {
  insertArrowFromIPCStream(buffer: Uint8Array, opts: { name: string; create?: boolean }): void;
  query(sql: string): Table;
  close(): void;
};

async function createBlockingDuckDbRuntime(): Promise<DuckDbRuntime> {
  const require = createRequire(import.meta.url);
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
  } satisfies DuckDBBundles.DuckDBBundles;
  const db = await duckdb.createDuckDB(bundles, new duckdb.ConsoleLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  let spatialReady: Promise<void> | null = null;

  function wrapConnection(): DuckDbConnection {
    const conn = db.connect() as BlockingDuckDbConnectionLike;
    return {
      async insertArrowTable(table, opts) {
        conn.insertArrowFromIPCStream(tableToIPC(table), {
          name: opts.name,
          create: true,
        });
      },
      async query(sql) {
        return conn.query(sql);
      },
      async close() {
        conn.close();
      },
    };
  }

  function createSpatialReadyPromise(): Promise<void> {
    const ready = (async () => {
      const conn = wrapConnection();
      try {
        await conn.query('INSTALL spatial; LOAD spatial;');
      } finally {
        conn.close?.();
      }
    })();

    ready.catch(() => {
      if (spatialReady === ready) spatialReady = null;
    });

    return ready;
  }

  return {
    async connect(): Promise<DuckDbConnection> {
      return wrapConnection();
    },
    async ensureSpatial(): Promise<void> {
      spatialReady ??= createSpatialReadyPromise();
      return spatialReady;
    },
    async close() {
      await (db as { terminate?: () => Promise<unknown> }).terminate?.();
    },
  };
}

afterAll(async () => {
  await runtime?.close?.();
  runtime = undefined;
});

async function getIntegrationRuntime(): Promise<DuckDbRuntime> {
  runtime ??= await createBlockingDuckDbRuntime();
  return runtime;
}

async function relationDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(INPUT_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

async function maskDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(MASK_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

function records(dataset: MapshaperDataset): Array<Record<string, unknown>> {
  return dataset.layers[0]?.data?.getRecords?.() ?? [];
}

describeDuckDbIntegration('DuckDB-Wasm relation integration', () => {
  it('filters projected polygons that intersect a mask polygon', async () => {
    const input = await relationDataset();
    const mask = await maskDataset();
    const duckDbRuntime = await getIntegrationRuntime();

    const result = await intersectsDatasetWithDuckDb(input, mask, {}, duckDbRuntime);

    expect(records(result).map((record) => record.id)).toEqual(['touching']);
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(result.info?.crs_string).toBe('EPSG:3857');
  }, 60_000);

  it('adds intersects attributes with true and false values', async () => {
    const input = await relationDataset();
    const mask = await maskDataset();
    const duckDbRuntime = await getIntegrationRuntime();

    const result = await intersectsAttributeDatasetWithDuckDb(input, mask, {}, duckDbRuntime);

    expect(
      records(result).map((record) => ({
        id: record.id,
        intersects: record.duckdb_intersects,
      })),
    ).toEqual([
      { id: 'touching', intersects: true },
      { id: 'near', intersects: false },
      { id: 'far', intersects: false },
    ]);
  }, 60_000);

  it('adds minimum distance attributes', async () => {
    const input = await relationDataset();
    const mask = await maskDataset();
    const duckDbRuntime = await getIntegrationRuntime();

    const result = await distanceDatasetWithDuckDb(input, mask, {}, duckDbRuntime);

    expect(
      records(result).map((record) => ({
        id: record.id,
        distance: record.duckdb_distance,
      })),
    ).toEqual([
      { id: 'touching', distance: 0 },
      { id: 'near', distance: 3 },
      { id: 'far', distance: 38 },
    ]);
  }, 60_000);

  it('filters rows by distanceWithin threshold', async () => {
    const input = await relationDataset();
    const mask = await maskDataset();
    const duckDbRuntime = await getIntegrationRuntime();

    const result = await distanceWithinDatasetWithDuckDb(
      input,
      mask,
      { distance: 4 },
      duckDbRuntime,
    );

    expect(records(result).map((record) => record.id)).toEqual(['touching', 'near']);
    expect(result.layers[0]?.shapes).toHaveLength(2);
  }, 60_000);

  it('allows WGS84 topological relations', async () => {
    const input = await relationDataset('EPSG:4326');
    const mask = await maskDataset('EPSG:4326');
    const duckDbRuntime = await getIntegrationRuntime();

    const result = await intersectsDatasetWithDuckDb(input, mask, {}, duckDbRuntime);

    expect(records(result).map((record) => record.id)).toEqual(['touching']);
    expect(result.info?.crs_string).toBe('EPSG:4326');
  }, 60_000);

  it('rejects WGS84 distance operations by default', async () => {
    const input = await relationDataset('EPSG:4326');
    const mask = await maskDataset('EPSG:4326');
    const duckDbRuntime = await getIntegrationRuntime();

    let error: unknown;
    try {
      await distanceDatasetWithDuckDb(input, mask, {}, duckDbRuntime);
    } catch (err) {
      error = err;
    }

    expect(error).toMatchObject({
      kind: 'validation',
      field: 'crs',
    });
  }, 60_000);

  it('runs WGS84 distance operations when geographic CRS failures are disabled', async () => {
    const input = await relationDataset('EPSG:4326');
    const mask = await maskDataset('EPSG:4326');
    const duckDbRuntime = await getIntegrationRuntime();

    const result = await distanceDatasetWithDuckDb(
      input,
      mask,
      { failOnGeographicCrs: false },
      duckDbRuntime,
    );

    expect(records(result).map((record) => record.duckdb_distance)).toEqual([0, 3, 38]);
    expect(result.info?.crs_string).toBe('EPSG:4326');
  }, 60_000);
});

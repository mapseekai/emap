import { createRequire } from 'node:module';
import { tableToIPC, type Table } from 'apache-arrow';
import type * as DuckDBBundles from '@duckdb/duckdb-wasm/blocking';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import { setDuckDbRuntime } from './duckdb-runtime';
import { differenceDatasetWithDuckDb, intersectionDatasetWithDuckDb } from './duckdb-overlay-ops';

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const INPUT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1, name: 'keep' },
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

const MASK_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { maskName: 'clip' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [5, 0],
            [5, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

const EMPTY_MASK_FC = {
  type: 'FeatureCollection',
  features: [],
};

let runtime: DuckDbRuntime | undefined;

type BlockingDuckDbConnectionLike = {
  insertArrowFromIPCStream(buffer: Uint8Array, opts: { name: string; create?: boolean }): void;
  query(sql: string): Table;
  close(): void;
};

async function createDuckDbTestRuntime(): Promise<DuckDbRuntime> {
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

  function createSpatialReadyPromise(): Promise<void> {
    const ready = (async () => {
      const conn = wrapConnection();
      try {
        await conn.query('INSTALL spatial; LOAD spatial;');
      } finally {
        await conn.close?.();
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

async function getIntegrationRuntime(): Promise<DuckDbRuntime> {
  runtime ??= await createDuckDbTestRuntime();
  return runtime;
}

async function polygonDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(INPUT_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

async function maskDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(MASK_FC);
}

async function emptyMaskDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(EMPTY_MASK_FC);
}

function records(dataset: MapshaperDataset): Array<Record<string, unknown>> {
  return dataset.layers[0]?.data?.getRecords?.() ?? [];
}

function exportedCoordinates(dataset: MapshaperDataset): unknown {
  const [file] = getDefaultMapshaperAdapter().exportFileContent(dataset, { format: 'geojson' });
  const geojson = JSON.parse(String(file.content)) as {
    features: Array<{ geometry: { coordinates: unknown } }>;
  };
  return geojson.features[0]?.geometry.coordinates;
}

function firstRingCoordinateKeys(dataset: MapshaperDataset): string[] {
  const coordinates = exportedCoordinates(dataset) as number[][][] | undefined;
  return coordinates?.[0]?.map(([x, y]) => `${x},${y}`) ?? [];
}

beforeAll(async () => {
  setDuckDbRuntime(await getIntegrationRuntime());
});

afterAll(async () => {
  setDuckDbRuntime(null);
  await runtime?.close?.();
  runtime = undefined;
});

describeDuckDbIntegration('DuckDB-Wasm overlay integration', () => {
  it('clips polygon geometry with the mask, preserves input attributes, and inherits input CRS', async () => {
    const input = await polygonDataset('EPSG:26910');
    const mask = await maskDataset();

    const result = await intersectionDatasetWithDuckDb(input, mask, {
      outputLayer: 'clipped_polygons',
    });

    expect(result.layers[0]?.name).toBe('clipped_polygons');
    expect(result.layers[0]?.geometry_type).toBe('polygon');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(records(result)).toEqual([{ id: 1, name: 'keep' }]);
    expect(firstRingCoordinateKeys(result)).toEqual(
      expect.arrayContaining(['0,0', '5,0', '5,10', '0,10']),
    );
    expect(firstRingCoordinateKeys(result)).toHaveLength(5);
    expect(result.info?.crs_string).toBe('EPSG:26910');
  }, 60_000);

  it('erases mask coverage and omits mask attributes', async () => {
    const input = await polygonDataset();
    const mask = await maskDataset();

    const result = await differenceDatasetWithDuckDb(input, mask, {
      outputLayer: 'erased_polygons',
    });

    expect(result.layers[0]?.name).toBe('erased_polygons');
    expect(result.layers[0]?.geometry_type).toBe('polygon');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(records(result)).toEqual([{ id: 1, name: 'keep' }]);
    expect(records(result)[0]).not.toHaveProperty('maskName');
    expect(firstRingCoordinateKeys(result)).toEqual(
      expect.arrayContaining(['5,0', '10,0', '10,10', '5,10']),
    );
    expect(firstRingCoordinateKeys(result)).toHaveLength(5);
  }, 60_000);

  it('returns zero rows with the requested layer name for intersection with an empty mask', async () => {
    const input = await polygonDataset();
    const mask = await emptyMaskDataset();

    const result = await intersectionDatasetWithDuckDb(input, mask, {
      outputLayer: 'empty_intersection',
    });

    expect(result.layers[0]?.name).toBe('empty_intersection');
    expect(result.layers[0]?.shapes ?? []).toEqual([]);
    expect(records(result)).toEqual([]);
  }, 60_000);

  it('keeps non-null input rows with the requested layer name for difference with an empty mask', async () => {
    const input = await polygonDataset();
    const mask = await emptyMaskDataset();

    const result = await differenceDatasetWithDuckDb(input, mask, {
      outputLayer: 'empty_difference',
    });

    expect(result.layers[0]?.name).toBe('empty_difference');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(records(result)).toEqual([{ id: 1, name: 'keep' }]);
  }, 60_000);
});

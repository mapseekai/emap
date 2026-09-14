import { tableToIPC, type Table } from 'apache-arrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { getDefaultMapshaperAdapter } from '../../../src/integrations/mapshaper/adapter';
import { toArrowTable } from '../../../src/integrations/arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../../../src/integrations/arrow/test-utils';
import type { MapshaperDataset } from '../../../src/shared/types/mapshaper-types';
import {
  type DuckDbConnection,
  type DuckDbRuntime,
} from '../../../src/integrations/duckdb/runtime';
import { difference, intersect } from '../../../src/integrations/duckdb/overlay/index';
import { OVERLAY_OPERATIONS } from '../../../src/integrations/duckdb/overlay/_shared';

const INPUT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'parcel-a', zone: 'A' },
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
      properties: { id: 'mask-a' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [5, 5],
            [15, 5],
            [15, 15],
            [5, 15],
            [5, 5],
          ],
        ],
      },
    },
  ],
};

async function inputDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(INPUT_FC);
}

async function maskDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(MASK_FC);
}

class CaptureConnection implements DuckDbConnection {
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];

  constructor(private readonly resultTable: Table) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    return this.resultTable;
  }

  async close(): Promise<void> {}
}

class CaptureRuntime implements DuckDbRuntime {
  readonly connection: CaptureConnection;

  constructor(resultTable: Table) {
    this.connection = new CaptureConnection(resultTable);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {}
}

async function runtimeFor(dataset: MapshaperDataset): Promise<CaptureRuntime> {
  return new CaptureRuntime(toArrowTable(dataset, { encoding: 'wkb' }));
}

describe('DuckDB overlay operations', () => {
  it('defines the canonical intersect and difference descriptors', () => {
    expect(OVERLAY_OPERATIONS).toEqual({
      intersect: { id: 'intersect', duckDbFunction: 'ST_Intersection' },
      difference: { id: 'difference', duckDbFunction: 'ST_Difference' },
    });
  });

  it('runs intersection SQL and preserves the output layer name', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const runtime = await runtimeFor(input);

    const result = await intersect(input, mask, { outputLayer: 'clipped' }, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Intersection');
    expect(result.layers[0]?.name).toBe('clipped');
  });

  it('runs difference SQL', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const runtime = await runtimeFor(input);

    await difference(input, mask, {}, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Difference');
  });
});

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const INTEGRATION_INPUT_FC = {
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

const INTEGRATION_MASK_FC = {
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

const EMPTY_INTEGRATION_MASK_FC = {
  type: 'FeatureCollection',
  features: [],
};

let integrationRuntime: DuckDbRuntime | undefined;

type IntegrationBlockingDuckDbConnectionLike = {
  insertArrowFromIPCStream(buffer: Uint8Array, opts: { name: string; create?: boolean }): void;
  query(sql: string): Table;
  close(): void;
};

async function createDuckDbTestRuntime(): Promise<DuckDbRuntime> {
  const integrationRequire = createRequire(import.meta.url);
  const duckdb = await import('@duckdb/duckdb-wasm/blocking');
  const bundles = {
    mvp: {
      mainModule: integrationRequire.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker: '',
    },
    eh: {
      mainModule: integrationRequire.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
      mainWorker: '',
    },
  } satisfies DuckDBBundles.DuckDBBundles;
  const db = await duckdb.createDuckDB(bundles, new duckdb.ConsoleLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  let spatialReady: Promise<void> | null = null;

  function wrapConnection(): DuckDbConnection {
    const conn = db.connect() as unknown as IntegrationBlockingDuckDbConnectionLike;
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
  integrationRuntime ??= await createDuckDbTestRuntime();
  return integrationRuntime;
}

async function polygonDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(INTEGRATION_INPUT_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

async function integrationMaskDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(INTEGRATION_MASK_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

async function emptyMaskDataset(): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(EMPTY_INTEGRATION_MASK_FC);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
  return dataset;
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
  await getIntegrationRuntime();
});

afterAll(async () => {
  await integrationRuntime?.close?.();
  integrationRuntime = undefined;
});

const bound = {
  intersect: (
    input: MapshaperDataset,
    mask: MapshaperDataset,
    options?: Parameters<typeof intersect>[2],
  ) => intersect(input, mask, options, integrationRuntime),
  difference: (
    input: MapshaperDataset,
    mask: MapshaperDataset,
    options?: Parameters<typeof difference>[2],
  ) => difference(input, mask, options, integrationRuntime),
};

describeDuckDbIntegration('DuckDB-Wasm overlay integration', () => {
  it('clips polygon geometry with the mask, preserves input attributes, and inherits input CRS', async () => {
    const input = await polygonDataset('EPSG:26910');
    const mask = await integrationMaskDataset('EPSG:26910');

    const result = await bound.intersect(input, mask, {
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
    const mask = await integrationMaskDataset();

    const result = await bound.difference(input, mask, {
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

    const result = await bound.intersect(input, mask, {
      outputLayer: 'empty_intersection',
    });

    expect(result.layers[0]?.name).toBe('empty_intersection');
    expect(result.layers[0]?.shapes ?? []).toEqual([]);
    expect(records(result)).toEqual([]);
  }, 60_000);

  it('keeps non-null input rows with the requested layer name for difference with an empty mask', async () => {
    const input = await polygonDataset();
    const mask = await emptyMaskDataset();

    const result = await bound.difference(input, mask, {
      outputLayer: 'empty_difference',
    });

    expect(result.layers[0]?.name).toBe('empty_difference');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(records(result)).toEqual([{ id: 1, name: 'keep' }]);
  }, 60_000);
});

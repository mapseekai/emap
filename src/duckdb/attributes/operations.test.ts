import { createRequire } from 'node:module';
import { tableToIPC, type Table } from 'apache-arrow';
import type * as DuckDBBundles from '@duckdb/duckdb-wasm/blocking';
import { afterAll, describe, expect, it } from 'vitest';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../../arrow/test-utils';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import {
  area,
  centroidX,
  centroidY,
  geometryType,
  isEmpty,
  isSimple,
  isValid,
  length,
  perimeter,
  x,
  y,
} from './index';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';

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

async function polygonDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POLYGON_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

class FakeConnection implements DuckDbConnection {
  readonly queries: string[] = [];

  constructor(private readonly resultTable: Table) {}

  async insertArrowTable(): Promise<void> {}

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    return this.resultTable;
  }

  async close(): Promise<void> {}
}

class FakeRuntime implements DuckDbRuntime {
  readonly connection: FakeConnection;
  ensureSpatialCalls = 0;

  constructor(resultTable: Table) {
    this.connection = new FakeConnection(resultTable);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {
    this.ensureSpatialCalls += 1;
  }
}

async function runtimeFor(dataset: MapshaperDataset): Promise<FakeRuntime> {
  return new FakeRuntime(toArrowTable(dataset, { encoding: 'wkb' }));
}

describe('DuckDB attribute operations', () => {
  const projectedCases = [
    {
      name: 'area',
      helper: area,
      fn: 'ST_Area',
      column: 'duckdb_area',
    },
    {
      name: 'length',
      helper: length,
      fn: 'ST_Length',
      column: 'duckdb_length',
    },
    {
      name: 'perimeter',
      helper: perimeter,
      fn: 'ST_Perimeter',
      column: 'duckdb_perimeter',
    },
  ];

  it.each(projectedCases)('$name rejects geographic CRS by default', async ({ helper }) => {
    const dataset = await polygonDataset('EPSG:4326');
    const runtime = await runtimeFor(dataset);

    await expect(helper(dataset, {}, runtime)).rejects.toMatchObject({
      kind: 'validation',
      field: 'crs',
    });
  });

  it.each(projectedCases)('$name can opt out of geographic CRS rejection', async ({
    helper,
    fn,
    column,
  }) => {
    const dataset = await polygonDataset('EPSG:4326');
    const runtime = await runtimeFor(dataset);

    await helper(dataset, { failOnGeographicCrs: false }, runtime);

    expect(runtime.ensureSpatialCalls).toBe(1);
    expect(runtime.connection.queries[0]).toContain(`${fn}("geometry") AS "${column}"`);
  });

  const geographicCases = [
    {
      name: 'geometryType',
      helper: geometryType,
      expression: 'ST_GeometryType("geometry")',
      column: 'duckdb_geometry_type',
    },
    {
      name: 'isValid',
      helper: isValid,
      expression: 'ST_IsValid("geometry")',
      column: 'duckdb_is_valid',
    },
    {
      name: 'isEmpty',
      helper: isEmpty,
      expression: 'ST_IsEmpty("geometry")',
      column: 'duckdb_is_empty',
    },
    {
      name: 'isSimple',
      helper: isSimple,
      expression: 'ST_IsSimple("geometry")',
      column: 'duckdb_is_simple',
    },
    {
      name: 'x',
      helper: x,
      expression: 'ST_X("geometry")',
      column: 'duckdb_x',
    },
    {
      name: 'y',
      helper: y,
      expression: 'ST_Y("geometry")',
      column: 'duckdb_y',
    },
    {
      name: 'centroidX',
      helper: centroidX,
      expression: 'ST_X(ST_Centroid("geometry"))',
      column: 'duckdb_centroid_x',
    },
    {
      name: 'centroidY',
      helper: centroidY,
      expression: 'ST_Y(ST_Centroid("geometry"))',
      column: 'duckdb_centroid_y',
    },
  ];

  it.each(geographicCases)('$name runs without geographic CRS rejection', async ({
    helper,
    expression,
    column,
  }) => {
    const dataset = await polygonDataset('EPSG:4326');
    const runtime = await runtimeFor(dataset);

    await helper(dataset, { outputLayer: 'attrs' }, runtime);

    expect(runtime.ensureSpatialCalls).toBe(1);
    expect(runtime.connection.queries[0]).toContain(`${expression} AS "${column}"`);
  });

  it('uses caller-provided output column names', async () => {
    const dataset = await polygonDataset();
    const runtime = await runtimeFor(dataset);

    await area(dataset, { outputColumn: 'computed_area' }, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Area("geometry") AS "computed_area"');
  });
});

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const INTEGRATION_POLYGON_FC = {
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
  const require = createRequire(import.meta.url);
  const duckdb = await import('@duckdb/duckdb-wasm/blocking');
  const bundles = {
    mvp: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker: '',
    },
  } satisfies DuckDBBundles.DuckDBBundles;
  const db = await duckdb.createDuckDB(bundles, new duckdb.ConsoleLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  let spatialReady: Promise<void> | undefined;

  function wrapConnection(): DuckDbConnection {
    const conn = db.connect() as unknown as BlockingDuckDbConnectionLike;
    return {
      async insertArrowTable(table, opts) {
        conn.insertArrowFromIPCStream(tableToIPC(table, 'stream'), {
          ...opts,
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
    const dataset = await datasetFromFeatureCollection(INTEGRATION_POLYGON_FC);

    const result = await area(dataset, { outputLayer: 'area' }, duckDbRuntime);

    const records = result.layers[0]?.data?.getRecords?.();
    expect(result.layers[0]?.name).toBe('area');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(records?.[0]?.name).toBe('parcel-a');
    expect(records?.[0]?.duckdb_area).toBe(100);
  }, 60_000);

  it('adds geometry type, validity, and point coordinate attributes', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const pointDataset = await datasetFromFeatureCollection(POINT_FC, 'EPSG:4326');

    const withType = await geometryType(pointDataset, {}, duckDbRuntime);
    const withValidity = await isValid(pointDataset, {}, duckDbRuntime);
    const withX = await x(pointDataset, {}, duckDbRuntime);
    const withY = await y(pointDataset, {}, duckDbRuntime);

    expect(withType.layers[0]?.data?.getRecords?.()[0]?.duckdb_geometry_type).toBeTruthy();
    expect(withValidity.layers[0]?.data?.getRecords?.()[0]?.duckdb_is_valid).toBe(true);
    expect(withX.layers[0]?.data?.getRecords?.()[0]?.duckdb_x).toBe(3);
    expect(withY.layers[0]?.data?.getRecords?.()[0]?.duckdb_y).toBe(4);
  }, 60_000);

  it('adds coordinate attributes for WGS84 polygons using centroid coordinates', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const polygonDataset = await datasetFromFeatureCollection(INTEGRATION_POLYGON_FC, 'EPSG:4326');

    const withX = await centroidX(polygonDataset, {}, duckDbRuntime);
    const withY = await centroidY(polygonDataset, {}, duckDbRuntime);

    expect(withX.layers[0]?.data?.getRecords?.()[0]?.duckdb_centroid_x).toBe(5);
    expect(withY.layers[0]?.data?.getRecords?.()[0]?.duckdb_centroid_y).toBe(5);
  }, 60_000);
});

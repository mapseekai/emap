import { createRequire } from 'node:module';

import {
  Binary,
  Field,
  RecordBatch,
  Schema,
  Struct,
  Table,
  Utf8,
  makeData,
  tableFromArrays,
  vectorFromArray,
} from 'apache-arrow';
import type { DuckDBBundles } from '@duckdb/duckdb-wasm/blocking';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportGeoParquet } from '../../arrow/geoparquet-io';
import { datasetFromGeoJSON, injectParquetWasmForTests } from '../../arrow/test-utils';
import { DuckDbOperationError } from '../errors';
import { createDuckDbGeoParquetQuerySource, queryGeoParquetWithDuckDb } from './query';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';

interface FakeRuntimeOptions {
  closeError?: unknown;
  dropFileError?: unknown;
  dropViewError?: unknown;
  queryError?: unknown;
}

class FakeConnection implements DuckDbConnection {
  readonly queries: string[] = [];
  closed = false;

  constructor(
    private readonly schemaTable: Table,
    private readonly resultTable: Table,
    private readonly options: FakeRuntimeOptions = {},
  ) {}

  async insertArrowTable(): Promise<void> {
    throw new Error('queryGeoParquetWithDuckDb should not insert Arrow tables');
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);

    if (sql.startsWith('DROP VIEW IF EXISTS')) {
      if (this.options.dropViewError) throw this.options.dropViewError;
      return this.schemaTable;
    }

    if (sql.startsWith('CREATE VIEW')) return this.schemaTable;
    if (sql.startsWith('SELECT * FROM') && sql.endsWith('LIMIT 0')) return this.schemaTable;
    if (this.options.queryError) throw this.options.queryError;
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.options.closeError) throw this.options.closeError;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly conn: FakeConnection;
  readonly droppedFiles: string[] = [];
  readonly registeredFiles: Array<{ buffer: Uint8Array; name: string }> = [];
  ensureSpatialCalls = 0;

  constructor(
    schemaTable: Table = schemaOnlyTable(),
    resultTable: Table = pointResultTable(),
    private readonly options: FakeRuntimeOptions = {},
  ) {
    this.conn = new FakeConnection(schemaTable, resultTable, options);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.conn;
  }

  async ensureSpatial(): Promise<void> {
    this.ensureSpatialCalls += 1;
  }

  async registerFileBuffer(name: string, buffer: Uint8Array): Promise<void> {
    this.registeredFiles.push({ name, buffer });
  }

  async dropFile(name: string): Promise<void> {
    this.droppedFiles.push(name);
    if (this.options.dropFileError) throw this.options.dropFileError;
  }
}

function schemaOnlyTable(): Table {
  return tableFromArrays({
    geometry: [] as Uint8Array[],
    name: [] as string[],
    population: [] as number[],
  });
}

function pointWkb(x: number, y: number): Uint8Array {
  const buffer = new ArrayBuffer(21);
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint32(1, 1, true);
  view.setFloat64(5, x, true);
  view.setFloat64(13, y, true);
  return new Uint8Array(buffer);
}

function pointResultTable(): Table {
  return binaryGeometryResultTable(pointWkb(1, 2));
}

function invalidWkbResultTable(): Table {
  return binaryGeometryResultTable(new Uint8Array([2]));
}

function binaryGeometryResultTable(geometry: Uint8Array): Table {
  const fields = [new Field('geometry', new Binary(), true), new Field('name', new Utf8(), true)];
  const geometryData = makeData({
    type: new Binary(),
    length: 1,
    data: geometry,
    valueOffsets: new Int32Array([0, geometry.length]),
    nullCount: 0,
  });
  const nameData = vectorFromArray(['alpha'], new Utf8()).data[0]!;
  const schema = new Schema(fields);
  const structData = makeData({
    type: new Struct(fields),
    children: [geometryData, nameData],
    length: 1,
    nullCount: 0,
  });
  return new Table(schema, [new RecordBatch(schema, structData)]);
}

async function expectDuckDbError(
  promise: Promise<unknown>,
  kind: DuckDbOperationError['kind'],
): Promise<DuckDbOperationError> {
  await expect(promise).rejects.toBeInstanceOf(DuckDbOperationError);
  try {
    await promise;
  } catch (err) {
    expect((err as DuckDbOperationError).kind).toBe(kind);
    return err as DuckDbOperationError;
  }
  throw new Error('Expected DuckDbOperationError');
}

describe('queryGeoParquetWithDuckDb', () => {
  it('registers bytes, queries through a read_parquet view, converts, and cleans up', async () => {
    const runtime = new FakeRuntime();
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;

    const result = await queryGeoParquetWithDuckDb(
      buffer,
      {
        layerName: 'places',
        sql: 'SELECT name, geometry FROM input WHERE population > 5 ORDER BY name LIMIT 1',
      },
      runtime,
    );

    const fileName = runtime.registeredFiles[0]!.name;
    const viewName = fileName.replace('.parquet', '').replace('geoparquet_', 'geoparquet_input_');

    expect(runtime.ensureSpatialCalls).toBe(0);
    expect(runtime.registeredFiles).toHaveLength(1);
    expect(Array.from(runtime.registeredFiles[0]!.buffer)).toEqual([1, 2, 3, 4]);
    expect(fileName).toMatch(/^emap_duckdb_geoparquet_\d+\.parquet$/);
    expect(runtime.conn.queries[0]).toBe(
      `CREATE VIEW "${viewName}" AS SELECT * FROM read_parquet('${fileName}')`,
    );
    expect(runtime.conn.queries[1]).toBe(`SELECT * FROM "${viewName}" LIMIT 0`);
    expect(runtime.conn.queries[2]).toBe(
      `SELECT "input"."name" AS "name", "input"."geometry" AS "geometry" FROM "${viewName}" AS "input" WHERE population > 5 ORDER BY name LIMIT 1`,
    );
    expect(runtime.conn.queries.at(-1)).toBe(`DROP VIEW IF EXISTS "${viewName}"`);
    expect(runtime.conn.closed).toBe(true);
    expect(runtime.droppedFiles).toEqual([fileName]);
    expect(result.layers[0]?.name).toBe('places');
    expect(result.layers[0]?.data?.getRecords?.()).toEqual([{ name: 'alpha' }]);
    expect(result.layers[0]?.shapes).toHaveLength(1);
  });

  it('transfers GeoParquet bytes once and reuses the registered query source', async () => {
    class DetachingRuntime extends FakeRuntime {
      override async registerFileBuffer(name: string, buffer: Uint8Array): Promise<void> {
        this.registeredFiles.push({ name, buffer: new Uint8Array(buffer) });
        structuredClone(buffer.buffer, { transfer: [buffer.buffer] });
      }
    }

    const runtime = new DetachingRuntime();
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const source = await createDuckDbGeoParquetQuerySource(bytes, runtime);
    const first = await source.query({ sql: 'SELECT name, geometry FROM input' });
    const second = await source.query({ sql: 'SELECT geometry, name FROM input' });
    await source.close();

    expect(bytes.byteLength).toBe(0);
    expect(first.layers[0]?.shapes).toHaveLength(1);
    expect(second.layers[0]?.shapes).toHaveLength(1);
    expect(runtime.registeredFiles).toHaveLength(1);
    expect(Array.from(runtime.registeredFiles[0]!.buffer)).toEqual([1, 2, 3, 4]);
    expect(runtime.conn.queries.filter((query) => query.startsWith('CREATE VIEW'))).toHaveLength(1);
    expect(runtime.conn.queries.filter((query) => query.startsWith('DROP VIEW'))).toHaveLength(1);
    expect(runtime.conn.closed).toBe(true);
    expect(runtime.droppedFiles).toEqual([runtime.registeredFiles[0]!.name]);
  });

  it('maps a null runtime to runtime-unavailable', async () => {
    await expectDuckDbError(
      queryGeoParquetWithDuckDb(new Uint8Array([1]), { sql: 'SELECT name FROM input' }, null),
      'runtime-unavailable',
    );
  });

  it('maps missing file registration support to runtime-unavailable', async () => {
    const runtime = {
      async connect() {
        throw new Error('connect should not be called');
      },
      async ensureSpatial() {},
    } satisfies DuckDbRuntime;

    await expectDuckDbError(
      queryGeoParquetWithDuckDb(new Uint8Array([1]), { sql: 'SELECT name FROM input' }, runtime),
      'runtime-unavailable',
    );
  });

  it('supports runtimes without file cleanup support', async () => {
    const conn = new FakeConnection(schemaOnlyTable(), pointResultTable());
    const registeredFiles: Array<{ buffer: Uint8Array; name: string }> = [];
    const runtime = {
      async connect() {
        return conn;
      },
      async ensureSpatial() {},
      async registerFileBuffer(name: string, buffer: Uint8Array) {
        registeredFiles.push({ name, buffer });
      },
    } satisfies DuckDbRuntime;

    const result = await queryGeoParquetWithDuckDb(
      new Uint8Array([1]),
      { sql: 'SELECT name, geometry FROM input' },
      runtime,
    );

    expect(registeredFiles).toHaveLength(1);
    expect(conn.closed).toBe(true);
    expect(result.layers[0]?.shapes).toHaveLength(1);
  });

  it('blocks direct read_parquet SQL before user-query execution', async () => {
    const runtime = new FakeRuntime();
    const sql = "SELECT name FROM read_parquet('x.parquet')";

    await expectDuckDbError(
      queryGeoParquetWithDuckDb(new Uint8Array([1]), { sql }, runtime),
      'validation',
    );

    expect(runtime.conn.queries).not.toContain(sql);
    expect(runtime.conn.queries.some((query) => query.includes('read_parquet('))).toBe(true);
    expect(runtime.conn.closed).toBe(true);
    expect(runtime.droppedFiles).toEqual([runtime.registeredFiles[0]!.name]);
  });

  it('maps user query failures to query-failed and still cleans up', async () => {
    const runtime = new FakeRuntime(schemaOnlyTable(), pointResultTable(), {
      queryError: new Error('query failed'),
    });

    const err = await expectDuckDbError(
      queryGeoParquetWithDuckDb(
        new Uint8Array([1]),
        { sql: 'SELECT name, geometry FROM input' },
        runtime,
      ),
      'query-failed',
    );

    expect(err.message).toBe('DuckDB GeoParquet query failed');
    expect(runtime.conn.queries.at(-1)).toMatch(/^DROP VIEW IF EXISTS "/);
    expect(runtime.conn.closed).toBe(true);
    expect(runtime.droppedFiles).toEqual([runtime.registeredFiles[0]!.name]);
  });

  it('maps missing result geometry to conversion-failed and still cleans up', async () => {
    const runtime = new FakeRuntime(schemaOnlyTable(), tableFromArrays({ name: ['alpha'] }));

    const err = await expectDuckDbError(
      queryGeoParquetWithDuckDb(
        new Uint8Array([1]),
        { sql: 'SELECT name, geometry FROM input' },
        runtime,
      ),
      'conversion-failed',
    );

    expect(err.message).toBe('DuckDB GeoParquet query result could not be converted to a dataset');
    expect(runtime.conn.queries.at(-1)).toMatch(/^DROP VIEW IF EXISTS "/);
    expect(runtime.conn.closed).toBe(true);
    expect(runtime.droppedFiles).toEqual([runtime.registeredFiles[0]!.name]);
  });

  it('maps invalid WKB geometry to conversion-failed and still cleans up', async () => {
    const runtime = new FakeRuntime(schemaOnlyTable(), invalidWkbResultTable());

    const err = await expectDuckDbError(
      queryGeoParquetWithDuckDb(
        new Uint8Array([1]),
        { sql: 'SELECT name, geometry FROM input' },
        runtime,
      ),
      'conversion-failed',
    );

    expect(err.message).toBe('DuckDB GeoParquet query result could not be converted to a dataset');
    expect(runtime.conn.queries.at(-1)).toMatch(/^DROP VIEW IF EXISTS "/);
    expect(runtime.conn.closed).toBe(true);
    expect(runtime.droppedFiles).toEqual([runtime.registeredFiles[0]!.name]);
  });

  it('preserves a primary query error when cleanup also fails', async () => {
    const runtime = new FakeRuntime(schemaOnlyTable(), pointResultTable(), {
      dropViewError: new Error('drop view failed'),
      queryError: new Error('query failed'),
    });

    const err = await expectDuckDbError(
      queryGeoParquetWithDuckDb(
        new Uint8Array([1]),
        { sql: 'SELECT name, geometry FROM input' },
        runtime,
      ),
      'query-failed',
    );

    expect(err.message).toBe('DuckDB GeoParquet query failed');
    expect(runtime.conn.closed).toBe(true);
    expect(runtime.droppedFiles).toEqual([runtime.registeredFiles[0]!.name]);
  });

  it('reports cleanup failure after an otherwise successful query', async () => {
    const runtime = new FakeRuntime(schemaOnlyTable(), pointResultTable(), {
      dropViewError: new Error('drop view failed'),
    });

    const err = await expectDuckDbError(
      queryGeoParquetWithDuckDb(
        new Uint8Array([1]),
        { sql: 'SELECT name, geometry FROM input', noTopology: true },
        runtime,
      ),
      'query-failed',
    );

    expect(err.message).toMatch(/cleanup failed/i);
    expect(runtime.conn.closed).toBe(true);
    expect(runtime.droppedFiles).toEqual([runtime.registeredFiles[0]!.name]);
  });
});

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

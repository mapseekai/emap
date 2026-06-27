import type { Table } from 'apache-arrow';
import { tableFromArrays } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import { queryDatasetWithDuckDb } from './duckdb-query-op';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';

const POINTS_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'alpha', population: 10, active: true },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    {
      type: 'Feature',
      properties: { name: 'beta', population: 20, active: false },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
    {
      type: 'Feature',
      properties: { name: 'gamma', population: 30, active: true },
      geometry: { type: 'Point', coordinates: [2, 2] },
    },
  ],
};

type FakeRuntimeOptions = {
  closeError?: unknown;
  dropError?: unknown;
  queryError?: unknown;
};

class FakeConnection implements DuckDbConnection {
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];
  closed = false;

  constructor(
    private readonly resultTable: Table,
    private readonly options: FakeRuntimeOptions = {},
  ) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    if (sql.startsWith('DROP TABLE IF EXISTS') && this.options.dropError) {
      throw this.options.dropError;
    }
    if (!sql.startsWith('DROP TABLE IF EXISTS') && this.options.queryError) {
      throw this.options.queryError;
    }
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.options.closeError) throw this.options.closeError;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly connection: FakeConnection;
  ensureSpatialCalls = 0;

  constructor(resultTable: Table, options: FakeRuntimeOptions = {}) {
    this.connection = new FakeConnection(resultTable, options);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {
    this.ensureSpatialCalls += 1;
  }
}

async function pointDataset(): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POINTS_FC);
  dataset.layers[0]!.name = 'places';
  dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
  return dataset;
}

function resultTable(rowIds: unknown[], names: string[] = []): Table {
  return tableFromArrays({
    __emap_rowid: rowIds,
    name: names.length > 0 ? names : rowIds.map((rowId) => `row-${String(rowId)}`),
  });
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

describe('queryDatasetWithDuckDb', () => {
  it('runs a restricted SELECT and rebuilds geometry from source row ids', async () => {
    const dataset = await pointDataset();
    const runtime = new FakeRuntime(resultTable([2, 0], ['gamma', 'alpha']));

    const result = await queryDatasetWithDuckDb(
      dataset,
      {
        outputLayer: 'top_places',
        sql: 'SELECT name FROM input ORDER BY population DESC LIMIT 2',
      },
      runtime,
    );

    const inputTableName = runtime.connection.inserted[0]!.opts.name;
    expect(runtime.ensureSpatialCalls).toBe(0);
    expect(runtime.connection.inserted).toHaveLength(1);
    expect(inputTableName).toMatch(/^emap_duckdb_query_input_\d+$/);
    expect(runtime.connection.queries[0]).toContain(`FROM "${inputTableName}" AS "input"`);
    expect(runtime.connection.queries[0]).toContain('"input"."__emap_rowid" AS "__emap_rowid"');
    expect(runtime.connection.queries.at(-1)).toBe(`DROP TABLE IF EXISTS "${inputTableName}"`);
    expect(runtime.connection.closed).toBe(true);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.name).toBe('top_places');
    expect(result.layers[0]?.geometry_type).toBe('point');
    expect(result.layers[0]?.id).toBe(dataset.layers[0]?.id);
    expect(result.layers[0]?.data?.getRecords?.()).toEqual([{ name: 'gamma' }, { name: 'alpha' }]);
    expect(result.layers[0]?.shapes).toEqual([
      dataset.layers[0]?.shapes?.[2],
      dataset.layers[0]?.shapes?.[0],
    ]);
    expect(result.layers[0]?.shapes?.[0]).not.toBe(dataset.layers[0]?.shapes?.[2]);
    expect(result.info?.crs_string).toBe('EPSG:4326');
  });

  it('maps a null runtime to runtime-unavailable', async () => {
    const dataset = await pointDataset();

    await expectDuckDbError(
      queryDatasetWithDuckDb(dataset, { sql: 'SELECT name FROM input' }, null),
      'runtime-unavailable',
    );
  });

  it('maps rejected SQL to validation and does not issue DuckDB queries', async () => {
    const dataset = await pointDataset();
    const runtime = new FakeRuntime(resultTable([0]));

    await expectDuckDbError(
      queryDatasetWithDuckDb(dataset, { sql: 'SELECT geometry FROM input' }, runtime),
      'validation',
    );

    expect(runtime.ensureSpatialCalls).toBe(0);
    expect(runtime.connection.inserted).toHaveLength(0);
    expect(runtime.connection.queries).toEqual([]);
    expect(runtime.connection.closed).toBe(false);
  });

  it('maps DuckDB query failures to query-failed and still closes', async () => {
    const dataset = await pointDataset();
    const runtime = new FakeRuntime(resultTable([0]), {
      queryError: new Error('boom'),
    });

    await expectDuckDbError(
      queryDatasetWithDuckDb(dataset, { sql: 'SELECT name FROM input' }, runtime),
      'query-failed',
    );

    expect(runtime.connection.queries.at(-1)).toMatch(/^DROP TABLE IF EXISTS "/);
    expect(runtime.connection.closed).toBe(true);
  });

  it('keeps the primary query-failed error when cleanup close fails', async () => {
    const dataset = await pointDataset();
    const runtime = new FakeRuntime(resultTable([0]), {
      closeError: new Error('close failed'),
      queryError: new Error('query failed'),
    });

    const err = await expectDuckDbError(
      queryDatasetWithDuckDb(dataset, { sql: 'SELECT name FROM input' }, runtime),
      'query-failed',
    );

    expect(err.message).toMatch(/query failed/i);
    expect(runtime.connection.closed).toBe(true);
  });

  it('maps cleanup DROP failures after a successful query to query-failed and still closes', async () => {
    const dataset = await pointDataset();
    const runtime = new FakeRuntime(resultTable([0], ['alpha']), {
      dropError: new Error('drop failed'),
    });

    const err = await expectDuckDbError(
      queryDatasetWithDuckDb(dataset, { sql: 'SELECT name FROM input' }, runtime),
      'query-failed',
    );

    expect(err.message).toMatch(/cleanup failed/i);
    expect(runtime.connection.queries.at(-1)).toMatch(/^DROP TABLE IF EXISTS "/);
    expect(runtime.connection.closed).toBe(true);
  });

  it('maps invalid result row ids to conversion-failed', async () => {
    const dataset = await pointDataset();
    const runtime = new FakeRuntime(resultTable([99]));

    await expectDuckDbError(
      queryDatasetWithDuckDb(dataset, { sql: 'SELECT name FROM input' }, runtime),
      'conversion-failed',
    );

    expect(runtime.connection.closed).toBe(true);
  });

  it('uses a collision-free internal row id column and excludes it from output records', async () => {
    const dataset = await pointDataset();
    dataset.layers[0]?.data?.getRecords?.().forEach((record, index) => {
      record.__emap_rowid = `source-${index}`;
    });
    const runtime = new FakeRuntime(
      tableFromArrays({
        __emap_rowid_1: [2, 0],
        name: ['gamma', 'alpha'],
      }),
    );

    const result = await queryDatasetWithDuckDb(
      dataset,
      { sql: 'SELECT name FROM input ORDER BY population DESC LIMIT 2' },
      runtime,
    );

    const fieldNames = runtime.connection.inserted[0]!.table.schema.fields.map(
      (field) => field.name,
    );
    expect(fieldNames).toContain('__emap_rowid');
    expect(fieldNames).toContain('__emap_rowid_1');
    expect(runtime.connection.queries[0]).toContain('"input"."__emap_rowid_1" AS "__emap_rowid_1"');
    expect(result.layers[0]?.data?.getRecords?.()).toEqual([{ name: 'gamma' }, { name: 'alpha' }]);
  });
});

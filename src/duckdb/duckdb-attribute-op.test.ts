import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import { processAttributeWithDuckDb, resolveAttributeOutputColumn } from './duckdb-attribute-op';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';

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

async function resultDatasetWithArea(): Promise<MapshaperDataset> {
  const dataset = await polygonDataset();
  const records = dataset.layers[0]?.data?.getRecords?.();
  if (records?.[0]) {
    records[0].duckdb_area = 100;
  }
  return dataset;
}

class FakeConnection implements DuckDbConnection {
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];
  closed = false;

  constructor(private readonly resultTable: Table) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly connection: FakeConnection;
  readonly events: string[] = [];

  constructor(resultTable: Table) {
    this.connection = new FakeConnection(resultTable);
  }

  async connect(): Promise<DuckDbConnection> {
    this.events.push('connect');
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {
    this.events.push('ensureSpatial');
  }
}

describe('processAttributeWithDuckDb', () => {
  it('preserves geometry and appends scalar attribute columns', async () => {
    const dataset = await polygonDataset();
    const resultTable = toArrowTable(await resultDatasetWithArea(), { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    const result = await processAttributeWithDuckDb(
      dataset,
      { outputLayer: 'with-area', outputColumn: 'duckdb_area' },
      { id: 'area', duckDbFunction: 'ST_Area' },
      runtime,
    );

    const inputTableName = runtime.connection.inserted[0]!.opts.name;
    expect(runtime.events).toEqual(['ensureSpatial', 'connect']);
    expect(runtime.connection.queries).toEqual([
      [
        'SELECT',
        '  *,',
        '  ST_Area("geometry") AS "duckdb_area"',
        `FROM "${inputTableName}"`,
        'WHERE "geometry" IS NOT NULL',
      ].join('\n'),
      `DROP TABLE IF EXISTS ${inputTableName}`,
    ]);
    expect(runtime.connection.closed).toBe(true);
    expect(result.layers[0]?.name).toBe('with-area');
    expect(result.info?.crs_string).toBe('EPSG:3857');
    expect(result.layers[0]?.data?.getRecords?.()[0]?.duckdb_area).toBe(100);
  });

  it('resolves output column collisions before building SQL', async () => {
    const dataset = await polygonDataset();
    const records = dataset.layers[0]?.data?.getRecords?.();
    if (records?.[0]) {
      records[0].duckdb_area = 1;
      records[0].duckdb_area_1 = 2;
    }
    const resultTable = toArrowTable(await resultDatasetWithArea(), { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    await processAttributeWithDuckDb(
      dataset,
      { outputColumn: 'duckdb_area' },
      { id: 'area', duckDbFunction: 'ST_Area' },
      runtime,
    );

    expect(runtime.connection.queries[0]).toContain('ST_Area("geometry") AS "duckdb_area_2"');
  });

  it('rejects empty output columns', async () => {
    const dataset = await polygonDataset();
    const runtime = new FakeRuntime(toArrowTable(dataset, { encoding: 'wkb' }));

    await expect(
      processAttributeWithDuckDb(
        dataset,
        { outputColumn: '   ' },
        { id: 'area', duckDbFunction: 'ST_Area' },
        runtime,
      ),
    ).rejects.toMatchObject({
      kind: 'validation',
      field: 'outputColumn',
    });
  });

  it('wraps spatial extension failures', async () => {
    const dataset = await polygonDataset();
    const runtime = {
      async ensureSpatial() {
        throw new Error('install failed');
      },
      async connect() {
        throw new Error('should not connect');
      },
    } satisfies DuckDbRuntime;

    await expect(
      processAttributeWithDuckDb(
        dataset,
        { outputColumn: 'duckdb_area' },
        { id: 'area', duckDbFunction: 'ST_Area' },
        runtime,
      ),
    ).rejects.toMatchObject({
      kind: 'spatial-extension-unavailable',
    });
  });

  it('rejects missing DuckDB runtimes before opening a connection', async () => {
    const dataset = await polygonDataset();

    await expect(
      processAttributeWithDuckDb(
        dataset,
        { outputColumn: 'duckdb_area' },
        { id: 'area', duckDbFunction: 'ST_Area' },
        null,
      ),
    ).rejects.toBeInstanceOf(DuckDbOperationError);
  });
});

describe('resolveAttributeOutputColumn', () => {
  it('returns the requested name when it is unused', async () => {
    const dataset = await polygonDataset();
    const table = toArrowTable(dataset, { encoding: 'wkb' });

    expect(resolveAttributeOutputColumn(table, 'duckdb_area')).toBe('duckdb_area');
  });

  it('suffixes requested names until they are unique', async () => {
    const dataset = await polygonDataset();
    const records = dataset.layers[0]?.data?.getRecords?.();
    if (records?.[0]) {
      records[0].duckdb_area = 1;
      records[0].duckdb_area_1 = 2;
    }
    const table = toArrowTable(dataset, { encoding: 'wkb' });

    expect(resolveAttributeOutputColumn(table, 'duckdb_area')).toBe('duckdb_area_2');
  });
});

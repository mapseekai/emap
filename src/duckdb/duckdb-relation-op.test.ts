import type Table from 'apache-arrow';
import { tableFromArrays } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import { parseGeoMetadata } from '../arrow/geoparquet-metadata';
import type MapshaperDataset from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import {
  processRelationWithDuckDb,
  resolveRelationOutputColumn,
  type DuckDbRelationOperationSpec,
} from './duckdb-relation-op';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';

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

const WEB_MERCATOR_WKT = 'PROJCS["Web Mercator",AUTHORITY["EPSG","3857"]]';

const INTERSECTS_SPEC = {
  id: 'intersects',
  mode: 'filter',
  duckDbFunction: 'ST_Intersects',
} as const satisfies DuckDbRelationOperationSpec;

const INTERSECTS_ATTRIBUTE_SPEC = {
  id: 'intersects',
  mode: 'attribute',
  duckDbFunction: 'ST_Intersects',
} as const satisfies DuckDbRelationOperationSpec;

async function inputDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(INPUT_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

async function maskDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(MASK_FC);
}

async function attributeResultDataset(): Promise<MapshaperDataset> {
  const dataset = await inputDataset();
  const records = dataset.layers[0]?.data?.getRecords?.();
  if (records?.[0]) {
    records[0].duckdb_intersects = true;
  }
  return dataset;
}

async function twoLayerDataset(): Promise<MapshaperDataset> {
  const first = await inputDataset();
  const second = await inputDataset();
  second.layers[0]!.name = 'second';
  const secondRecords = second.layers[0]?.data?.getRecords?.();
  if (secondRecords?.[0]) {
    secondRecords[0].selected_layer = 'second';
  }
  return {
    ...first,
    layers: [first.layers[0]!, second.layers[0]!],
  };
}

type FakeRuntimeOptions = {
  queryError?: unknown;
  insertError?: unknown;
  closeError?: unknown;
};

class FakeConnection implements DuckDbConnection {
  readonly events: string[];
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];

  constructor(
    private readonly resultTable: Table,
    events: string[],
    private readonly options: FakeRuntimeOptions = {},
  ) {
    this.events = events;
  }

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
    this.events.push(`insert:${opts.name}`);
    if (this.options.insertError && this.inserted.length === 2) throw this.options.insertError;
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    if (sql.startsWith('DROP TABLE IF EXISTS')) {
      this.events.push(`drop:${sql.replace('DROP TABLE IF EXISTS ', '').replace(/^"|"$/g, '')}`);
      return this.resultTable;
    }
    this.events.push('query');
    if (this.options.queryError) throw this.options.queryError;
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.events.push('close');
    if (this.options.closeError) throw this.options.closeError;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly events: string[] = [];
  readonly connection: FakeConnection;

  constructor(
    resultTable: Table,
    private readonly options: FakeRuntimeOptions = {},
  ) {
    this.connection = new FakeConnection(resultTable, this.events, options);
  }

  async ensureSpatial(): Promise<void> {
    this.events.push('ensureSpatial');
  }

  async connect(): Promise<DuckDbConnection> {
    this.events.push('connect');
    return this.connection;
  }
}

describe('processRelationWithDuckDb', () => {
  it('runs filter pipelines in lifecycle order and cleans both tables', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    await processRelationWithDuckDb(input, mask, {}, INTERSECTS_SPEC, runtime);

    const inputTableName = runtime.connection.inserted[0]!.opts.name;
    const maskTableName = runtime.connection.inserted[1]!.opts.name;
    const maskCrs = parseGeoMetadata(runtime.connection.inserted[1]!.table.schema.metadata)?.columns
      .geometry.crs as { id?: { authority?: string; code?: number } };
    expect(maskCrs.id).toEqual({ authority: 'EPSG', code: 3857 });
    expect(runtime.events).toEqual([
      'ensureSpatial',
      'connect',
      `insert:${inputTableName}`,
      `insert:${maskTableName}`,
      'query',
      `drop:${inputTableName}`,
      `drop:${maskTableName}`,
      'close',
    ]);
  });

  it('uses requested input and mask layers and geometry column names', async () => {
    const input = await twoLayerDataset();
    const mask = await twoLayerDataset();
    const resultTable = toArrowTable(input, {
      layer: 'second',
      encoding: 'wkb',
      geometryColumn: 'input_geom',
    });
    const runtime = new FakeRuntime(resultTable);

    await processRelationWithDuckDb(
      input,
      mask,
      {
        inputLayer: 'second',
        maskLayer: 1,
        inputGeometryColumn: 'input_geom',
        maskGeometryColumn: 'mask_geom',
      },
      INTERSECTS_SPEC,
      runtime,
    );

    expect(
      runtime.connection.inserted[0]!.table.schema.fields.map((field) => field.name),
    ).toContain('selected_layer');
    expect(
      runtime.connection.inserted[1]!.table.schema.fields.map((field) => field.name),
    ).toContain('selected_layer');
    expect(runtime.connection.queries[0]).toContain('i."input_geom"');
    expect(runtime.connection.queries[0]).toContain('m."mask_geom"');
  });

  it('preserves input geometry and records for filter output', async () => {
    const input = await inputDataset();
    input.info = { wkt1: WEB_MERCATOR_WKT };
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    resultTable.schema.metadata.clear();
    resultTable.schema.fields.at(-1)!.metadata.clear();
    const runtime = new FakeRuntime(resultTable);

    const result = await processRelationWithDuckDb(
      input,
      mask,
      { outputLayer: 'filtered' },
      INTERSECTS_SPEC,
      runtime,
    );

    expect(result.info?.crs_string).toBe('EPSG:3857');
    expect(result.layers[0]?.name).toBe('filtered');
    expect(result.layers[0]?.data?.getRecords?.()).toEqual([{ name: 'parcel-a', zone: 'A' }]);
    expect(result.layers[0]?.shapes?.length).toBe(1);
  });

  it('appends boolean columns for attribute output', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = toArrowTable(await attributeResultDataset(), {
      encoding: 'wkb',
    });
    const runtime = new FakeRuntime(resultTable);

    const result = await processRelationWithDuckDb(
      input,
      mask,
      { outputColumn: 'duckdb_intersects' },
      INTERSECTS_ATTRIBUTE_SPEC,
      runtime,
    );

    expect(result.layers[0]?.data?.getRecords?.()).toEqual([
      { name: 'parcel-a', zone: 'A', duckdb_intersects: true },
    ]);
    expect(runtime.connection.queries[0]).toContain('AS "duckdb_intersects"');
  });

  it('suffixes colliding output columns before building SQL', async () => {
    const input = await inputDataset();
    const records = input.layers[0]?.data?.getRecords?.();
    if (records?.[0]) {
      records[0].duckdb_intersects = false;
      records[0].duckdb_intersects_1 = false;
    }
    const mask = await maskDataset();
    const resultTable = toArrowTable(await attributeResultDataset(), {
      encoding: 'wkb',
    });
    const runtime = new FakeRuntime(resultTable);

    await processRelationWithDuckDb(
      input,
      mask,
      { outputColumn: 'duckdb_intersects' },
      INTERSECTS_ATTRIBUTE_SPEC,
      runtime,
    );

    expect(runtime.connection.queries[0]).toContain('AS "duckdb_intersects_2"');
  });

  it('rejects empty output columns', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    await expect(
      processRelationWithDuckDb(
        input,
        mask,
        { outputColumn: '   ' },
        INTERSECTS_ATTRIBUTE_SPEC,
        runtime,
      ),
    ).rejects.toMatchObject({ kind: 'validation', field: 'outputColumn' });
  });

  it('wraps spatial extension failures', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const runtime = {
      async ensureSpatial() {
        throw new Error('install failed');
      },
      async connect() {
        throw new Error('should not connect');
      },
    } satisfies DuckDbRuntime;

    await expect(
      processRelationWithDuckDb(input, mask, {}, INTERSECTS_SPEC, runtime),
    ).rejects.toMatchObject({
      kind: 'spatial-extension-unavailable',
    });
  });

  it('wraps input conversion failures before starting DuckDB', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    await expect(
      processRelationWithDuckDb(
        input,
        mask,
        { inputLayer: 'missing-layer' },
        INTERSECTS_SPEC,
        runtime,
      ),
    ).rejects.toMatchObject({
      kind: 'conversion-failed',
    });
    expect(runtime.events).toEqual([]);
  });

  it('wraps query failures', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable, {
      queryError: new Error('query failed'),
      closeError: new Error('close failed'),
    });

    await expect(
      processRelationWithDuckDb(input, mask, {}, INTERSECTS_SPEC, runtime),
    ).rejects.toMatchObject({
      kind: 'query-failed',
    });

    const inputTableName = runtime.connection.inserted[0]!.opts.name;
    const maskTableName = runtime.connection.inserted[1]!.opts.name;
    expect(runtime.events).toEqual([
      'ensureSpatial',
      'connect',
      `insert:${inputTableName}`,
      `insert:${maskTableName}`,
      'query',
      `drop:${inputTableName}`,
      `drop:${maskTableName}`,
      'close',
    ]);
  });

  it('wraps conversion failures', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = tableFromArrays({ name: ['no geometry'] });
    const runtime = new FakeRuntime(resultTable);

    await expect(
      processRelationWithDuckDb(input, mask, {}, INTERSECTS_SPEC, runtime),
    ).rejects.toMatchObject({
      kind: 'conversion-failed',
    });

    const inputTableName = runtime.connection.inserted[0]!.opts.name;
    const maskTableName = runtime.connection.inserted[1]!.opts.name;
    expect(runtime.events).toEqual([
      'ensureSpatial',
      'connect',
      `insert:${inputTableName}`,
      `insert:${maskTableName}`,
      'query',
      `drop:${inputTableName}`,
      `drop:${maskTableName}`,
      'close',
    ]);
  });

  it('cleans up both relation tables when mask insertion fails', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable, {
      insertError: new Error('mask insert failed'),
    });

    await expect(
      processRelationWithDuckDb(input, mask, {}, INTERSECTS_SPEC, runtime),
    ).rejects.toMatchObject({
      kind: 'query-failed',
    });

    const inputTableName = runtime.connection.inserted[0]!.opts.name;
    const maskTableName = runtime.connection.inserted[1]!.opts.name;
    expect(runtime.events).toEqual([
      'ensureSpatial',
      'connect',
      `insert:${inputTableName}`,
      `insert:${maskTableName}`,
      `drop:${inputTableName}`,
      `drop:${maskTableName}`,
      'close',
    ]);
  });

  it('rejects missing DuckDB runtimes before opening a connection', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();

    await expect(
      processRelationWithDuckDb(input, mask, {}, INTERSECTS_SPEC, null),
    ).rejects.toMatchObject({
      kind: 'runtime-unavailable',
    });
  });
});

describe('resolveRelationOutputColumn', () => {
  it('returns requested names when unused', async () => {
    const table = toArrowTable(await inputDataset(), { encoding: 'wkb' });

    expect(resolveRelationOutputColumn(table, 'duckdb_intersects')).toBe('duckdb_intersects');
  });

  it('uses the first suffix when only requested name exists', async () => {
    const dataset = await inputDataset();
    const records = dataset.layers[0]?.data?.getRecords?.();
    if (records?.[0]) {
      records[0].duckdb_intersects = false;
    }
    const table = toArrowTable(dataset, { encoding: 'wkb' });

    expect(resolveRelationOutputColumn(table, 'duckdb_intersects')).toBe('duckdb_intersects_1');
  });

  it('suffixes requested names until unique', async () => {
    const dataset = await inputDataset();
    const records = dataset.layers[0]?.data?.getRecords?.();
    if (records?.[0]) {
      records[0].duckdb_intersects = false;
      records[0].duckdb_intersects_1 = false;
    }
    const table = toArrowTable(dataset, { encoding: 'wkb' });

    expect(resolveRelationOutputColumn(table, 'duckdb_intersects')).toBe('duckdb_intersects_2');
  });
});

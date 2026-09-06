import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { ARROW_EXTENSION_NAME } from '../../arrow/geoparquet-metadata';
import { datasetFromGeoJSON } from '../../arrow/test-utils';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import { buildUnaryGeometrySql } from '../core/sql/geometry';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';
import { buffer, normalizeBufferOptions } from './buffer';

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

async function polygonDataset(crs?: string): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POLYGON_FC);
  if (crs) dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

class FakeConnection implements DuckDbConnection {
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];
  closed = false;

  constructor(
    private readonly resultTable: Table,
    private readonly events: string[],
    private readonly queryError?: unknown,
    private readonly insertError?: unknown,
  ) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.events.push(`insert:${opts.name}`);
    if (this.insertError) throw this.insertError;
    this.inserted.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.events.push('query');
    this.queries.push(sql);
    if (this.queryError) throw this.queryError;
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.events.push('close');
    this.closed = true;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly events: string[] = [];
  readonly connection: FakeConnection;

  constructor(resultTable: Table, queryError?: unknown, insertError?: unknown) {
    this.connection = new FakeConnection(resultTable, this.events, queryError, insertError);
  }

  async connect(): Promise<DuckDbConnection> {
    this.events.push('connect');
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {
    this.events.push('ensureSpatial');
  }
}

describe('DuckDB buffer operation validation', () => {
  it('rejects non-positive buffer distance', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    expect(() => normalizeBufferOptions(dataset, { distance: 0 })).toThrow(DuckDbOperationError);
    expect(() => normalizeBufferOptions(dataset, { distance: 0 })).toThrow(/greater than zero/);
  });

  it('rejects non-finite buffer distance', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    expect(() => normalizeBufferOptions(dataset, { distance: Number.NaN })).toThrow(
      DuckDbOperationError,
    );
  });

  it('rejects geographic CRS by default', async () => {
    const dataset = await polygonDataset('EPSG:4326');
    expect(() => normalizeBufferOptions(dataset, { distance: 10 })).toThrow(
      /reproject to a projected CRS/,
    );
  });

  it('rejects geographic CRS variants by default', async () => {
    const datasets = [
      await polygonDataset('EPSG:4269'),
      await polygonDataset('urn:ogc:def:crs:EPSG::4326'),
      await polygonDataset('OGC:CRS84'),
      await polygonDataset(),
      await polygonDataset(),
    ];
    datasets[3]!.info = {
      ...datasets[3]!.info,
      prj: 'GEOGCS["WGS 84",DATUM["WGS_1984"]]',
    };
    datasets[4]!.info = {
      ...datasets[4]!.info,
      crs: { is_latlong: true },
    };

    for (const dataset of datasets) {
      expect(() => normalizeBufferOptions(dataset, { distance: 10 })).toThrow(
        /reproject to a projected CRS/,
      );
    }
  });

  it('allows geographic CRS when explicitly requested', async () => {
    const dataset = await polygonDataset('OGC:CRS84');
    expect(
      normalizeBufferOptions(dataset, { distance: 10, failOnGeographicCrs: false }),
    ).toMatchObject({ distance: 10, failOnGeographicCrs: false });
  });

  it('normalizes optional layer, output layer, and geometry column settings', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    expect(
      normalizeBufferOptions(dataset, {
        layer: 'parcels',
        distance: 12.5,
        outputLayer: 'buffered',
        geometryColumn: 'geom',
      }),
    ).toEqual({
      layer: 'parcels',
      distance: 12.5,
      outputLayer: 'buffered',
      geometryColumn: 'geom',
      failOnGeographicCrs: true,
    });
  });
});

describe('buffer', () => {
  it('processes dataset buffers through an injected DuckDB runtime', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    dataset.layers[0]!.name = 'parcels';
    const resultTable = toArrowTable(dataset, { layer: 'parcels', encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    const result = await buffer(
      dataset,
      { layer: 'parcels', distance: 12.5, outputLayer: 'buffered' },
      runtime,
    );

    const inputTableName = runtime.connection.inserted[0]!.opts.name;
    expect(runtime.events).toEqual([
      'ensureSpatial',
      'connect',
      `insert:${inputTableName}`,
      'query',
      'query',
      'close',
    ]);
    expect(runtime.connection.closed).toBe(true);
    expect(runtime.connection.inserted).toHaveLength(1);
    expect(inputTableName).toMatch(/^emap_duckdb_geometry_input_\d+$/);

    const insertedTable = runtime.connection.inserted[0]!.table;
    const geometryField = insertedTable.schema.fields.find((field) => field.name === 'geometry');
    expect(geometryField?.metadata.get(ARROW_EXTENSION_NAME)).toBe('geoarrow.wkb');
    expect(runtime.connection.queries).toEqual([
      buildUnaryGeometrySql({
        tableName: inputTableName,
        geometryColumn: 'geometry',
        duckDbFunction: 'ST_Buffer',
        args: [12.5],
      }),
      `DROP TABLE IF EXISTS "${inputTableName}"`,
    ]);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.name).toBe('buffered');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(result.info?.crs_string).toBe('EPSG:3857');
  });

  it('uses a fresh input table for repeated calls with the same runtime', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    const resultTable = toArrowTable(dataset, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    await buffer(dataset, { distance: 10 }, runtime);
    await buffer(dataset, { distance: 20 }, runtime);

    const inputTableNames = runtime.connection.inserted.map(({ opts }) => opts.name);
    expect(inputTableNames).toHaveLength(2);
    expect(new Set(inputTableNames).size).toBe(2);
    expect(runtime.connection.queries).toEqual([
      buildUnaryGeometrySql({
        tableName: inputTableNames[0]!,
        geometryColumn: 'geometry',
        duckDbFunction: 'ST_Buffer',
        args: [10],
      }),
      `DROP TABLE IF EXISTS "${inputTableNames[0]}"`,
      buildUnaryGeometrySql({
        tableName: inputTableNames[1]!,
        geometryColumn: 'geometry',
        duckDbFunction: 'ST_Buffer',
        args: [20],
      }),
      `DROP TABLE IF EXISTS "${inputTableNames[1]}"`,
    ]);
  });

  it('rejects missing DuckDB runtimes before opening a connection', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    await expect(buffer(dataset, { distance: 10 }, null)).rejects.toMatchObject({
      kind: 'runtime-unavailable',
    });
  });

  it('wraps DuckDB query failures and closes the operation connection', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    const resultTable = toArrowTable(dataset, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable, new Error('query exploded'));
    await expect(buffer(dataset, { distance: 10 }, runtime)).rejects.toMatchObject({
      kind: 'query-failed',
    });
    expect(runtime.connection.closed).toBe(true);
  });

  it('wraps DuckDB table-insertion failures and closes the operation connection', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    const resultTable = toArrowTable(dataset, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable, undefined, new Error('insert exploded'));
    const error = await buffer(dataset, { distance: 10 }, runtime).catch((err) => err);
    expect(error).toBeInstanceOf(DuckDbOperationError);
    expect(error).toMatchObject({ kind: 'query-failed' });
    expect(runtime.connection.closed).toBe(true);
  });
});

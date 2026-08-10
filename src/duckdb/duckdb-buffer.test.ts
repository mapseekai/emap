import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../arrow/dataset-to-table';
import { ARROW_EXTENSION_NAME } from '../arrow/geoparquet-metadata';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import { bufferDatasetWithDuckDb, normalizeDuckDbBufferOptions } from './duckdb-buffer';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import {
  buildAttributeSql,
  buildBufferSql,
  buildRelationAttributeSql,
  buildRelationFilterSql,
  buildUnaryGeometrySql,
} from './duckdb-sql';

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

    expect(() => normalizeDuckDbBufferOptions(dataset, { distance: 0 })).toThrow(
      DuckDbOperationError,
    );
    expect(() => normalizeDuckDbBufferOptions(dataset, { distance: 0 })).toThrow(
      /greater than zero/,
    );
  });

  it('rejects non-finite buffer distance', async () => {
    const dataset = await polygonDataset('EPSG:3857');

    expect(() => normalizeDuckDbBufferOptions(dataset, { distance: Number.NaN })).toThrow(
      DuckDbOperationError,
    );
  });

  it('rejects geographic CRS by default', async () => {
    const dataset = await polygonDataset('EPSG:4326');

    expect(() => normalizeDuckDbBufferOptions(dataset, { distance: 10 })).toThrow(
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
      expect(() => normalizeDuckDbBufferOptions(dataset, { distance: 10 })).toThrow(
        /reproject to a projected CRS/,
      );
    }
  });

  it('allows geographic CRS when explicitly requested', async () => {
    const dataset = await polygonDataset('OGC:CRS84');

    expect(
      normalizeDuckDbBufferOptions(dataset, { distance: 10, failOnGeographicCrs: false }),
    ).toMatchObject({
      distance: 10,
      failOnGeographicCrs: false,
    });
  });

  it('normalizes optional layer, output layer, and geometry column settings', async () => {
    const dataset = await polygonDataset('EPSG:3857');

    expect(
      normalizeDuckDbBufferOptions(dataset, {
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

describe('DuckDB buffer SQL', () => {
  const ADDITIONAL_RELATION_CASES = [
    { id: 'overlaps', duckDbFunction: 'ST_Overlaps', outputColumn: 'duckdb_overlaps' },
    { id: 'equals', duckDbFunction: 'ST_Equals', outputColumn: 'duckdb_equals' },
    { id: 'crosses', duckDbFunction: 'ST_Crosses', outputColumn: 'duckdb_crosses' },
    { id: 'covers', duckDbFunction: 'ST_Covers', outputColumn: 'duckdb_covers' },
    { id: 'coveredBy', duckDbFunction: 'ST_CoveredBy', outputColumn: 'duckdb_covered_by' },
    {
      id: 'containsProperly',
      duckDbFunction: 'ST_ContainsProperly',
      outputColumn: 'duckdb_contains_properly',
    },
  ] as const;

  it('builds a unary geometry query with an explicit WKB bridge', () => {
    expect(
      buildUnaryGeometrySql({
        tableName: 'input',
        geometryColumn: 'geometry',
        duckDbFunction: 'ST_Centroid',
      }),
    ).toBe(
      [
        'SELECT',
        '  * EXCLUDE ("geometry"),',
        '  ST_Centroid("geometry") AS "geometry"',
        'FROM "input"',
        'WHERE "geometry" IS NOT NULL',
      ].join('\n'),
    );
  });

  it('builds a unary geometry query with numeric operation arguments', () => {
    expect(
      buildUnaryGeometrySql({
        tableName: 'input',
        geometryColumn: 'geometry',
        duckDbFunction: 'ST_SimplifyPreserveTopology',
        args: [2.5],
      }),
    ).toContain('ST_SimplifyPreserveTopology("geometry", 2.5)');
  });

  it('builds a buffer query with quoted table and geometry identifiers', () => {
    expect(
      buildBufferSql({
        tableName: 'input table',
        geometryColumn: 'geom"col',
        distance: 3,
      }),
    ).toBe(
      [
        'SELECT',
        '  * EXCLUDE ("geom""col"),',
        '  ST_Buffer("geom""col", 3) AS "geom""col"',
        'FROM "input table"',
        'WHERE "geom""col" IS NOT NULL',
      ].join('\n'),
    );
  });

  it('builds an attribute query that preserves geometry and appends a scalar column', () => {
    expect(
      buildAttributeSql({
        tableName: 'input',
        geometryColumn: 'geometry',
        duckDbFunction: 'ST_Area',
        outputColumn: 'duckdb_area',
      }),
    ).toBe(
      [
        'SELECT',
        '  *,',
        '  ST_Area("geometry") AS "duckdb_area"',
        'FROM "input"',
        'WHERE "geometry" IS NOT NULL',
      ].join('\n'),
    );
  });

  it('quotes attribute query identifiers', () => {
    expect(
      buildAttributeSql({
        tableName: 'input table',
        geometryColumn: 'geom"col',
        duckDbFunction: 'ST_GeometryType',
        outputColumn: 'type"field',
      }),
    ).toContain('ST_GeometryType("geom""col") AS "type""field"');
  });
  it('builds relation filter query for intersecting input and mask geometries', () => {
    expect(
      buildRelationFilterSql({
        inputTableName: 'input',
        maskTableName: 'mask',
        inputGeometryColumn: 'geometry',
        maskGeometryColumn: 'geometry',
        duckDbFunction: 'ST_Intersects',
      }),
    ).toBe(
      [
        'SELECT',
        ' i.*',
        'FROM "input" AS i',
        'WHERE i."geometry" IS NOT NULL',
        ' AND EXISTS (',
        '  SELECT 1',
        '  FROM "mask" AS m',
        '  WHERE m."geometry" IS NOT NULL',
        '   AND ST_Intersects(i."geometry", m."geometry")',
        ' )',
      ].join('\n'),
    );
  });

  it('quotes relation table names and geometry column identifiers', () => {
    expect(
      buildRelationFilterSql({
        inputTableName: 'input table',
        maskTableName: 'mask"table',
        inputGeometryColumn: 'input geom',
        maskGeometryColumn: 'mask"geom',
        duckDbFunction: 'ST_Intersects',
      }),
    ).toBe(
      [
        'SELECT',
        ' i.*',
        'FROM "input table" AS i',
        'WHERE i."input geom" IS NOT NULL',
        ' AND EXISTS (',
        '  SELECT 1',
        '  FROM "mask""table" AS m',
        '  WHERE m."mask""geom" IS NOT NULL',
        '   AND ST_Intersects(i."input geom", m."mask""geom")',
        ' )',
      ].join('\n'),
    );
  });

  it('builds relation attribute query with boolean predicate output', () => {
    expect(
      buildRelationAttributeSql({
        inputTableName: 'input',
        maskTableName: 'mask',
        inputGeometryColumn: 'geometry',
        maskGeometryColumn: 'geometry',
        duckDbFunction: 'ST_Intersects',
        outputColumn: 'duckdb_intersects',
      }),
    ).toBe(
      [
        'SELECT',
        ' i.*,',
        ' EXISTS (',
        '  SELECT 1',
        '  FROM "mask" AS m',
        '  WHERE m."geometry" IS NOT NULL',
        '   AND ST_Intersects(i."geometry", m."geometry")',
        ' ) AS "duckdb_intersects"',
        'FROM "input" AS i',
        'WHERE i."geometry" IS NOT NULL',
      ].join('\n'),
    );
  });

  it.each(
    ADDITIONAL_RELATION_CASES,
  )('builds additional filter and attribute SQL for $duckDbFunction', ({
    duckDbFunction,
    outputColumn,
  }) => {
    const base = {
      inputTableName: 'input',
      maskTableName: 'mask',
      inputGeometryColumn: 'geometry',
      maskGeometryColumn: 'geometry',
      duckDbFunction,
    };

    const filterSql = buildRelationFilterSql(base);
    const attributeSql = buildRelationAttributeSql({ ...base, outputColumn });
    const predicate = `${duckDbFunction}(i."geometry", m."geometry")`;

    expect(filterSql).toContain(' AND EXISTS (');
    expect(filterSql).toContain(predicate);
    expect(attributeSql).toContain(' EXISTS (');
    expect(attributeSql).toContain(predicate);
    expect(attributeSql).toContain(`AS "${outputColumn}"`);
  });

  it('builds relation attribute query with minimum distance output', () => {
    expect(
      buildRelationAttributeSql({
        inputTableName: 'input',
        maskTableName: 'mask',
        inputGeometryColumn: 'geometry',
        maskGeometryColumn: 'geometry',
        duckDbFunction: 'ST_Distance',
        outputColumn: 'duckdb_distance',
        output: 'distance',
      }),
    ).toBe(
      [
        'SELECT',
        ' i.*,',
        ' (',
        '  SELECT MIN(ST_Distance(i."geometry", m."geometry"))',
        '  FROM "mask" AS m',
        '  WHERE m."geometry" IS NOT NULL',
        ' ) AS "duckdb_distance"',
        'FROM "input" AS i',
        'WHERE i."geometry" IS NOT NULL',
      ].join('\n'),
    );
  });

  it('builds distanceWithin relation filter and attribute SQL with distance threshold', () => {
    expect(
      buildRelationFilterSql({
        inputTableName: 'input',
        maskTableName: 'mask',
        inputGeometryColumn: 'geometry',
        maskGeometryColumn: 'geometry',
        duckDbFunction: 'ST_Distance',
        distance: 42,
      }),
    ).toBe(
      [
        'SELECT',
        ' i.*',
        'FROM "input" AS i',
        'WHERE i."geometry" IS NOT NULL',
        ' AND EXISTS (',
        '  SELECT 1',
        '  FROM "mask" AS m',
        '  WHERE m."geometry" IS NOT NULL',
        '   AND ST_Distance(i."geometry", m."geometry") <= 42',
        ' )',
      ].join('\n'),
    );

    expect(
      buildRelationAttributeSql({
        inputTableName: 'input',
        maskTableName: 'mask',
        inputGeometryColumn: 'geometry',
        maskGeometryColumn: 'geometry',
        duckDbFunction: 'ST_Distance',
        outputColumn: 'duckdb_distance_within',
        distance: 42,
      }),
    ).toBe(
      [
        'SELECT',
        ' i.*,',
        ' EXISTS (',
        '  SELECT 1',
        '  FROM "mask" AS m',
        '  WHERE m."geometry" IS NOT NULL',
        '   AND ST_Distance(i."geometry", m."geometry") <= 42',
        ' ) AS "duckdb_distance_within"',
        'FROM "input" AS i',
        'WHERE i."geometry" IS NOT NULL',
      ].join('\n'),
    );
  });
});

describe('DuckDB SQL function-name safety', () => {
  it('rejects unsafe unary geometry function names', () => {
    expect(() =>
      buildUnaryGeometrySql({
        tableName: 'input',
        geometryColumn: 'geometry',
        duckDbFunction: 'ST_Buffer(geometry); DROP TABLE input; --',
      }),
    ).toThrow(/unsafe duckdb function/i);
  });

  it('rejects unsafe attribute function names', () => {
    expect(() =>
      buildAttributeSql({
        tableName: 'input',
        geometryColumn: 'geometry',
        duckDbFunction: '1); DROP TABLE input; --',
        outputColumn: 'out',
      }),
    ).toThrow(/unsafe duckdb function/i);
  });

  it('rejects unsafe relation function names (defense-in-depth)', () => {
    expect(() =>
      buildRelationFilterSql({
        inputTableName: 'input',
        maskTableName: 'mask',
        inputGeometryColumn: 'geometry',
        maskGeometryColumn: 'geometry',
        duckDbFunction: 'ST_Intersects(i.geometry, m.geometry) OR 1=1; --' as never,
      }),
    ).toThrow(/unsafe duckdb function/i);
  });

  it('accepts legitimate ST_* function names', () => {
    expect(() =>
      buildUnaryGeometrySql({
        tableName: 'input',
        geometryColumn: 'geometry',
        duckDbFunction: 'ST_Centroid',
      }),
    ).not.toThrow();
  });
});

describe('bufferDatasetWithDuckDb', () => {
  it('processes dataset buffers through an injected DuckDB runtime', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    dataset.layers[0]!.name = 'parcels';
    const resultTable = toArrowTable(dataset, { layer: 'parcels', encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    const result = await bufferDatasetWithDuckDb(
      dataset,
      {
        layer: 'parcels',
        distance: 12.5,
        outputLayer: 'buffered',
      },
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
      buildBufferSql({
        tableName: inputTableName,
        geometryColumn: 'geometry',
        distance: 12.5,
      }),
      `DROP TABLE IF EXISTS ${inputTableName}`,
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

    await bufferDatasetWithDuckDb(dataset, { distance: 10 }, runtime);
    await bufferDatasetWithDuckDb(dataset, { distance: 20 }, runtime);

    const inputTableNames = runtime.connection.inserted.map(({ opts }) => opts.name);
    expect(inputTableNames).toHaveLength(2);
    expect(new Set(inputTableNames).size).toBe(2);
    expect(runtime.connection.queries).toEqual([
      buildBufferSql({
        tableName: inputTableNames[0]!,
        geometryColumn: 'geometry',
        distance: 10,
      }),
      `DROP TABLE IF EXISTS ${inputTableNames[0]}`,
      buildBufferSql({
        tableName: inputTableNames[1]!,
        geometryColumn: 'geometry',
        distance: 20,
      }),
      `DROP TABLE IF EXISTS ${inputTableNames[1]}`,
    ]);
  });

  it('rejects missing DuckDB runtimes before opening a connection', async () => {
    const dataset = await polygonDataset('EPSG:3857');

    await expect(bufferDatasetWithDuckDb(dataset, { distance: 10 }, null)).rejects.toMatchObject({
      kind: 'runtime-unavailable',
    });
  });

  it('wraps DuckDB query failures and closes the operation connection', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    const resultTable = toArrowTable(dataset, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable, new Error('query exploded'));

    await expect(bufferDatasetWithDuckDb(dataset, { distance: 10 }, runtime)).rejects.toMatchObject(
      {
        kind: 'query-failed',
      },
    );
    expect(runtime.connection.closed).toBe(true);
  });

  it('wraps DuckDB table-insertion failures and closes the operation connection', async () => {
    const dataset = await polygonDataset('EPSG:3857');
    const resultTable = toArrowTable(dataset, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable, undefined, new Error('insert exploded'));

    const error = await bufferDatasetWithDuckDb(dataset, { distance: 10 }, runtime).catch(
      (err) => err,
    );

    expect(error).toBeInstanceOf(DuckDbOperationError);
    expect(error).toMatchObject({ kind: 'query-failed' });
    expect(runtime.connection.closed).toBe(true);
  });
});

import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../formats/dataset-to-table';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import {
  areaDatasetWithDuckDb,
  centroidXDatasetWithDuckDb,
  centroidYDatasetWithDuckDb,
  geometryTypeDatasetWithDuckDb,
  isEmptyDatasetWithDuckDb,
  isSimpleDatasetWithDuckDb,
  isValidDatasetWithDuckDb,
  lengthDatasetWithDuckDb,
  perimeterDatasetWithDuckDb,
  xDatasetWithDuckDb,
  yDatasetWithDuckDb,
} from './duckdb-attribute-ops';
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

describe('DuckDB attribute operation helpers', () => {
  const projectedCases = [
    { name: 'areaDatasetWithDuckDb', helper: areaDatasetWithDuckDb, fn: 'ST_Area', column: 'duckdb_area' },
    {
      name: 'lengthDatasetWithDuckDb',
      helper: lengthDatasetWithDuckDb,
      fn: 'ST_Length',
      column: 'duckdb_length',
    },
    {
      name: 'perimeterDatasetWithDuckDb',
      helper: perimeterDatasetWithDuckDb,
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

  it.each(projectedCases)('$name can opt out of geographic CRS rejection', async ({ helper, fn, column }) => {
    const dataset = await polygonDataset('EPSG:4326');
    const runtime = await runtimeFor(dataset);

    await helper(dataset, { failOnGeographicCrs: false }, runtime);

    expect(runtime.ensureSpatialCalls).toBe(1);
    expect(runtime.connection.queries[0]).toContain(`${fn}("geometry") AS "${column}"`);
  });

  const geographicCases = [
    {
      name: 'geometryTypeDatasetWithDuckDb',
      helper: geometryTypeDatasetWithDuckDb,
      expression: 'ST_GeometryType("geometry")',
      column: 'duckdb_geometry_type',
    },
    {
      name: 'isValidDatasetWithDuckDb',
      helper: isValidDatasetWithDuckDb,
      expression: 'ST_IsValid("geometry")',
      column: 'duckdb_is_valid',
    },
    {
      name: 'isEmptyDatasetWithDuckDb',
      helper: isEmptyDatasetWithDuckDb,
      expression: 'ST_IsEmpty("geometry")',
      column: 'duckdb_is_empty',
    },
    {
      name: 'isSimpleDatasetWithDuckDb',
      helper: isSimpleDatasetWithDuckDb,
      expression: 'ST_IsSimple("geometry")',
      column: 'duckdb_is_simple',
    },
    {
      name: 'xDatasetWithDuckDb',
      helper: xDatasetWithDuckDb,
      expression: 'ST_X("geometry")',
      column: 'duckdb_x',
    },
    {
      name: 'yDatasetWithDuckDb',
      helper: yDatasetWithDuckDb,
      expression: 'ST_Y("geometry")',
      column: 'duckdb_y',
    },
    {
      name: 'centroidXDatasetWithDuckDb',
      helper: centroidXDatasetWithDuckDb,
      expression: 'ST_X(ST_Centroid("geometry"))',
      column: 'duckdb_centroid_x',
    },
    {
      name: 'centroidYDatasetWithDuckDb',
      helper: centroidYDatasetWithDuckDb,
      expression: 'ST_Y(ST_Centroid("geometry"))',
      column: 'duckdb_centroid_y',
    },
  ];

  it.each(geographicCases)('$name runs without geographic CRS rejection', async ({ helper, expression, column }) => {
    const dataset = await polygonDataset('EPSG:4326');
    const runtime = await runtimeFor(dataset);

    await helper(dataset, { outputLayer: 'attrs' }, runtime);

    expect(runtime.ensureSpatialCalls).toBe(1);
    expect(runtime.connection.queries[0]).toContain(`${expression} AS "${column}"`);
  });

  it('uses caller-provided output column names', async () => {
    const dataset = await polygonDataset();
    const runtime = await runtimeFor(dataset);

    await areaDatasetWithDuckDb(dataset, { outputColumn: 'computed_area' }, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Area("geometry") AS "computed_area"');
  });
});

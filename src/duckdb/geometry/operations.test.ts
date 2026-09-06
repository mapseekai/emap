import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../../arrow/test-utils';
import type { MapshaperDataset } from '../../../types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';
import {
  boundary,
  centroid,
  convexHull,
  envelope,
  makeValid,
  simplify,
  simplifyPreserveTopology,
} from './index';

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

async function polygonDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POLYGON_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
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

describe('geometry operations', () => {
  const cases = [
    { name: 'centroid', helper: centroid, fn: 'ST_Centroid' },
    { name: 'envelope', helper: envelope, fn: 'ST_Envelope' },
    {
      name: 'convexHull',
      helper: convexHull,
      fn: 'ST_ConvexHull',
    },
    { name: 'boundary', helper: boundary, fn: 'ST_Boundary' },
    { name: 'makeValid', helper: makeValid, fn: 'ST_MakeValid' },
  ] as const;

  it.each(cases)('$name runs $fn without geographic CRS rejection', async ({ helper, fn }) => {
    const dataset = await polygonDataset('EPSG:4326');
    const runtime = await runtimeFor(dataset);

    const result = await helper(dataset, { outputLayer: 'out' }, runtime);

    expect(result.layers[0]?.name).toBe('out');
    expect(result.info?.crs_string).toBe('EPSG:4326');
    expect(runtime.ensureSpatialCalls).toBe(1);
    expect(runtime.connection.queries[0]).toContain(`${fn}("geometry")`);
    expect(runtime.connection.queries[1]).toMatch(
      /^DROP TABLE IF EXISTS "emap_duckdb_geometry_input_\d+"$/,
    );
    expect(runtime.connection.closed).toBe(true);
  });

  it('runs ST_Simplify with validated tolerance', async () => {
    const dataset = await polygonDataset();
    const runtime = await runtimeFor(dataset);

    await simplify(dataset, { tolerance: 2 }, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Simplify("geometry", 2) AS "geometry"');
  });

  it('runs ST_SimplifyPreserveTopology with validated tolerance', async () => {
    const dataset = await polygonDataset();
    const runtime = await runtimeFor(dataset);

    await simplifyPreserveTopology(dataset, { tolerance: 2 }, runtime);

    expect(runtime.connection.queries[0]).toContain(
      'ST_SimplifyPreserveTopology("geometry", 2) AS "geometry"',
    );
  });

  it('rejects invalid simplify tolerances', async () => {
    const dataset = await polygonDataset();

    await expect(simplify(dataset, { tolerance: -1 })).rejects.toBeInstanceOf(DuckDbOperationError);
    await expect(
      simplifyPreserveTopology(dataset, { tolerance: Number.POSITIVE_INFINITY }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'tolerance' });
  });

  it('rejects geographic CRS for simplify operations by default', async () => {
    const dataset = await polygonDataset('EPSG:4326');

    await expect(simplify(dataset, { tolerance: 1 })).rejects.toMatchObject({
      kind: 'validation',
      field: 'crs',
    });
    await expect(simplifyPreserveTopology(dataset, { tolerance: 1 })).rejects.toMatchObject({
      kind: 'validation',
      field: 'crs',
    });
  });

  it('allows geographic CRS for simplify operations when explicitly requested', async () => {
    const dataset = await polygonDataset('EPSG:4326');
    const runtime = await runtimeFor(dataset);

    await simplify(dataset, { tolerance: 1, failOnGeographicCrs: false }, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Simplify');
  });
});

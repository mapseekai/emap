import { tableFromArrays, type Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import {
  spatialAggregateJoinDatasetWithDuckDb,
  type DuckDbSpatialAggregateJoinOptions,
} from './duckdb-spatial-aggregate-join-op';
import * as duckDbSql from './duckdb-sql';

const validOptions = {
  predicate: 'contains',
  joinType: 'left',
  aggregations: [
    { operation: 'count', outputColumn: 'match_count' },
    { operation: 'sum', field: 'sales', outputColumn: 'sales_total' },
  ],
} satisfies DuckDbSpatialAggregateJoinOptions;

const TARGET_FEATURES = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'A', name: 'alpha' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    {
      type: 'Feature',
      properties: { id: 'B', name: 'bravo' },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
    {
      type: 'Feature',
      properties: { id: 'C', name: 'charlie' },
      geometry: { type: 'Point', coordinates: [2, 2] },
    },
  ],
} as const;

const JOIN_FEATURES = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { sales: 10, score: 2 },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
  ],
} as const;

class AggregateConnection implements DuckDbConnection {
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];
  closed = false;

  constructor(private readonly result: Table) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    return this.result;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class AggregateRuntime implements DuckDbRuntime {
  ensured = false;
  readonly connection: AggregateConnection;

  constructor(result: Table) {
    this.connection = new AggregateConnection(result);
  }

  async ensureSpatial(): Promise<void> {
    this.ensured = true;
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }
}

async function targetDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(TARGET_FEATURES);
}

async function joinDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(JOIN_FEATURES);
}

async function emptyJoinDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON({ type: 'FeatureCollection', features: [] });
}

const PREDICATE_FUNCTIONS = [
  'ST_Intersects',
  'ST_Contains',
  'ST_Within',
  'ST_Touches',
  'ST_Overlaps',
  'ST_Equals',
  'ST_Crosses',
  'ST_Covers',
  'ST_CoveredBy',
  'ST_ContainsProperly',
] as const;

type BuildSpatialAggregateJoinSql = (opts: {
  targetTableName: string;
  joinTableName: string;
  targetGeometryColumn: string;
  joinGeometryColumn: string;
  targetRowIdColumn: string;
  duckDbFunction: (typeof PREDICATE_FUNCTIONS)[number];
  aggregations: readonly {
    operation: 'count' | 'sum' | 'avg' | 'min' | 'max';
    field?: string;
    outputColumn: string;
  }[];
}) => string;

const buildSql = () =>
  (duckDbSql as Record<string, unknown>)
    .buildSpatialAggregateJoinSql as BuildSpatialAggregateJoinSql;

describe('buildSpatialAggregateJoinSql', () => {
  it('exports the builder', () => {
    expect((duckDbSql as Record<string, unknown>).buildSpatialAggregateJoinSql).toBeTypeOf(
      'function',
    );
  });

  it.each(PREDICATE_FUNCTIONS)('builds the %s aggregate join plan', (duckDbFunction) => {
    const sql = buildSql()({
      targetTableName: 'target',
      joinTableName: 'join',
      targetGeometryColumn: 'target geometry',
      joinGeometryColumn: 'join geometry',
      targetRowIdColumn: '__emap_rowid',
      duckDbFunction,
      aggregations: [{ operation: 'count', outputColumn: 'match_count' }],
    });

    expect(sql).toContain(
      'WITH target_valid AS (\n  SELECT *\n  FROM "target"\n  WHERE "target geometry" IS NOT NULL\n)',
    );
    expect(sql).toContain(
      'join_valid AS (\n  SELECT *\n  FROM "join"\n  WHERE "join geometry" IS NOT NULL\n)',
    );
    expect(sql).toContain('FROM target_valid AS t\nINNER JOIN join_valid AS j');
    expect(sql).toContain(`ON ${duckDbFunction}(t."target geometry", j."join geometry")`);
    expect(sql).toContain('GROUP BY t."__emap_rowid"\nORDER BY t."__emap_rowid"');
    expect(sql).toContain('COUNT(*) AS "match_count"');
    const onClauses = sql.match(/^  ON .+$/gm);
    expect(onClauses).toEqual([`  ON ${duckDbFunction}(t."target geometry", j."join geometry")`]);
  });

  it('renders mixed aggregates in request order', () => {
    const sql = buildSql()({
      targetTableName: 'target',
      joinTableName: 'join',
      targetGeometryColumn: 'target geometry',
      joinGeometryColumn: 'join geometry',
      targetRowIdColumn: '__emap_rowid',
      duckDbFunction: 'ST_Intersects',
      aggregations: [
        { operation: 'count', outputColumn: 'match count' },
        { operation: 'sum', field: 'sales value', outputColumn: 'sales total' },
        { operation: 'avg', field: 'score', outputColumn: 'score average' },
        { operation: 'min', field: 'sales value', outputColumn: 'sales min' },
        { operation: 'max', field: 'sales value', outputColumn: 'sales max' },
      ],
    });

    expect(sql).toMatch(
      /COUNT\(\*\) AS "match count",\n  SUM\(j\."sales value"\) AS "sales total",\n  AVG\(j\."score"\) AS "score average",\n  MIN\(j\."sales value"\) AS "sales min",\n  MAX\(j\."sales value"\) AS "sales max"/,
    );
  });

  it('quotes identifiers, including embedded double quotes, in every position', () => {
    const sql = buildSql()({
      targetTableName: 'target "table"',
      joinTableName: 'join "table"',
      targetGeometryColumn: 'target "geometry"',
      joinGeometryColumn: 'join "geometry"',
      targetRowIdColumn: 'row "id"',
      duckDbFunction: 'ST_Intersects',
      aggregations: [{ operation: 'sum', field: 'sales "value"', outputColumn: 'total "sales"' }],
    });

    expect(sql).toContain('FROM "target ""table"""');
    expect(sql).toContain('FROM "join ""table"""');
    expect(sql).toContain('"target ""geometry""" IS NOT NULL');
    expect(sql).toContain('"join ""geometry""" IS NOT NULL');
    expect(sql).toContain('t."row ""id"""');
    expect(sql).toContain('ST_Intersects(t."target ""geometry""", j."join ""geometry""")');
    expect(sql).toContain('SUM(j."sales ""value""") AS "total ""sales"""');
  });

  it.each([
    {
      duckDbFunction: 'ST_Buffer',
      aggregations: [{ operation: 'count', outputColumn: 'match_count' }],
    },
    {
      duckDbFunction: 'ST_Contains); DROP TABLE target; --',
      aggregations: [{ operation: 'count', outputColumn: 'match_count' }],
    },
    {
      duckDbFunction: 'ST_Intersects',
      aggregations: [{ operation: 'median', outputColumn: 'median' }],
    },
    {
      duckDbFunction: 'ST_Intersects',
      aggregations: [{ operation: 'toString', field: 'sales', outputColumn: 'invalid' }],
    },
    {
      duckDbFunction: 'ST_Intersects',
      aggregations: [{ operation: 'constructor', field: 'sales', outputColumn: 'invalid' }],
    },
    {
      duckDbFunction: 'ST_Intersects',
      aggregations: [{ operation: '__proto__', field: 'sales', outputColumn: 'invalid' }],
    },
    { duckDbFunction: 'ST_Intersects', aggregations: [] },
  ])('rejects runtime-bypass invalid input %#', ({ duckDbFunction, aggregations }) => {
    expect(() =>
      buildSql()({
        targetTableName: 'target',
        joinTableName: 'join',
        targetGeometryColumn: 'target geometry',
        joinGeometryColumn: 'join geometry',
        targetRowIdColumn: '__emap_rowid',
        duckDbFunction: duckDbFunction as never,
        aggregations: aggregations as never,
      }),
    ).toThrow();
  });

  it('quotes field values that resemble SQL', () => {
    const sql = buildSql()({
      targetTableName: 'target',
      joinTableName: 'join',
      targetGeometryColumn: 'target geometry',
      joinGeometryColumn: 'join geometry',
      targetRowIdColumn: '__emap_rowid',
      duckDbFunction: 'ST_Intersects',
      aggregations: [
        { operation: 'sum', field: 'sales); DROP TABLE target; --', outputColumn: 'total' },
      ],
    });

    expect(sql).toContain('SUM(j."sales); DROP TABLE target; --") AS "total"');
    expect(sql).not.toContain(';\nDROP TABLE');
  });
});

describe('spatialAggregateJoinDatasetWithDuckDb', () => {
  it('preserves target order and attributes while appending aggregate results', async () => {
    const target = await targetDataset();
    const join = await joinDataset();
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [2, 0], match_count: [1, 2], sales_total: [10, 30] }),
    );

    const result = await spatialAggregateJoinDatasetWithDuckDb(target, join, validOptions, runtime);

    expect(runtime.ensured).toBe(true);
    expect(runtime.connection.inserted).toHaveLength(2);
    expect(runtime.connection.inserted[0]!.opts.name).toMatch(
      /^emap_duckdb_spatial_aggregate_target_/,
    );
    expect(runtime.connection.inserted[1]!.opts.name).toMatch(
      /^emap_duckdb_spatial_aggregate_join_/,
    );
    expect(runtime.connection.queries[0]).toContain('ST_Contains');
    expect(runtime.connection.queries).toHaveLength(3);
    expect(runtime.connection.closed).toBe(true);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.data?.getRecords?.()).toEqual([
      { id: 'A', name: 'alpha', match_count: 2, sales_total: 30 },
      { id: 'B', name: 'bravo', match_count: 0, sales_total: null },
      { id: 'C', name: 'charlie', match_count: 1, sales_total: 10 },
    ]);
    expect(target.layers[0]?.data?.getRecords?.()).toEqual([
      { id: 'A', name: 'alpha' },
      { id: 'B', name: 'bravo' },
      { id: 'C', name: 'charlie' },
    ]);
  });

  it('uses target-relative order for inner joins and clones retained shapes', async () => {
    const target = await targetDataset();
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [2, 0], match_count: [1, 2], sales_total: [10, 30] }),
    );

    const result = await spatialAggregateJoinDatasetWithDuckDb(
      target,
      await joinDataset(),
      { ...validOptions, joinType: 'inner' },
      runtime,
    );

    expect(result.layers[0]?.data?.getRecords?.().map((record) => record.id)).toEqual(['A', 'C']);
    expect(result.layers[0]?.shapes?.[0]).toEqual(target.layers[0]?.shapes?.[0]);
    expect(result.layers[0]?.shapes?.[0]).not.toBe(target.layers[0]?.shapes?.[0]);
  });

  it.each([
    [{ ...validOptions, predicate: 'buffer' }, 'predicate'],
    [{ ...validOptions, joinType: 'outer' }, 'joinType'],
    [{ ...validOptions, aggregations: [] }, 'aggregations'],
    [
      { ...validOptions, aggregations: [{ operation: 'count', outputColumn: ' ' }] },
      'aggregations[0].outputColumn',
    ],
    [
      { ...validOptions, aggregations: [{ operation: 'count', outputColumn: 'id' }] },
      'aggregations[0].outputColumn',
    ],
    [
      {
        ...validOptions,
        aggregations: [{ operation: 'sum', field: 'missing', outputColumn: 'total' }],
      },
      'aggregations[0].field',
    ],
  ])('rejects invalid input before connecting (%s)', async (opts, field) => {
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }));

    await expect(
      spatialAggregateJoinDatasetWithDuckDb(
        await targetDataset(),
        await joinDataset(),
        opts as DuckDbSpatialAggregateJoinOptions,
        runtime,
      ),
    ).rejects.toMatchObject({ kind: 'validation', field });
    expect(runtime.connection.inserted).toEqual([]);
    expect(runtime.connection.queries).toEqual([]);
  });

  it('classifies malformed aggregate rows as conversion-failed', async () => {
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [0], match_count: [1] }));

    await expect(
      spatialAggregateJoinDatasetWithDuckDb(
        await targetDataset(),
        await joinDataset(),
        validOptions,
        runtime,
      ),
    ).rejects.toMatchObject({ kind: 'conversion-failed' } satisfies Partial<DuckDbOperationError>);
  });

  it('returns unmatched defaults from a schema-less empty join without connecting', async () => {
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }));

    const result = await spatialAggregateJoinDatasetWithDuckDb(
      await targetDataset(),
      await emptyJoinDataset(),
      {
        predicate: 'intersects',
        aggregations: [{ operation: 'count', outputColumn: 'match_count' }],
      },
      runtime,
    );

    expect(result.layers[0]?.data?.getRecords?.()).toEqual([
      { id: 'A', name: 'alpha', match_count: 0 },
      { id: 'B', name: 'bravo', match_count: 0 },
      { id: 'C', name: 'charlie', match_count: 0 },
    ]);
    expect(runtime.ensured).toBe(false);
    expect(runtime.connection.inserted).toEqual([]);
  });

  it('rejects a missing runtime before CRS conversion or connection', async () => {
    await expect(
      spatialAggregateJoinDatasetWithDuckDb(
        await targetDataset(),
        await joinDataset(),
        validOptions,
        null,
      ),
    ).rejects.toMatchObject({ kind: 'runtime-unavailable' });
  });

  it('uses a supplied output layer name without changing target CRS metadata', async () => {
    const target = await targetDataset();
    target.info = { crs_string: 'EPSG:3857', prj: 'original-prj', wkt1: 'original-wkt' };
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [10] }),
    );

    const result = await spatialAggregateJoinDatasetWithDuckDb(
      target,
      await joinDataset(),
      { ...validOptions, outputLayer: 'statistics' },
      runtime,
    );

    expect(result.layers[0]?.name).toBe('statistics');
    expect(result.info).toEqual(target.info);
    expect(result.info).not.toBe(target.info);
  });
});

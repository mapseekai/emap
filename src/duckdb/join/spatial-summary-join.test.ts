import {
  Binary,
  Bool,
  DateDay,
  Field,
  Int32,
  List,
  Map_,
  RecordBatch,
  Schema,
  Struct,
  Table,
  Utf8,
  makeData,
  tableFromArrays,
  vectorFromArray,
} from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';
import * as datasetToTable from '../../arrow/dataset-to-table';
import * as tableToDataset from '../../arrow/table-to-dataset';
import { datasetFromGeoJSON } from '../../arrow/test-utils';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import * as datasetCrs from '../core/dataset-crs';
import { DuckDbOperationError } from '../errors';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';
import * as duckDb from '../index';
import { spatialSummaryJoin, type SpatialSummaryJoinOptions } from './spatial-summary-join';
import * as duckDbSql from './_spatial-summary-sql';

const validOptions = {
  predicate: 'contains',
  joinType: 'left',
  aggregations: [
    { operation: 'count', outputColumn: 'match_count' },
    { operation: 'sum', field: 'sales', outputColumn: 'sales_total' },
  ],
} satisfies SpatialSummaryJoinOptions;

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

interface AggregateRuntimeOptions {
  connectError?: unknown;
  ensureSpatialError?: unknown;
  insertError?: unknown;
  queryError?: unknown;
  dropErrors?: unknown[];
  closeError?: unknown;
}

class AggregateConnection implements DuckDbConnection {
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];
  closed = false;

  constructor(
    private readonly result: Table,
    private readonly events: string[],
    private readonly options: AggregateRuntimeOptions = {},
  ) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
    this.events.push(`insert:${opts.name}`);
    if (this.options.insertError) throw this.options.insertError;
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    this.events.push(sql.startsWith('DROP TABLE IF EXISTS') ? `drop:${sql}` : 'query:aggregate');
    if (sql.startsWith('DROP TABLE IF EXISTS')) {
      const error = this.options.dropErrors?.shift();
      if (error) throw error;
    } else if (this.options.queryError) {
      throw this.options.queryError;
    }
    return this.result;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.events.push('close');
    if (this.options.closeError) throw this.options.closeError;
  }
}

class AggregateRuntime implements DuckDbRuntime {
  ensured = false;
  readonly events: string[] = [];
  readonly connection: AggregateConnection;

  constructor(
    result: Table,
    private readonly options: AggregateRuntimeOptions = {},
  ) {
    this.connection = new AggregateConnection(result, this.events, options);
  }

  async ensureSpatial(): Promise<void> {
    this.ensured = true;
    this.events.push('ensureSpatial');
    if (this.options.ensureSpatialError) throw this.options.ensureSpatialError;
  }

  async connect(): Promise<DuckDbConnection> {
    this.events.push('connect');
    if (this.options.connectError) throw this.options.connectError;
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

async function expectOperationError(
  promise: Promise<unknown>,
  expected: Partial<Pick<DuckDbOperationError, 'kind' | 'field'>>,
): Promise<DuckDbOperationError> {
  await expect(promise).rejects.toMatchObject(expected);
  try {
    await promise;
  } catch (err) {
    return err as DuckDbOperationError;
  }
  throw new Error('Expected DuckDbOperationError');
}

function craftedJoinTable(field: Field): Table {
  return new Table(new Schema([field, new Field('geometry', new Binary(), true)]));
}

function prototypeAggregateResult(): Table {
  const rowId = vectorFromArray([0], new Int32());
  const aggregate = vectorFromArray([7], new Int32());
  const fields = [
    new Field('__emap_rowid', new Int32(), false),
    new Field('__proto__', new Int32(), true),
  ];
  const schema = new Schema(fields);
  const data = makeData({
    type: new Struct(fields),
    children: [rowId.data[0], aggregate.data[0]],
    length: 1,
    nullCount: 0,
  });
  return new Table(schema, [new RecordBatch(schema, data)]);
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
  it('exports the canonical summary-join helper from the DuckDB barrel', () => {
    expect(duckDb.spatialSummaryJoin).toBeTypeOf('function');
  });

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

describe('spatialSummaryJoin', () => {
  it('preserves target order and attributes while appending aggregate results', async () => {
    const target = await targetDataset();
    const join = await joinDataset();
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [2, 0], match_count: [1, 2], sales_total: [10, 30] }),
    );

    const result = await spatialSummaryJoin(target, join, validOptions, runtime);

    expect(runtime.ensured).toBe(true);
    expect(runtime.connection.inserted).toHaveLength(2);
    expect(runtime.connection.inserted[0]!.opts.name).toMatch(
      /^emap_duckdb_spatial_aggregate_target_/,
    );
    expect(runtime.connection.inserted[1]!.opts.name).toMatch(
      /^emap_duckdb_spatial_aggregate_join_/,
    );
    expect(
      runtime.connection.inserted[0]!.table.schema.fields.map((field) => field.name),
    ).toContain('__emap_rowid');
    expect(
      runtime.connection.inserted[1]!.table.schema.fields.map((field) => field.name),
    ).not.toContain('__emap_rowid');
    expect(runtime.connection.queries[0]).toContain('ST_Contains');
    expect(runtime.events).toEqual([
      'ensureSpatial',
      'connect',
      `insert:${runtime.connection.inserted[0]!.opts.name}`,
      `insert:${runtime.connection.inserted[1]!.opts.name}`,
      'query:aggregate',
      `drop:DROP TABLE IF EXISTS "${runtime.connection.inserted[0]!.opts.name}"`,
      `drop:DROP TABLE IF EXISTS "${runtime.connection.inserted[1]!.opts.name}"`,
      'close',
    ]);
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
    expect(result.layers[0]?.data?.getRecords?.()[0]).not.toBe(
      target.layers[0]?.data?.getRecords?.()[0],
    );
  });

  it('uses target-relative order for inner joins and clones retained shapes', async () => {
    const target = await targetDataset();
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [2, 0], match_count: [1, 2], sales_total: [10, 30] }),
    );

    const result = await spatialSummaryJoin(
      target,
      await joinDataset(),
      { ...validOptions, joinType: 'inner' },
      runtime,
    );

    expect(result.layers[0]?.data?.getRecords?.().map((record) => record.id)).toEqual(['A', 'C']);
    expect(result.layers[0]?.shapes?.[0]).toEqual(target.layers[0]?.shapes?.[0]);
    expect(result.layers[0]?.shapes?.[0]).not.toBe(target.layers[0]?.shapes?.[0]);
    expect((result.layers[0]?.shapes?.[0] as unknown[])?.[0]).not.toBe(
      (target.layers[0]?.shapes?.[0] as unknown[])?.[0],
    );
  });

  it.each([
    [{ ...validOptions, predicate: 'buffer' }, 'predicate'],
    [{ ...validOptions, joinType: 'outer' }, 'joinType'],
    [{ ...validOptions, aggregations: [] }, 'aggregations'],
    [{ ...validOptions, aggregations: [null] }, 'aggregations[0]'],
    [
      { ...validOptions, aggregations: [{ operation: 'median', outputColumn: 'median' }] },
      'aggregations[0].operation',
    ],
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
    [
      {
        ...validOptions,
        aggregations: [
          { operation: 'count', outputColumn: 'one' },
          { operation: 'count', outputColumn: ' one ' },
        ],
      },
      'aggregations[1].outputColumn',
    ],
    [
      {
        ...validOptions,
        aggregations: [{ operation: 'count', field: 'sales', outputColumn: 'count' }],
      },
      'aggregations[0].field',
    ],
    [
      { ...validOptions, aggregations: [{ operation: 'sum', field: ' ', outputColumn: 'total' }] },
      'aggregations[0].field',
    ],
    [{ ...validOptions, targetLayer: 99 }, 'targetLayer'],
    [{ ...validOptions, joinLayer: -1 }, 'joinLayer'],
  ])('rejects invalid input before connecting (%s)', async (opts, field) => {
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }));

    await expect(
      spatialSummaryJoin(
        await targetDataset(),
        await joinDataset(),
        opts as SpatialSummaryJoinOptions,
        runtime,
      ),
    ).rejects.toMatchObject({ kind: 'validation', field });
    expect(runtime.connection.inserted).toEqual([]);
    expect(runtime.connection.queries).toEqual([]);
  });

  it('classifies malformed aggregate rows as conversion-failed', async () => {
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [0], match_count: [1] }));

    await expect(
      spatialSummaryJoin(await targetDataset(), await joinDataset(), validOptions, runtime),
    ).rejects.toMatchObject({ kind: 'conversion-failed' } satisfies Partial<DuckDbOperationError>);
  });

  it('returns unmatched defaults from a schema-less empty join without connecting', async () => {
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }));

    const result = await spatialSummaryJoin(
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
      spatialSummaryJoin(await targetDataset(), await joinDataset(), validOptions, null),
    ).rejects.toMatchObject({ kind: 'runtime-unavailable' });
  });

  it('uses a supplied output layer name without changing target CRS metadata', async () => {
    const target = await targetDataset();
    const arcs = { sentinel: true };
    target.arcs = arcs as never;
    target.layers[0]!.id = 'target-layer';
    target.info = { crs_string: 'EPSG:3857', prj: 'original-prj', wkt1: 'original-wkt' };
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [10] }),
    );

    const result = await spatialSummaryJoin(
      target,
      await joinDataset(),
      { ...validOptions, outputLayer: 'statistics' },
      runtime,
    );

    expect(result.layers[0]?.name).toBe('statistics');
    expect(result.info).toEqual(target.info);
    expect(result.info).not.toBe(target.info);
    expect(result.arcs).toBe(arcs);
    expect(result.layers[0]?.id).toBe('target-layer');
    expect(result.layers[0]?.geometry_type).toBe('point');
  });

  it.each([
    [null],
    [-1],
    [1.5],
    [99],
    [0, 0],
  ])('rejects malformed result row ids %#', async (...rowIds) => {
    const runtime = new AggregateRuntime(
      tableFromArrays({
        __emap_rowid: rowIds,
        match_count: rowIds.map(() => 1),
        sales_total: rowIds.map(() => 1),
      }),
    );
    await expect(
      spatialSummaryJoin(await targetDataset(), await joinDataset(), validOptions, runtime),
    ).rejects.toMatchObject({ kind: 'conversion-failed' });
  });

  it('classifies extension, query, cleanup, and primary-error precedence', async () => {
    const extensionError = new Error('extension');
    await expect(
      spatialSummaryJoin(
        await targetDataset(),
        await joinDataset(),
        validOptions,
        new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }), {
          ensureSpatialError: extensionError,
        }),
      ),
    ).rejects.toMatchObject({ kind: 'spatial-extension-unavailable', cause: extensionError });

    const queryError = new Error('query');
    const primaryRuntime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }), {
      queryError,
      dropErrors: [new Error('first drop'), new Error('second drop')],
      closeError: new Error('close'),
    });
    await expect(
      spatialSummaryJoin(await targetDataset(), await joinDataset(), validOptions, primaryRuntime),
    ).rejects.toMatchObject({ kind: 'query-failed', cause: queryError });
    expect(primaryRuntime.events.filter((event) => event.startsWith('drop:'))).toHaveLength(2);
    expect(primaryRuntime.events.at(-1)).toBe('close');

    const cleanupError = new Error('drop');
    await expect(
      spatialSummaryJoin(
        await targetDataset(),
        await joinDataset(),
        validOptions,
        new AggregateRuntime(
          tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [1] }),
          { dropErrors: [cleanupError] },
        ),
      ),
    ).rejects.toMatchObject({ kind: 'query-failed', cause: cleanupError, message: /cleanup/i });
  });

  it('keeps null target shapes as unmatched left rows and removes them from inner output', async () => {
    const target = await targetDataset();
    target.layers[0]!.shapes![1] = null;
    const left = await spatialSummaryJoin(
      target,
      await joinDataset(),
      validOptions,
      new AggregateRuntime(
        tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [1] }),
      ),
    );
    const inner = await spatialSummaryJoin(
      target,
      await joinDataset(),
      { ...validOptions, joinType: 'inner' },
      new AggregateRuntime(
        tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [1] }),
      ),
    );
    expect(left.layers[0]?.shapes?.[1]).toBeNull();
    expect(left.layers[0]?.data?.getRecords?.()[1]).toMatchObject({
      match_count: 0,
      sales_total: null,
    });
    expect(inner.layers[0]?.data?.getRecords?.().map((record) => record.id)).toEqual(['A']);
  });

  it('rejects null joinType rather than treating it as the default', async () => {
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }));

    await expect(
      spatialSummaryJoin(
        await targetDataset(),
        await joinDataset(),
        { ...validOptions, joinType: null } as unknown as SpatialSummaryJoinOptions,
        runtime,
      ),
    ).rejects.toMatchObject({ kind: 'validation', field: 'joinType' });
  });

  it('validates aggregations before layer selectors', async () => {
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }));

    await expect(
      spatialSummaryJoin(
        await targetDataset(),
        await joinDataset(),
        {
          predicate: 'contains',
          targetLayer: 'missing',
          aggregations: [],
        } as unknown as SpatialSummaryJoinOptions,
        runtime,
      ),
    ).rejects.toMatchObject({ kind: 'validation', field: 'aggregations' });
  });

  it('uses fallback geometry names in Arrow tables and generated SQL', async () => {
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [1] }),
    );
    await spatialSummaryJoin(
      await targetDataset(),
      await joinDataset(),
      { ...validOptions, targetGeometryColumn: '', joinGeometryColumn: '' },
      runtime,
    );
    expect(runtime.connection.inserted[0]!.table.schema.fields.at(-1)?.name).toBe('geometry');
    expect(runtime.connection.inserted[1]!.table.schema.fields.at(-1)?.name).toBe('geometry');
    expect(runtime.connection.queries[0]).toContain('ST_Contains(t."geometry", j."geometry")');
  });

  it('resolves named and indexed non-default layers with independent geometry aliases', async () => {
    const target = await targetDataset();
    const join = await joinDataset();
    target.layers.push({ ...target.layers[0]!, name: 'target-extra', id: 'target-extra' });
    join.layers.push({ ...join.layers[0]!, name: 'join-extra', id: 'join-extra' });
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [1] }),
    );
    await spatialSummaryJoin(
      target,
      join,
      {
        ...validOptions,
        targetLayer: 'target-extra',
        joinLayer: 1,
        targetGeometryColumn: 'target_geom',
        joinGeometryColumn: 'join_geom',
      },
      runtime,
    );
    expect(runtime.connection.queries[0]).toContain('ST_Contains(t."target_geom", j."join_geom")');
  });

  it.each([
    ['sum', new Field('sales', new Utf8(), true)],
    ['avg', new Field('sales', new Bool(), true)],
    ['sum', new Field('sales', new DateDay(), true)],
    ['sum', new Field('sales', new List(new Field('item', new Int32(), true)), true)],
    ['min', new Field('sales', new List(new Field('item', new Int32(), true)), true)],
    ['max', new Field('sales', new List(new Field('item', new Int32(), true)), true)],
    ['min', new Field('sales', new Struct([new Field('x', new Int32(), true)]), true)],
    ['sum', new Field('sales', new Struct([new Field('x', new Int32(), true)]), true)],
    ['avg', new Field('sales', new Struct([new Field('x', new Int32(), true)]), true)],
    [
      'max',
      new Field(
        'sales',
        new Map_(
          new Field(
            'entries',
            new Struct([
              new Field('key', new Utf8(), false),
              new Field('value', new Int32(), true),
            ]),
            false,
          ),
        ),
        true,
      ),
    ],
    ['min', new Field('sales', new Binary(), true)],
    ['sum', new Field('sales', new Binary(), true)],
    ['avg', new Field('sales', new Binary(), true)],
  ] as const)('rejects invalid %s Arrow field types before connecting', async (operation, field) => {
    const target = await targetDataset();
    const join = await joinDataset();
    const realToArrowTable = datasetToTable.toArrowTable;
    const targetTable = realToArrowTable(target, { encoding: 'wkb' });
    const spy = vi.spyOn(datasetToTable, 'toArrowTable');
    spy.mockReturnValueOnce(targetTable).mockReturnValueOnce(craftedJoinTable(field));
    try {
      const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }));
      await expectOperationError(
        spatialSummaryJoin(
          target,
          join,
          {
            predicate: 'contains',
            aggregations: [{ operation, field: 'sales', outputColumn: 'value' }],
          } as SpatialSummaryJoinOptions,
          runtime,
        ),
        { kind: 'validation', field: 'aggregations[0].field' },
      );
      expect(runtime.connection.inserted).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves exact whitespace join field names rather than trimming lookup keys', async () => {
    const join = await joinDataset();
    join.layers[0]!.data = {
      getFields: () => [' sales '],
      getRecords: () => [{ ' sales ': 10 }],
    };
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [0], total: [10] }));
    await spatialSummaryJoin(
      await targetDataset(),
      join,
      {
        predicate: 'contains',
        aggregations: [{ operation: 'sum', field: ' sales ', outputColumn: 'total' }],
      },
      runtime,
    );
    expect(runtime.connection.queries[0]).toContain('SUM(j." sales ")');
  });

  it('defaults omitted joinType to left and handles empty target and empty-join inner output', async () => {
    const defaultRuntime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [1] }),
    );
    const defaultResult = await spatialSummaryJoin(
      await targetDataset(),
      await joinDataset(),
      { predicate: 'contains', aggregations: validOptions.aggregations },
      defaultRuntime,
    );
    expect(defaultResult.layers[0]?.data?.getRecords?.()).toHaveLength(3);

    const emptyTarget = await datasetFromGeoJSON({ type: 'FeatureCollection', features: [] });
    const emptyResult = await spatialSummaryJoin(
      emptyTarget,
      await joinDataset(),
      validOptions,
      new AggregateRuntime(tableFromArrays({ __emap_rowid: [] })),
    );
    expect(emptyResult.layers).toHaveLength(1);
    expect(emptyResult.layers[0]?.data?.getRecords?.()).toEqual([]);

    const innerResult = await spatialSummaryJoin(
      await targetDataset(),
      await emptyJoinDataset(),
      {
        predicate: 'contains',
        joinType: 'inner',
        aggregations: [{ operation: 'count', outputColumn: 'count' }],
      },
      new AggregateRuntime(tableFromArrays({ __emap_rowid: [] })),
    );
    expect(innerResult.layers[0]?.data?.getRecords?.()).toEqual([]);
  });

  it('treats typed null-geometry join rows as non-matches while retaining them in Arrow input', async () => {
    const join = await joinDataset();
    join.layers[0]!.shapes![0] = null;
    const emptyAggregates = tableFromArrays({ __emap_rowid: [], match_count: [], sales_total: [] });
    const leftRuntime = new AggregateRuntime(emptyAggregates);
    const left = await spatialSummaryJoin(await targetDataset(), join, validOptions, leftRuntime);
    expect(leftRuntime.connection.inserted[1]!.table.numRows).toBe(1);
    expect(leftRuntime.connection.queries[0]).toContain('WHERE "geometry" IS NOT NULL');
    expect(left.layers[0]?.data?.getRecords?.()[0]).toMatchObject({
      match_count: 0,
      sales_total: null,
    });
    const inner = await spatialSummaryJoin(
      await targetDataset(),
      join,
      { ...validOptions, joinType: 'inner' },
      new AggregateRuntime(emptyAggregates),
    );
    expect(inner.layers[0]?.data?.getRecords?.()).toEqual([]);
  });

  it('chooses an internal row id that avoids target fields, geometry aliases, and outputs', async () => {
    const target = await targetDataset();
    target.layers[0]!.data = {
      getFields: () => ['id', '__emap_rowid', '__emap_rowid_1'],
      getRecords: () => [
        { id: 'A', __emap_rowid: 'user', __emap_rowid_1: 'user' },
        { id: 'B', __emap_rowid: 'user', __emap_rowid_1: 'user' },
        { id: 'C', __emap_rowid: 'user', __emap_rowid_1: 'user' },
      ],
    };
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid_4: [0], __emap_rowid_3: [1] }),
    );
    await spatialSummaryJoin(
      target,
      await joinDataset(),
      {
        predicate: 'contains',
        targetGeometryColumn: '__emap_rowid_2',
        aggregations: [{ operation: 'count', outputColumn: '__emap_rowid_3' }],
      },
      runtime,
    );
    expect(
      runtime.connection.inserted[0]!.table.schema.fields.map((field) => field.name),
    ).toContain('__emap_rowid_4');
  });

  it.each([
    [tableFromArrays({ match_count: [1], sales_total: [1] })],
    [
      tableFromArrays({
        __emap_rowid: [BigInt(Number.MAX_SAFE_INTEGER) + 1n],
        match_count: [1],
        sales_total: [1],
      }),
    ],
  ])('classifies missing or unsafe result row ids as conversion failures', async (result) => {
    await expectOperationError(
      spatialSummaryJoin(
        await targetDataset(),
        await joinDataset(),
        validOptions,
        new AggregateRuntime(result),
      ),
      { kind: 'conversion-failed' },
    );
  });

  it.each([
    'connectError',
    'insertError',
  ] as const)('classifies %s as query-failed and preserves close execution', async (failure) => {
    const error = new Error(failure);
    const runtime = new AggregateRuntime(tableFromArrays({ __emap_rowid: [] }), {
      [failure]: error,
    });
    const received = await expectOperationError(
      spatialSummaryJoin(await targetDataset(), await joinDataset(), validOptions, runtime),
      { kind: 'query-failed' },
    );
    expect(received.cause).toBe(error);
    expect(runtime.events.at(-1)).toBe(failure === 'connectError' ? 'connect' : 'close');
  });

  it('reports close cleanup failures after a successful aggregate query', async () => {
    const cause = new Error('close');
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [1] }),
      { closeError: cause },
    );
    const err = await expectOperationError(
      spatialSummaryJoin(await targetDataset(), await joinDataset(), validOptions, runtime),
      { kind: 'query-failed' },
    );
    expect(err.message).toMatch(/cleanup/i);
    expect(err.cause).toBe(cause);
    expect(runtime.events.at(-1)).toBe('close');
  });

  it('retains the first successful-query cleanup DROP error while attempting both drops and close', async () => {
    const first = new Error('first drop');
    const runtime = new AggregateRuntime(
      tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [1] }),
      { dropErrors: [first, new Error('second drop')], closeError: new Error('close') },
    );
    const err = await expectOperationError(
      spatialSummaryJoin(await targetDataset(), await joinDataset(), validOptions, runtime),
      { kind: 'query-failed' },
    );
    expect(err.message).toMatch(/cleanup/i);
    expect(err.cause).toBe(first);
    expect(runtime.events.filter((event) => event.startsWith('drop:'))).toHaveLength(2);
    expect(runtime.events.at(-1)).toBe('close');
  });

  it.each([
    [
      'target conversion',
      async () => {
        const spy = vi.spyOn(datasetToTable, 'toArrowTable').mockImplementation(() => {
          throw new Error('target conversion');
        });
        return spy;
      },
    ],
    [
      'join conversion',
      async () => {
        const target = await targetDataset();
        const real = datasetToTable.toArrowTable;
        const targetTable = real(target, { encoding: 'wkb' });
        const spy = vi.spyOn(datasetToTable, 'toArrowTable');
        spy.mockReturnValueOnce(targetTable).mockImplementationOnce(() => {
          throw new Error('join conversion');
        });
        return spy;
      },
    ],
  ] as const)('preserves %s failure causes as conversion-failed', async (_label, setup) => {
    const spy = await setup();
    try {
      const err = await expectOperationError(
        spatialSummaryJoin(
          await targetDataset(),
          await joinDataset(),
          validOptions,
          new AggregateRuntime(tableFromArrays({ __emap_rowid: [] })),
        ),
        { kind: 'conversion-failed' },
      );
      expect(err.cause).toBeInstanceOf(Error);
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves CRS alignment and result decoding causes as conversion-failed', async () => {
    const crsCause = new Error('CRS alignment');
    const crsSpy = vi.spyOn(datasetCrs, 'alignSecondaryDatasetCrs').mockRejectedValue(crsCause);
    try {
      const err = await expectOperationError(
        spatialSummaryJoin(
          await targetDataset(),
          await joinDataset(),
          validOptions,
          new AggregateRuntime(tableFromArrays({ __emap_rowid: [] })),
        ),
        { kind: 'conversion-failed' },
      );
      expect(err.cause).toBe(crsCause);
    } finally {
      crsSpy.mockRestore();
    }

    const decodeCause = new Error('decode');
    const recordsSpy = vi.spyOn(tableToDataset, 'recordsFromArrowTable').mockImplementation(() => {
      throw decodeCause;
    });
    try {
      const err = await expectOperationError(
        spatialSummaryJoin(
          await targetDataset(),
          await joinDataset(),
          validOptions,
          new AggregateRuntime(
            tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [1] }),
          ),
        ),
        { kind: 'conversion-failed' },
      );
      expect(err.cause).toBe(decodeCause);
    } finally {
      recordsSpy.mockRestore();
    }
  });

  it.each([
    [tableFromArrays({ __emap_rowid: [0], sales_total: [1] })],
    [tableFromArrays({ __emap_rowid: [0], match_count: [1] })],
  ])('requires every requested aggregate result column', async (result) => {
    await expectOperationError(
      spatialSummaryJoin(
        await targetDataset(),
        await joinDataset(),
        validOptions,
        new AggregateRuntime(result),
      ),
      { kind: 'conversion-failed' },
    );
  });

  it.each([
    '',
    null,
    false,
    0,
  ])('does not blame fallback target geometry alias %j when geometry is missing', async (targetGeometryColumn) => {
    const target = await targetDataset();
    delete target.layers[0]!.geometry_type;
    const err = await expectOperationError(
      spatialSummaryJoin(
        target,
        await joinDataset(),
        { ...validOptions, targetGeometryColumn } as unknown as SpatialSummaryJoinOptions,
        new AggregateRuntime(tableFromArrays({ __emap_rowid: [] })),
      ),
      { kind: 'validation' },
    );
    expect(err.field).toBeUndefined();
  });

  it.each([
    '',
    null,
    false,
    0,
  ])('does not blame fallback join geometry alias %j when geometry is missing', async (joinGeometryColumn) => {
    const join = await joinDataset();
    delete join.layers[0]!.geometry_type;
    const err = await expectOperationError(
      spatialSummaryJoin(
        await targetDataset(),
        join,
        { ...validOptions, joinGeometryColumn } as unknown as SpatialSummaryJoinOptions,
        new AggregateRuntime(tableFromArrays({ __emap_rowid: [] })),
      ),
      { kind: 'validation' },
    );
    expect(err.field).toBeUndefined();
  });

  it('preserves prototype-named aggregate outputs for matched and unmatched rows', async () => {
    const target = await targetDataset();
    const before = structuredClone(target.layers[0]!.data!.getRecords!());
    const runtime = new AggregateRuntime(prototypeAggregateResult());

    const result = await spatialSummaryJoin(
      target,
      await joinDataset(),
      {
        predicate: 'contains',
        aggregations: [{ operation: 'count', outputColumn: '__proto__' }],
      },
      runtime,
    );
    const records = result.layers[0]!.data!.getRecords!();

    expect(records.map((record) => record.__proto__)).toEqual([7, 0, 0]);
    for (const record of records) {
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
      expect(Object.hasOwn(record, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(record, '__proto__')?.enumerable).toBe(true);
      expect(Object.keys(record).at(-1)).toBe('__proto__');
    }
    expect(target.layers[0]!.data!.getRecords!()).toEqual(before);
    expect(
      target.layers[0]!.data!.getRecords!().every((record) => !Object.hasOwn(record, '__proto__')),
    ).toBe(true);
  });
});

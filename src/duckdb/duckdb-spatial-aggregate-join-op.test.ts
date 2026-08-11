import { describe, expect, it } from 'vitest';
import * as duckDbSql from './duckdb-sql';

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

import { describe, expect, it } from 'vitest';

import { DuckDbOperationError } from './duckdb-errors';
import { validateDuckDbSelectSql } from './duckdb-query-sql';

const columns = ['name', 'population', 'active', 'geometry', '__emap_rowid'];

function validate(sql: string) {
  return validateDuckDbSelectSql(sql, {
    availableColumns: columns,
    geometryColumn: 'geometry',
    inputTableName: 'input',
    physicalTableName: 'emap_duckdb_query_input_1',
    rowIdColumn: '__emap_rowid',
  });
}

function expectValidationError(sql: string) {
  expect(() => validate(sql)).toThrow(DuckDbOperationError);
  expect(() => validate(sql)).toThrow(/DuckDB query/);
}

describe('validateDuckDbSelectSql', () => {
  it('expands star projections and rewrites the input table', () => {
    expect(validate('SELECT * FROM input')).toEqual({
      outputColumns: ['name', 'population', 'active'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."name" AS "name", "input"."population" AS "population", "input"."active" AS "active" FROM "emap_duckdb_query_input_1" AS "input"',
    });
  });

  it('rewrites selected attributes and preserves where/order/limit tail', () => {
    expect(
      validate(
        'SELECT name, population FROM input WHERE population > 100 ORDER BY population DESC LIMIT 2',
      ),
    ).toEqual({
      outputColumns: ['name', 'population'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."name" AS "name", "input"."population" AS "population" FROM "emap_duckdb_query_input_1" AS "input" WHERE population > 100 ORDER BY population DESC LIMIT 2',
    });
  });

  it('accepts order/limit tail without a where clause', () => {
    expect(validate('SELECT active FROM input ORDER BY active DESC LIMIT 1')).toEqual({
      outputColumns: ['active'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."active" AS "active" FROM "emap_duckdb_query_input_1" AS "input" ORDER BY active DESC LIMIT 1',
    });
  });

  it('accepts quoted identifiers and multiline formatting', () => {
    expect(
      validate(`
        select
          "name",
          "active"
        from
          input
        where active = true
        limit 1
      `),
    ).toEqual({
      outputColumns: ['name', 'active'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."name" AS "name", "input"."active" AS "active" FROM "emap_duckdb_query_input_1" AS "input"\n        where active = true\n        limit 1',
    });
  });

  it.each([
    ['multiple statements', 'SELECT * FROM input; SELECT * FROM input'],
    ['join', 'SELECT name FROM input JOIN other ON input.id = other.id'],
    ['non-input table', 'SELECT name FROM other'],
    ['cte', 'WITH source AS (SELECT * FROM input) SELECT * FROM source'],
    ['subquery', 'SELECT name FROM (SELECT * FROM input)'],
    ['insert', 'INSERT INTO other SELECT * FROM input'],
    ['copy', 'COPY input TO "out.parquet"'],
    ['attach', "ATTACH 'db.duckdb' AS other"],
    ['install', 'INSTALL spatial'],
    ['load', 'LOAD spatial'],
    ['pragma', 'PRAGMA table_info(input)'],
    ['missing from input', 'SELECT name'],
    ['empty sql', '  '],
    ['line comment', 'SELECT name FROM input -- nope'],
    ['block comment', 'SELECT name FROM input /* nope */'],
    ['geometry projection', 'SELECT geometry FROM input'],
    ['row id projection', 'SELECT __emap_rowid FROM input'],
    ['unknown projection', 'SELECT missing FROM input'],
    ['alias projection', 'SELECT name AS label FROM input'],
    ['expression projection', 'SELECT population + 1 FROM input'],
    ['qualified projection', 'SELECT input.name FROM input'],
    ['table alias as', 'SELECT name FROM input AS i'],
    ['table alias bare', 'SELECT name FROM input i'],
    ['union', 'SELECT name FROM input UNION SELECT name FROM input'],
    ['group by', 'SELECT name FROM input GROUP BY name'],
    ['having', 'SELECT name FROM input HAVING count(*) > 1'],
  ])('rejects %s', (_name, sql) => {
    expectValidationError(sql);
  });
});

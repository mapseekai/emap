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

function validateWithColumns(sql: string, availableColumns: readonly string[]) {
  return validateDuckDbSelectSql(sql, {
    availableColumns,
    geometryColumn: 'geometry',
    inputTableName: 'input',
    physicalTableName: 'emap_duckdb_query_input_1',
    rowIdColumn: '__emap_rowid',
  });
}

function validateGeoParquet(sql: string) {
  return validateDuckDbSelectSql(sql, {
    allowGeometryProjection: true,
    availableColumns: columns,
    geometryColumn: 'geometry',
    inputTableName: 'input',
    physicalTableName: 'emap_duckdb_geoparquet_input_1',
    rowIdColumn: null,
  });
}

function expectValidationError(sql: string) {
  expect(() => validate(sql)).toThrow(DuckDbOperationError);
  expect(() => validate(sql)).toThrow(/DuckDB query/);
}

function expectValidationErrorWithColumns(sql: string, availableColumns: readonly string[]) {
  expect(() => validateWithColumns(sql, availableColumns)).toThrow(DuckDbOperationError);
  expect(() => validateWithColumns(sql, availableColumns)).toThrow(/DuckDB query/);
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

  it('accepts comment-like tokens inside quoted string values', () => {
    expect(validate("SELECT name FROM input WHERE name = '--not a comment'")).toEqual({
      outputColumns: ['name'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."name" AS "name" FROM "emap_duckdb_query_input_1" AS "input" WHERE name = \'--not a comment\'',
    });
  });

  it('accepts comment-like tokens inside quoted identifiers', () => {
    expect(
      validateWithColumns('SELECT "na--me" FROM input', ['na--me', 'geometry', '__emap_rowid']),
    ).toEqual({
      outputColumns: ['na--me'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."na--me" AS "na--me" FROM "emap_duckdb_query_input_1" AS "input"',
    });
  });

  it('accepts semicolons inside quoted string values', () => {
    expect(validate("SELECT name FROM input WHERE name = 'a;b'")).toEqual({
      outputColumns: ['name'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."name" AS "name" FROM "emap_duckdb_query_input_1" AS "input" WHERE name = \'a;b\'',
    });
  });

  it('accepts semicolons inside quoted identifiers', () => {
    expect(
      validateWithColumns('SELECT "semi;col" FROM input', ['semi;col', 'geometry', '__emap_rowid']),
    ).toEqual({
      outputColumns: ['semi;col'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."semi;col" AS "semi;col" FROM "emap_duckdb_query_input_1" AS "input"',
    });
  });

  it('accepts quoted where and order by identifiers', () => {
    expect(
      validate('SELECT name FROM input WHERE "name" = \'alpha\' ORDER BY "population" DESC'),
    ).toEqual({
      outputColumns: ['name'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."name" AS "name" FROM "emap_duckdb_query_input_1" AS "input" WHERE "name" = \'alpha\' ORDER BY "population" DESC',
    });
  });

  it('accepts quoted projection identifiers containing dots', () => {
    expect(
      validateWithColumns('SELECT "admin.level" FROM input', [
        'admin.level',
        'geometry',
        '__emap_rowid',
      ]),
    ).toEqual({
      outputColumns: ['admin.level'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."admin.level" AS "admin.level" FROM "emap_duckdb_query_input_1" AS "input"',
    });
  });

  it('accepts non-geometry columns with geometry as a name prefix', () => {
    expect(
      validateWithColumns('SELECT "geometry-note" FROM input ORDER BY "geometry-note"', [
        'geometry-note',
        'geometry',
        '__emap_rowid',
      ]),
    ).toEqual({
      outputColumns: ['geometry-note'],
      rowIdColumn: '__emap_rowid',
      sql: 'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."geometry-note" AS "geometry-note" FROM "emap_duckdb_query_input_1" AS "input" ORDER BY "geometry-note"',
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
    ['semicolon outside quotes', "SELECT name FROM input WHERE name = 'a';"],
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
    ['quoted table-qualified projection', 'SELECT "input"."name" FROM input'],
    ['table alias as', 'SELECT name FROM input AS i'],
    ['table alias bare', 'SELECT name FROM input i'],
    ['union', 'SELECT name FROM input UNION SELECT name FROM input'],
    ['group by', 'SELECT name FROM input GROUP BY name'],
    ['having', 'SELECT name FROM input HAVING count(*) > 1'],
    ['limit trailing garbage', 'SELECT name FROM input LIMIT 1 foo'],
    ['where trailing garbage', 'SELECT name FROM input WHERE population > 1 foo'],
    ['order limit trailing garbage', 'SELECT name FROM input ORDER BY population LIMIT 1 extra'],
    ['limit expression', 'SELECT name FROM input LIMIT population'],
    ['missing where column', 'SELECT name FROM input WHERE missing = 1'],
    ['geometry where column', 'SELECT name FROM input WHERE geometry = 1'],
    ['row id where column', 'SELECT name FROM input WHERE __emap_rowid = 1'],
    ['missing order by column', 'SELECT name FROM input ORDER BY missing'],
    ['geometry order by column', 'SELECT name FROM input ORDER BY geometry'],
    ['row id order by column', 'SELECT name FROM input ORDER BY __emap_rowid'],
  ])('rejects %s', (_name, sql) => {
    expectValidationError(sql);
  });

  it('rejects exact geometry columns while allowing geometry-prefixed names', () => {
    expectValidationErrorWithColumns('SELECT geometry FROM input', [
      'geometry-note',
      'geometry',
      '__emap_rowid',
    ]);
    expectValidationErrorWithColumns('SELECT "geometry" FROM input', [
      'geometry-note',
      'geometry',
      '__emap_rowid',
    ]);
    expectValidationErrorWithColumns('SELECT "geometry-note" FROM input WHERE geometry = 1', [
      'geometry-note',
      'geometry',
      '__emap_rowid',
    ]);
    expectValidationErrorWithColumns('SELECT "geometry-note" FROM input ORDER BY geometry', [
      'geometry-note',
      'geometry',
      '__emap_rowid',
    ]);
  });
});

describe('validateDuckDbSelectSql for GeoParquet results', () => {
  it('allows geometry projection without adding an internal row id', () => {
    expect(validateGeoParquet('SELECT geometry, name FROM input WHERE population > 10')).toEqual({
      outputColumns: ['geometry', 'name'],
      rowIdColumn: null,
      sql: 'SELECT "input"."geometry" AS "geometry", "input"."name" AS "name" FROM "emap_duckdb_geoparquet_input_1" AS "input" WHERE population > 10',
    });
  });

  it('expands star to include geometry when geometry projection is allowed', () => {
    expect(validateGeoParquet('SELECT * FROM input LIMIT 1')).toEqual({
      outputColumns: ['name', 'population', 'active', 'geometry'],
      rowIdColumn: null,
      sql: 'SELECT "input"."name" AS "name", "input"."population" AS "population", "input"."active" AS "active", "input"."geometry" AS "geometry" FROM "emap_duckdb_geoparquet_input_1" AS "input" LIMIT 1',
    });
  });

  it('still rejects geometry in WHERE and ORDER BY clauses', () => {
    expect(() => validateGeoParquet('SELECT geometry FROM input WHERE geometry = 1')).toThrow(
      DuckDbOperationError,
    );
    expect(() => validateGeoParquet('SELECT geometry FROM input ORDER BY geometry')).toThrow(
      DuckDbOperationError,
    );
  });

  it('rejects direct read_parquet calls in user SQL', () => {
    expect(() => validateGeoParquet("SELECT geometry FROM read_parquet('file.parquet')")).toThrow(
      DuckDbOperationError,
    );
  });
});

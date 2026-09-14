import { describe, expect, it } from 'vitest';
import { buildAttributeSql } from '../../../src/integrations/duckdb/core/sql/attribute';
import { buildUnaryGeometrySql } from '../../../src/integrations/duckdb/core/sql/geometry';
import {
  buildRelationAttributeSql,
  buildRelationFilterSql,
} from '../../../src/integrations/duckdb/core/sql/relation';

const ADDITIONAL_RELATION_CASES = [
  { duckDbFunction: 'ST_Overlaps', outputColumn: 'duckdb_overlaps' },
  { duckDbFunction: 'ST_Equals', outputColumn: 'duckdb_equals' },
  { duckDbFunction: 'ST_Crosses', outputColumn: 'duckdb_crosses' },
  { duckDbFunction: 'ST_Covers', outputColumn: 'duckdb_covers' },
  { duckDbFunction: 'ST_CoveredBy', outputColumn: 'duckdb_covered_by' },
  { duckDbFunction: 'ST_ContainsProperly', outputColumn: 'duckdb_contains_properly' },
] as const;

describe('DuckDB core SQL builders', () => {
  it('builds unary geometry SQL and quotes identifiers', () => {
    expect(
      buildUnaryGeometrySql({
        tableName: 'input table',
        geometryColumn: 'geom"col',
        duckDbFunction: 'ST_Buffer',
        args: [3],
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

  it('supports numeric unary geometry arguments', () => {
    expect(
      buildUnaryGeometrySql({
        tableName: 'input',
        geometryColumn: 'geometry',
        duckDbFunction: 'ST_SimplifyPreserveTopology',
        args: [2.5],
      }),
    ).toContain('ST_SimplifyPreserveTopology("geometry", 2.5)');
  });

  it('builds attribute SQL and quotes output identifiers', () => {
    expect(
      buildAttributeSql({
        tableName: 'input table',
        geometryColumn: 'geom"col',
        duckDbFunction: 'ST_GeometryType',
        outputColumn: 'type"field',
      }),
    ).toContain('ST_GeometryType("geom""col") AS "type""field"');
  });

  it('builds relation filter SQL', () => {
    expect(
      buildRelationFilterSql({
        inputTableName: 'input',
        maskTableName: 'mask',
        inputGeometryColumn: 'geometry',
        maskGeometryColumn: 'geometry',
        duckDbFunction: 'ST_Intersects',
      }),
    ).toContain('ST_Intersects(i."geometry", m."geometry")');
  });

  it('quotes relation table and geometry identifiers', () => {
    const sql = buildRelationFilterSql({
      inputTableName: 'input table',
      maskTableName: 'mask"table',
      inputGeometryColumn: 'input geom',
      maskGeometryColumn: 'mask"geom',
      duckDbFunction: 'ST_Intersects',
    });
    expect(sql).toContain('FROM "input table" AS i');
    expect(sql).toContain('FROM "mask""table" AS m');
    expect(sql).toContain('ST_Intersects(i."input geom", m."mask""geom")');
  });

  it('builds relation attribute SQL with predicate output', () => {
    const sql = buildRelationAttributeSql({
      inputTableName: 'input',
      maskTableName: 'mask',
      inputGeometryColumn: 'geometry',
      maskGeometryColumn: 'geometry',
      duckDbFunction: 'ST_Intersects',
      outputColumn: 'duckdb_intersects',
    });
    expect(sql).toContain('EXISTS (');
    expect(sql).toContain('ST_Intersects(i."geometry", m."geometry")');
    expect(sql).toContain('AS "duckdb_intersects"');
  });

  it.each(ADDITIONAL_RELATION_CASES)('builds filter and attribute SQL for $duckDbFunction', ({
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
    expect(filterSql).toContain(predicate);
    expect(attributeSql).toContain(predicate);
    expect(attributeSql).toContain(`AS "${outputColumn}"`);
  });

  it('builds minimum-distance attribute SQL', () => {
    const sql = buildRelationAttributeSql({
      inputTableName: 'input',
      maskTableName: 'mask',
      inputGeometryColumn: 'geometry',
      maskGeometryColumn: 'geometry',
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance',
      output: 'distance',
    });
    expect(sql).toContain('SELECT MIN(ST_Distance(i."geometry", m."geometry"))');
    expect(sql).toContain('AS "duckdb_distance"');
  });

  it('builds distanceWithin filter and attribute SQL', () => {
    const filterSql = buildRelationFilterSql({
      inputTableName: 'input',
      maskTableName: 'mask',
      inputGeometryColumn: 'geometry',
      maskGeometryColumn: 'geometry',
      duckDbFunction: 'ST_Distance',
      distance: 42,
    });
    const attributeSql = buildRelationAttributeSql({
      inputTableName: 'input',
      maskTableName: 'mask',
      inputGeometryColumn: 'geometry',
      maskGeometryColumn: 'geometry',
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance_within',
      distance: 42,
    });
    expect(filterSql).toContain('ST_Distance(i."geometry", m."geometry") <= 42');
    expect(attributeSql).toContain('ST_Distance(i."geometry", m."geometry") <= 42');
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

  it('rejects unsafe relation function names', () => {
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

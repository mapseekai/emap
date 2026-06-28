import { describe, expect, it } from 'vitest';
import { buildOverlaySql } from './duckdb-sql';

describe('buildOverlaySql', () => {
  it('builds intersection SQL that unions mask geometry once', () => {
    expect(
      buildOverlaySql({
        duckDbFunction: 'ST_Intersection',
        inputGeometryColumn: 'geom',
        inputTableName: 'input table',
        maskGeometryColumn: 'mask geom',
        maskTableName: 'mask table',
      }),
    ).toContain('ST_Union_Agg(m."mask geom") AS mask_geometry');
  });

  it('builds difference SQL with fixed DuckDB Spatial function names', () => {
    const sql = buildOverlaySql({
      duckDbFunction: 'ST_Difference',
      inputGeometryColumn: 'geometry',
      inputTableName: 'input',
      maskGeometryColumn: 'geometry',
      maskTableName: 'mask',
    });

    expect(sql).toContain('ST_Difference(i."geometry", mask_coverage.mask_geometry)');
    expect(sql).toContain('i.* EXCLUDE ("geometry")');
    expect(sql).toContain('NOT ST_IsEmpty(overlay.overlay_geometry)');
  });

  it('rejects unsafe overlay function names', () => {
    expect(() =>
      buildOverlaySql({
        duckDbFunction: 'ST_Intersection); DROP TABLE x; --' as never,
        inputGeometryColumn: 'geometry',
        inputTableName: 'input',
        maskGeometryColumn: 'geometry',
        maskTableName: 'mask',
      }),
    ).toThrow(/Unsafe DuckDB function name/);
  });
});

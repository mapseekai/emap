import { describe, expect, it } from 'vitest';
import { buildOverlaySql } from './duckdb-sql';

describe('buildOverlaySql', () => {
  it('builds intersection SQL that unions mask geometry once', () => {
    const sql = buildOverlaySql({
      duckDbFunction: 'ST_Intersection',
      inputGeometryColumn: 'geom',
      inputTableName: 'input table',
      maskGeometryColumn: 'mask geom',
      maskTableName: 'mask table',
    });

    expect(sql).toContain('ST_Union_Agg(m."mask geom") AS mask_geometry');
    expect(sql).toContain('FROM "mask table" AS m');
    expect(sql).toContain('FROM "input table" AS i');
    expect(sql).toContain('ST_Intersection(i."geom", mask_coverage.mask_geometry)');
    expect(sql).toContain('WHERE i."geom" IS NOT NULL');
    expect(sql).toContain('AND mask_coverage.mask_geometry IS NOT NULL');
    expect(sql).toContain('overlay_geometry IS NOT NULL');
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
    expect(sql).toContain('AND TRUE');
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

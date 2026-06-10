import { describe, expect, it } from 'vitest';
import { buildGeoMetadata, crsStringToProjjson, projjsonToCrsString } from './geoparquet-metadata';

describe('GeoParquet CRS metadata semantics', () => {
  it('treats missing crs as the GeoParquet default outside projjsonToCrsString', () => {
    const geo = JSON.parse(
      buildGeoMetadata({
        columnName: 'geometry',
        encoding: 'WKB',
        geometryTypes: ['Point'],
        crs: undefined,
      }),
    );

    expect(geo.columns.geometry).not.toHaveProperty('crs');
  });

  it('treats crs:null as unknown, not EPSG:4326', () => {
    const geo = JSON.parse(
      buildGeoMetadata({
        columnName: 'geometry',
        encoding: 'WKB',
        geometryTypes: ['Point'],
        crs: null,
      }),
    );

    expect(geo.columns.geometry.crs).toBeNull();
    expect(projjsonToCrsString(null)).toBeNull();
  });

  it('resolves EPSG codes to full PROJJSON', () => {
    const crs = crsStringToProjjson('EPSG:3857') as Record<string, unknown>;

    expect(crs).toMatchObject({
      type: 'ProjectedCRS',
      name: 'WGS 84 / Pseudo-Mercator',
      id: { authority: 'EPSG', code: 3857 },
    });
    expect(crs).toHaveProperty('base_crs');
    expect(crs).toHaveProperty('coordinate_system');
    expect(projjsonToCrsString(crs)).toBe('EPSG:3857');
  });
});

import { describe, expect, it } from 'vitest';
import { buildGeoMetadata, projjsonToCrsString } from './geoparquet-metadata';

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
});

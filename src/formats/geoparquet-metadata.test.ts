import { describe, expect, it } from 'vitest';
import { findAuthorityProjjson } from './epsg-projjson';
import {
  buildGeoMetadata,
  crsStringToProjjson,
  crsStringToProjjsonAsync,
  GeoParquetCrsError,
  projjsonToCrsString,
} from './geoparquet-metadata';

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

  it('treats crs:null as the GeoParquet default CRS on import', () => {
    const geo = JSON.parse(
      buildGeoMetadata({
        columnName: 'geometry',
        encoding: 'WKB',
        geometryTypes: ['Point'],
        crs: null,
      }),
    );

    expect(geo.columns.geometry.crs).toBeNull();
    expect(projjsonToCrsString(null)).toBe('EPSG:4326');
  });

  it('resolves EPSG codes to full PROJJSON', () => {
    const crs = crsStringToProjjson('EPSG:4490', findAuthorityProjjson) as Record<string, unknown>;

    expect(crs).toMatchObject({
      type: 'GeographicCRS',
      name: 'China Geodetic Coordinate System 2000',
      id: { authority: 'EPSG', code: 4490 },
    });
    expect(crs).toHaveProperty('coordinate_system');
    expect(projjsonToCrsString(crs)).toBe('EPSG:4490');
  });

  it('rejects known EPSG CRS when strict PROJJSON resolution fails', async () => {
    await expect(
      crsStringToProjjsonAsync('EPSG:4490', async () => undefined, { strict: true }),
    ).rejects.toThrow('GeoParquet export requires PROJJSON for EPSG:4490');
  });

  it('rejects known EPSG CRS in sync strict mode when PROJJSON resolution fails', () => {
    expect(() => crsStringToProjjson('EPSG:4490', () => undefined, { strict: true })).toThrow(
      GeoParquetCrsError,
    );
  });

  it('rejects custom CRS labels in strict GeoParquet export mode', async () => {
    await expect(
      crsStringToProjjsonAsync('+proj=utm +zone=10', undefined, { strict: true }),
    ).rejects.toThrow("GeoParquet export cannot express CRS '+proj=utm +zone=10' as PROJJSON");
  });

  it('rejects custom CRS labels in sync strict GeoParquet export mode', () => {
    expect(() => crsStringToProjjson('+proj=utm +zone=10', undefined, { strict: true })).toThrow(
      GeoParquetCrsError,
    );
  });

  it('keeps permissive Arrow metadata behavior for custom CRS labels', () => {
    expect(crsStringToProjjson('+proj=utm +zone=10')).toBeNull();
  });

  it('keeps async permissive Arrow metadata behavior for custom CRS labels', async () => {
    await expect(crsStringToProjjsonAsync('+proj=utm +zone=10')).resolves.toBeNull();
  });

  it('omits CRS for GeoParquet default WGS84 lon/lat data', () => {
    expect(crsStringToProjjson('EPSG:4326', findAuthorityProjjson)).toBeUndefined();
    expect(crsStringToProjjson('OGC:CRS84', findAuthorityProjjson)).toBeUndefined();
  });
});

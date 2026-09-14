import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CRS,
  EpsgProjectionError,
  inferFromPrj,
  isGeographicCrs,
  isGeographicCrsString,
  normalizeCrsString,
  normalizeProjectCrs,
  normalizeProjectCrsMetadata,
  resolveDatasetCRS,
  resolveDatasetCRSMetadata,
  resolveProjectCrs,
} from './crs-resolver';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';

function ds(info: MapshaperDataset['info']): MapshaperDataset {
  return { layers: [], info };
}

describe('normalizeCrsString', () => {
  it.each([
    ['wgs84', 'EPSG:4326'],
    ['WGS84', 'EPSG:4326'],
    ['epsg:4326', 'EPSG:4326'],
    ['EPSG:4326', 'EPSG:4326'],
    ['webmercator', 'EPSG:3857'],
    ['epsg:3857', 'EPSG:3857'],
    ['epsg:32633', 'EPSG:32633'],
    ['EPSG:4490', 'EPSG:4490'],
    // Unknown labels pass through unchanged so case-sensitive proj4 tokens
    // (e.g. `+proj=utm +zone=10`) survive intact.
    ['weird', 'weird'],
    ['+proj=utm +zone=10', '+proj=utm +zone=10'],
  ])('%p → %p', (input, expected) => {
    expect(normalizeCrsString(input)).toBe(expected);
  });
});

describe('normalizeProjectCrs', () => {
  it.each([
    ['EPSG:3857', 'webmercator'],
    ['epsg:900913', 'webmercator'],
    ['EPSG:102100', 'webmercator'],
    ['EPSG:4326', 'wgs84'],
    ['+proj=utm +zone=10', '+proj=utm +zone=10'],
  ])('%p -> %p', (input, expected) => {
    expect(normalizeProjectCrs(input)).toBe(expected);
  });
});

describe('normalizeProjectCrsMetadata', () => {
  it.each([
    ['EPSG:4326', 'EPSG:4326'],
    ['epsg:3857', 'EPSG:3857'],
    ['32633', 'EPSG:32633'],
    ['urn:ogc:def:crs:EPSG::4490', 'EPSG:4490'],
    ['wgs84', 'EPSG:4326'],
    ['OGC:CRS84', 'EPSG:4326'],
    ['webmercator', 'EPSG:3857'],
    ['+proj=utm +zone=10', '+proj=utm +zone=10'],
  ])('%p -> %p', (input, expected) => {
    expect(normalizeProjectCrsMetadata(input)).toBe(expected);
  });
});

describe('resolveProjectCrs', () => {
  beforeAll(async () => {
    await resolveProjectCrs('EPSG:4490');
  }, 15000);

  it.each([
    ['EPSG:4326', 'wgs84'],
    ['epsg:3857', 'webmercator'],
    ['EPSG:900913', 'webmercator'],
    ['EPSG:102100', 'webmercator'],
  ])('%p -> %p', async (input, expected) => {
    await expect(resolveProjectCrs(input)).resolves.toBe(expected);
  });

  it('resolves EPSG:4490 to a Proj.4 longlat definition', async () => {
    const crs = await resolveProjectCrs('EPSG:4490');

    expect(crs).toContain('+proj=longlat');
    expect(crs).toContain('+ellps=GRS80');
  });

  it('resolves EPSG:32633 to a Proj.4 UTM definition', async () => {
    const crs = await resolveProjectCrs('32633');

    expect(crs).toContain('+proj=utm');
    expect(crs).toContain('+zone=33');
    expect(crs).not.toContain('+south');
  });

  it.each([
    '+proj=utm +zone=10',
    'robinson',
    'natearth',
  ])('passes through %p unchanged', async (input) => {
    await expect(resolveProjectCrs(input)).resolves.toBe(input);
  });

  it('rejects unsupported EPSG codes', async () => {
    await expect(resolveProjectCrs('EPSG:999999999')).rejects.toThrow(
      'Unsupported EPSG code: EPSG:999999999',
    );
    await expect(resolveProjectCrs('EPSG:999999999')).rejects.toMatchObject({
      code: 'EPSG:999999999',
    });
    await expect(resolveProjectCrs('EPSG:999999999')).rejects.toBeInstanceOf(EpsgProjectionError);
  });

  it('rejects EPSG records that do not include Proj.4 definitions', async () => {
    await expect(resolveProjectCrs('EPSG:2000')).rejects.toThrow(
      'EPSG:2000 does not include a Proj.4 definition',
    );
    await expect(resolveProjectCrs('EPSG:2000')).rejects.toMatchObject({
      code: 'EPSG:2000',
    });
    await expect(resolveProjectCrs('EPSG:2000')).rejects.toBeInstanceOf(EpsgProjectionError);
  });
});

describe('inferFromPrj — ESRI Web Mercator variants', () => {
  it('detects ESRI "WGS 1984 Web Mercator (auxiliary sphere)"', () => {
    expect(inferFromPrj('PROJCS["WGS 1984 Web Mercator (auxiliary sphere)"]')).toBe('EPSG:3857');
  });
  it('detects "Web Mercator" with a space', () => {
    expect(inferFromPrj('PROJCS["Web Mercator"]')).toBe('EPSG:3857');
  });
});

describe('inferFromPrj', () => {
  it('extracts EPSG code from AUTHORITY clause', () => {
    expect(inferFromPrj('PROJCS["NAD83",AUTHORITY["EPSG","26910"]]')).toBe('EPSG:26910');
  });

  it('case-insensitive AUTHORITY match', () => {
    expect(inferFromPrj('GEOGCS["foo", authority["epsg" , "4326"]]')).toBe('EPSG:4326');
  });

  it('detects Web Mercator from name fragments', () => {
    expect(inferFromPrj('PROJCS["WGS 84 / Pseudo-Mercator"]')).toBe('EPSG:3857');
    expect(inferFromPrj('Web_Mercator')).toBe('EPSG:3857');
  });

  it('detects WGS84 from DATUM + GEOGCS', () => {
    expect(inferFromPrj('GEOGCS["WGS",DATUM["WGS_1984"]]')).toBe('EPSG:4326');
  });

  it('detects ESRI D_WGS_1984 WKT1 as WGS84', () => {
    expect(
      inferFromPrj(
        'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
      ),
    ).toBe('EPSG:4326');
  });

  it('returns null when nothing matches', () => {
    expect(inferFromPrj('PROJCS["Custom Projection"]')).toBeNull();
    expect(inferFromPrj('')).toBeNull();
  });
});

describe('isGeographicCrsString', () => {
  it.each([
    'EPSG:4326',
    'epsg:4269',
    'urn:ogc:def:crs:EPSG::4326',
    'urn:ogc:def:crs:EPSG:6.6:4269',
    'http://www.opengis.net/def/crs/EPSG/0/4326',
    'OGC:CRS84',
    'wgs84',
    '+proj=longlat +datum=WGS84 +no_defs',
    'GEOGCS["WGS 84",DATUM["WGS_1984"]]',
    'GEODCRS["WGS 84"]',
  ])('detects geographic CRS %p', (input) => {
    expect(isGeographicCrsString(input)).toBe(true);
  });

  it.each([
    'EPSG:3857',
    'EPSG:32633',
    'webmercator',
    '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs',
    'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84"],AUTHORITY["EPSG","3857"]]',
    'PROJCRS["WGS 84 / UTM zone 33N"]',
  ])('does not mark projected CRS %p as geographic', (input) => {
    expect(isGeographicCrsString(input)).toBe(false);
  });
});

describe('isGeographicCrs', () => {
  it('checks dataset CRS metadata from all supported sources', () => {
    expect(isGeographicCrs(ds({ crs_string: 'EPSG:4269' }))).toBe(true);
    expect(isGeographicCrs(ds({ prj: 'GEOGCS["WGS 84",DATUM["WGS_1984"]]' }))).toBe(true);
    expect(isGeographicCrs(ds({ wkt1: 'urn:ogc:def:crs:EPSG::4326' }))).toBe(true);
    expect(isGeographicCrs(ds({ crs: { is_latlong: true } }))).toBe(true);
  });

  it('does not treat missing or projected metadata as geographic', () => {
    expect(isGeographicCrs(undefined)).toBe(false);
    expect(isGeographicCrs(ds({}))).toBe(false);
    expect(isGeographicCrs(ds({ crs_string: 'EPSG:3857' }))).toBe(false);
    expect(isGeographicCrs(ds({ prj: 'PROJCS["x",AUTHORITY["EPSG","3857"]]' }))).toBe(false);
  });
});

describe('resolveDatasetCRS', () => {
  it('falls back to EPSG:4326 with no dataset / info', () => {
    expect(resolveDatasetCRS(undefined)).toBe(DEFAULT_CRS);
    expect(resolveDatasetCRS({ layers: [] })).toBe(DEFAULT_CRS);
    expect(resolveDatasetCRS(ds({}))).toBe(DEFAULT_CRS);
  });

  it('prefers crs_string when set', () => {
    expect(resolveDatasetCRS(ds({ crs_string: 'epsg:3857' }))).toBe('EPSG:3857');
  });

  it('falls through to prj when crs_string is missing', () => {
    expect(
      resolveDatasetCRS(
        ds({
          prj: 'PROJCS["x",AUTHORITY["EPSG","4490"]]',
        }),
      ),
    ).toBe('EPSG:4490');
  });

  it('falls through to wkt1 when crs_string and prj are missing', () => {
    expect(
      resolveDatasetCRS(
        ds({
          wkt1: 'PROJCS["x",AUTHORITY["EPSG","3857"]]',
        }),
      ),
    ).toBe('EPSG:3857');
  });

  it('falls through to crs object when prj is missing', () => {
    expect(
      resolveDatasetCRS(
        ds({
          crs: { is_latlong: true },
        }),
      ),
    ).toBe('EPSG:4326');
    expect(
      resolveDatasetCRS(
        ds({
          crs: { projName: 'merc', a: 6378137 },
        }),
      ),
    ).toBe('EPSG:3857');
  });

  it('precedence: crs_string > prj > crs > default', () => {
    // crs_string wins over a contradictory prj.
    expect(
      resolveDatasetCRS(
        ds({
          crs_string: 'epsg:3857',
          prj: 'AUTHORITY["EPSG","4326"]',
        }),
      ),
    ).toBe('EPSG:3857');
    // prj wins over a contradictory crs.
    expect(
      resolveDatasetCRS(
        ds({
          prj: 'AUTHORITY["EPSG","32633"]',
          crs: { is_latlong: true },
        }),
      ),
    ).toBe('EPSG:32633');
  });
});

describe('resolveDatasetCRSMetadata', () => {
  it('does not invent a default CRS for export metadata', () => {
    expect(resolveDatasetCRSMetadata(undefined)).toBeUndefined();
    expect(resolveDatasetCRSMetadata({ layers: [] })).toBeUndefined();
    expect(resolveDatasetCRSMetadata(ds({}))).toBeUndefined();
  });

  it('returns explicit CRS metadata when present', () => {
    expect(resolveDatasetCRSMetadata(ds({ crs_string: 'epsg:4326' }))).toBe('EPSG:4326');
    expect(resolveDatasetCRSMetadata(ds({ prj: 'PROJCS["x",AUTHORITY["EPSG","3857"]]' }))).toBe(
      'EPSG:3857',
    );
    expect(resolveDatasetCRSMetadata(ds({ crs: { is_latlong: true } }))).toBe('EPSG:4326');
  });
});

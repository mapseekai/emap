import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CRS,
  inferFromPrj,
  normalizeCrsString,
  normalizeProjectCrs,
  resolveDatasetCRS,
} from './crs-resolver';
import type { MapshaperDataset } from '../types/mapshaper-types';

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

describe('inferFromPrj — ESRI Web Mercator variants', () => {
  it('detects ESRI "WGS 1984 Web Mercator (auxiliary sphere)"', () => {
    expect(
      inferFromPrj('PROJCS["WGS 1984 Web Mercator (auxiliary sphere)"]'),
    ).toBe('EPSG:3857');
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

  it('returns null when nothing matches', () => {
    expect(inferFromPrj('PROJCS["Custom Projection"]')).toBeNull();
    expect(inferFromPrj('')).toBeNull();
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
    expect(resolveDatasetCRS(ds({
      prj: 'PROJCS["x",AUTHORITY["EPSG","4490"]]',
    }))).toBe('EPSG:4490');
  });

  it('falls through to crs object when prj is missing', () => {
    expect(resolveDatasetCRS(ds({
      crs: { is_latlong: true },
    }))).toBe('EPSG:4326');
    expect(resolveDatasetCRS(ds({
      crs: { projName: 'merc', a: 6378137 },
    }))).toBe('EPSG:3857');
  });

  it('precedence: crs_string > prj > crs > default', () => {
    // crs_string wins over a contradictory prj.
    expect(resolveDatasetCRS(ds({
      crs_string: 'epsg:3857',
      prj: 'AUTHORITY["EPSG","4326"]',
    }))).toBe('EPSG:3857');
    // prj wins over a contradictory crs.
    expect(resolveDatasetCRS(ds({
      prj: 'AUTHORITY["EPSG","32633"]',
      crs: { is_latlong: true },
    }))).toBe('EPSG:32633');
  });
});

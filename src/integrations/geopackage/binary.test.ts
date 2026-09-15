import { describe, expect, it } from 'vitest';
import { readGeoPackageGeometry } from './binary';
import { collection, count, gpkg, line, polygon, wkb } from '../../../test/utils/geopackage';

const square = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
  [0, 0],
];
describe('GeoPackage binary and WKB reader', () => {
  it('honors independent header/WKB endianness and every envelope size', () => {
    for (const headerLittle of [true, false])
      for (const little of [true, false])
        for (const envelope of [0, 1, 2, 3, 4]) {
          const points: number[][] = [];
          const bytes = gpkg(
            wkb(1, [12.3456789012345, -3.2], little),
            4326,
            envelope,
            headerLittle,
          );
          expect(
            readGeoPackageGeometry(bytes, 4326, 32, {
              point: (x, y) => {
                points.push([x, y]);
              },
              startPath() {},
              coordinate() {},
              endPath() {},
            }),
          ).toMatchObject({ points: 1, families: 1 });
          expect(points).toEqual([[12.3456789012345, -3.2]]);
        }
  });
  it('reads ISO XYZ, XYM and XYZM without interpreting extra ordinates as XY', () => {
    for (const dimension of [1, 2, 3]) {
      const coords = dimension === 3 ? [1, 2, 9, 10] : [1, 2, 9];
      expect(
        readGeoPackageGeometry(gpkg(wkb(1 + dimension * 1000, coords)), 4326, 32),
      ).toMatchObject({ points: 1, hasZ: dimension !== 2, hasM: dimension !== 1 });
      expect(
        readGeoPackageGeometry(
          gpkg(line([coords, coords.map((v, i) => (i < 2 ? v + 1 : v))], false, dimension)),
          4326,
          32,
        ),
      ).toMatchObject({ vertices: 2, paths: 1 });
    }
  });
  it('handles multi-geometries, holes, mixed nested collections, null-sized shapes', () => {
    const bytes = gpkg(
      collection(7, [
        collection(4, [wkb(1, [1, 2]), wkb(1, [3, 4])]),
        line([
          [0, 0],
          [1, 1],
        ]),
        polygon([square, square]),
        collection(7, []),
      ]),
    );
    expect(readGeoPackageGeometry(bytes, 4326, 32)).toMatchObject({
      points: 2,
      paths: 3,
      vertices: 12,
      families: 7,
    });
    expect(
      readGeoPackageGeometry(gpkg(wkb(1, [NaN, NaN]), 4326, 0, true, true), 4326, 32).points,
    ).toBe(0);
    expect(readGeoPackageGeometry(gpkg(polygon([]), 4326, 0, true, true), 4326, 32).vertices).toBe(
      0,
    );
  });
  it('honors subarray byteOffset rather than reading unrelated prefix bytes', () => {
    const content = gpkg(wkb(1, [10, 20]));
    const padded = new Uint8Array(content.length + 20);
    padded.set(content, 9);
    expect(readGeoPackageGeometry(padded.subarray(9, 9 + content.length), 4326, 32).points).toBe(1);
  });
  it('rejects truncation, invalid magic/envelope, extension flags, wrong SRS and trailing bytes', () => {
    const content = gpkg(
      line([
        [0, 0],
        [1, 1],
      ]),
    );
    for (let size = 0; size < content.length; size++)
      expect(() => readGeoPackageGeometry(content.subarray(0, size), 4326, 32)).toThrow();
    for (const [index, value] of [
      [0, 0],
      [2, 1],
      [3, 0x41],
      [3, 0x21],
      [3, 11],
    ]) {
      const bad = content.slice();
      bad[index] = value;
      expect(() => readGeoPackageGeometry(bad, 4326, 32)).toThrow();
    }
    expect(() => readGeoPackageGeometry(content, 3857, 32)).toThrow('SRS');
    const trailing = new Uint8Array(content.length + 1);
    trailing.set(content);
    expect(() => readGeoPackageGeometry(trailing, 4326, 32)).toThrow('trailing');
  });
  it('rejects unsupported curves, invalid multi children, coordinate counts and unclosed rings', () => {
    expect(() => readGeoPackageGeometry(gpkg(wkb(8, [])), 4326, 32)).toThrow('unsupported');
    expect(() =>
      readGeoPackageGeometry(
        gpkg(
          collection(4, [
            line([
              [0, 0],
              [1, 1],
            ]),
          ]),
        ),
        4326,
        32,
      ),
    ).toThrow('child');
    expect(() => readGeoPackageGeometry(gpkg(wkb(2, [count(0xffffffff)])), 4326, 32)).toThrow(
      'truncated',
    );
    expect(() =>
      readGeoPackageGeometry(
        gpkg(
          polygon([
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [2, 2],
            ],
          ]),
        ),
        4326,
        32,
      ),
    ).toThrow('closed');
    expect(() => readGeoPackageGeometry(gpkg(wkb(1, [Infinity, 0])), 4326, 32)).toThrow(
      'non-finite',
    );
    expect(() =>
      readGeoPackageGeometry(gpkg(wkb(1, [1, 2]), 4326, 0, true, true), 4326, 32),
    ).toThrow('empty');
  });
  it('bounds nesting and validates EWKB embedded SRID', () => {
    let nested = wkb(1, [1, 2]);
    for (let i = 0; i < 6; i++) nested = collection(7, [nested]);
    expect(() => readGeoPackageGeometry(gpkg(nested), 4326, 3)).toThrow('nesting');
    const body = wkb(0xa0000001, [count(3857), new Uint8Array(new Float64Array([1, 2, 3]).buffer)]);
    expect(() => readGeoPackageGeometry(gpkg(body), 4326, 32)).toThrow('SRID');
  });
});

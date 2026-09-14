import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { decodeWkb, resetWkbWarnings, WkbWriter } from './wkb';

/** Hand-build a little-endian WKB Point for byte-level comparisons. */
function wkbPointLE(x: number, y: number): Uint8Array {
  const buf = new Uint8Array(21);
  const view = new DataView(buf.buffer);
  view.setUint8(0, 1);
  view.setUint32(1, 1, true);
  view.setFloat64(5, x, true);
  view.setFloat64(13, y, true);
  return buf;
}

/** Same point in big-endian form. */
function wkbPointBE(x: number, y: number): Uint8Array {
  const buf = new Uint8Array(21);
  const view = new DataView(buf.buffer);
  view.setUint8(0, 0);
  view.setUint32(1, 1, false);
  view.setFloat64(5, x, false);
  view.setFloat64(13, y, false);
  return buf;
}

describe('decodeWkb', () => {
  beforeEach(() => resetWkbWarnings());
  afterEach(() => vi.restoreAllMocks());

  it('decodes a little-endian point', () => {
    expect(decodeWkb(wkbPointLE(12.5, -3.25))).toEqual({
      type: 'point',
      points: [[12.5, -3.25]],
    });
  });

  it('decodes a big-endian point', () => {
    expect(decodeWkb(wkbPointBE(7, 8))).toEqual({
      type: 'point',
      points: [[7, 8]],
    });
  });

  it('returns null for empty input (null geometry)', () => {
    expect(decodeWkb(new Uint8Array(0))).toBeNull();
  });

  it('round-trips a linestring through WkbWriter', () => {
    const xs = Float64Array.from([0, 1, 2]);
    const ys = Float64Array.from([0, 1, 0]);
    const w = new WkbWriter();
    w.writeLineString(xs, ys, 0, 3);
    w.endRow();
    const { bytes, valueOffsets } = w.finish();
    expect(Array.from(valueOffsets)).toEqual([0, bytes.length]);
    expect(decodeWkb(bytes)).toEqual({
      type: 'polyline',
      paths: [
        [
          [0, 0],
          [1, 1],
          [2, 0],
        ],
      ],
    });
  });

  it('round-trips a multilinestring', () => {
    const xs = Float64Array.from([0, 1, 5, 6, 7]);
    const ys = Float64Array.from([0, 0, 5, 5, 5]);
    const w = new WkbWriter();
    w.writeMultiLineString(xs, ys, [
      [0, 2],
      [2, 5],
    ]);
    w.endRow();
    const geom = decodeWkb(w.finish().bytes);
    expect(geom).toEqual({
      type: 'polyline',
      paths: [
        [
          [0, 0],
          [1, 0],
        ],
        [
          [5, 5],
          [6, 5],
          [7, 5],
        ],
      ],
    });
  });

  it('round-trips a multipoint', () => {
    const w = new WkbWriter();
    w.writeMultiPoint([
      [1, 2],
      [3, 4],
    ]);
    w.endRow();
    expect(decodeWkb(w.finish().bytes)).toEqual({
      type: 'point',
      points: [
        [1, 2],
        [3, 4],
      ],
    });
  });

  it('round-trips a polygon with a hole (single polygon → WKB Polygon)', () => {
    // shell CW-ish square 0..10, hole 2..4
    const xs = Float64Array.from([0, 0, 10, 10, 0, 2, 4, 4, 2, 2]);
    const ys = Float64Array.from([0, 10, 10, 0, 0, 2, 2, 4, 4, 2]);
    const w = new WkbWriter();
    w.writePolygons(xs, ys, [
      [
        [0, 5],
        [5, 10],
      ],
    ]);
    w.endRow();
    const geom = decodeWkb(w.finish().bytes);
    expect(geom?.type).toBe('polygon');
    if (geom?.type !== 'polygon') return;
    expect(geom.rings).toHaveLength(2);
    expect(geom.ringIsHole).toEqual([false, true]);
    expect(geom.rings[0]).toHaveLength(5);
    expect(geom.rings[1][0]).toEqual([2, 2]);
  });

  it('round-trips a multipolygon preserving per-polygon ring roles', () => {
    // two squares; second has a hole
    const xs = Float64Array.from([0, 0, 1, 1, 0, 5, 5, 9, 9, 5, 6, 8, 8, 6, 6]);
    const ys = Float64Array.from([0, 1, 1, 0, 0, 5, 9, 9, 5, 5, 6, 6, 8, 8, 6]);
    const w = new WkbWriter();
    w.writePolygons(xs, ys, [
      [[0, 5]],
      [
        [5, 10],
        [10, 15],
      ],
    ]);
    w.endRow();
    const geom = decodeWkb(w.finish().bytes);
    expect(geom?.type).toBe('polygon');
    if (geom?.type !== 'polygon') return;
    expect(geom.rings).toHaveLength(3);
    expect(geom.ringIsHole).toEqual([false, false, true]);
  });

  it('produces one offset per row across multiple rows', () => {
    const w = new WkbWriter();
    w.writePoint(1, 1);
    w.endRow();
    w.endRow(); // empty (null) row
    w.writePoint(2, 2);
    w.endRow();
    const { bytes, valueOffsets } = w.finish();
    expect(Array.from(valueOffsets)).toEqual([0, 21, 21, 42]);
    expect(decodeWkb(bytes.subarray(21, 21))).toBeNull();
    expect(decodeWkb(bytes.subarray(21, 42))).toEqual({
      type: 'point',
      points: [[2, 2]],
    });
  });

  it('drops Z from ISO-style 1000-offset geometries with a single warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const buf = new Uint8Array(29);
    const view = new DataView(buf.buffer);
    view.setUint8(0, 1);
    view.setUint32(1, 1001, true); // PointZ
    view.setFloat64(5, 1, true);
    view.setFloat64(13, 2, true);
    view.setFloat64(21, 99, true); // z
    expect(decodeWkb(buf)).toEqual({ type: 'point', points: [[1, 2]] });
    expect(decodeWkb(buf)).toEqual({ type: 'point', points: [[1, 2]] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops Z from EWKB-flagged geometries', () => {
    const buf = new Uint8Array(29);
    const view = new DataView(buf.buffer);
    view.setUint8(0, 1);
    view.setUint32(1, 0x80000001, true); // EWKB PointZ
    view.setFloat64(5, 3, true);
    view.setFloat64(13, 4, true);
    view.setFloat64(21, 99, true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeWkb(buf)).toEqual({ type: 'point', points: [[3, 4]] });
  });

  it('skips the EWKB SRID field', () => {
    const buf = new Uint8Array(25);
    const view = new DataView(buf.buffer);
    view.setUint8(0, 1);
    view.setUint32(1, 0x20000001, true); // EWKB Point with SRID
    view.setUint32(5, 4326, true);
    view.setFloat64(9, 5, true);
    view.setFloat64(17, 6, true);
    expect(decodeWkb(buf)).toEqual({ type: 'point', points: [[5, 6]] });
  });

  it('rejects M coordinates and bad byte-order markers', () => {
    const m = new Uint8Array(21);
    const mv = new DataView(m.buffer);
    mv.setUint8(0, 1);
    mv.setUint32(1, 2001, true); // PointM
    expect(() => decodeWkb(m)).toThrow(/M coordinates/);

    const bad = wkbPointLE(0, 0);
    bad[0] = 7;
    expect(() => decodeWkb(bad)).toThrow(/byte order/);
  });

  it('writer output matches hand-computed point bytes', () => {
    const w = new WkbWriter();
    w.writePoint(12.5, -3.25);
    w.endRow();
    expect(Array.from(w.finish().bytes)).toEqual(Array.from(wkbPointLE(12.5, -3.25)));
  });
});

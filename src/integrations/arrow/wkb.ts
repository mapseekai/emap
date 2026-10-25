/**
 * Minimal 2D WKB (Well-Known Binary, ISO/OGC Simple Features) codec for the
 * Arrow module's GeoParquet / GeoArrow support.
 *
 * Scope: geometry types 1–6 (Point, LineString, Polygon, MultiPoint,
 * MultiLineString, MultiPolygon), both byte orders on read, little-endian
 * on write. Z coordinates (ISO 1000-offset and EWKB flag forms) are read
 * and dropped with a one-time warning; M coordinates are rejected.
 */

/**
 * Decoded WKB grouped by mapshaper geometry class. Multi* variants flatten
 * into the same structure as their singular form (mapshaper shapes are
 * multi-part natively). Polygon ring roles are positional in WKB — the
 * first ring of each polygon is the shell, the rest are holes — captured
 * here per ring in `ringIsHole`.
 */
export type WkbGeometry =
  | { type: 'point'; points: Array<[number, number]> }
  | { type: 'polyline'; paths: Array<Array<[number, number]>> }
  | {
      type: 'polygon';
      rings: Array<Array<[number, number]>>;
      ringIsHole: boolean[];
    };

const EWKB_Z_FLAG = 0x80000000;
const EWKB_M_FLAG = 0x40000000;
const EWKB_SRID_FLAG = 0x20000000;

let warnedZ = false;

/** Test seam: reset the one-time Z warning. */
export function resetWkbWarnings(): void {
  warnedZ = false;
}

class WkbReader {
  private _view: DataView;
  private _pos = 0;
  sawZ = false;
  sawSrid = false;
  sawSingletonMulti = false;

  constructor(bytes: Uint8Array) {
    this._view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Parse one geometry record (advances past it, recursing into Multi*). */
  readGeometry(): WkbGeometry {
    const littleEndian = this._readByteOrder();
    const typeWord = this._u32(littleEndian);
    const { geomType, dims } = this._parseTypeWord(typeWord);

    switch (geomType) {
      case 1:
        return { type: 'point', points: [this._coord(littleEndian, dims)] };
      case 2:
        return {
          type: 'polyline',
          paths: [this._coordSeq(littleEndian, dims)],
        };
      case 3: {
        const rings = this._rings(littleEndian, dims);
        return {
          type: 'polygon',
          rings,
          ringIsHole: rings.map((_, i) => i > 0),
        };
      }
      case 4: {
        const n = this._u32(littleEndian);
        if (n === 1) this.sawSingletonMulti = true;
        const points: Array<[number, number]> = [];
        for (let i = 0; i < n; i++) {
          const child = this.readGeometry();
          if (child.type !== 'point') throw new Error('Malformed WKB MultiPoint');
          points.push(...child.points);
        }
        return { type: 'point', points };
      }
      case 5: {
        const n = this._u32(littleEndian);
        if (n === 1) this.sawSingletonMulti = true;
        const paths: Array<Array<[number, number]>> = [];
        for (let i = 0; i < n; i++) {
          const child = this.readGeometry();
          if (child.type !== 'polyline') throw new Error('Malformed WKB MultiLineString');
          paths.push(...child.paths);
        }
        return { type: 'polyline', paths };
      }
      case 6: {
        const n = this._u32(littleEndian);
        if (n === 1) this.sawSingletonMulti = true;
        const rings: Array<Array<[number, number]>> = [];
        const ringIsHole: boolean[] = [];
        for (let i = 0; i < n; i++) {
          const child = this.readGeometry();
          if (child.type !== 'polygon') throw new Error('Malformed WKB MultiPolygon');
          rings.push(...child.rings);
          ringIsHole.push(...child.ringIsHole);
        }
        return { type: 'polygon', rings, ringIsHole };
      }
      default:
        throw new Error(`Unsupported WKB geometry type: ${geomType}`);
    }
  }

  private _parseTypeWord(typeWord: number): { geomType: number; dims: number } {
    let t = typeWord;
    let hasZ = false;
    if (t & EWKB_SRID_FLAG) {
      // Skip embedded SRID (EWKB); CRS comes from file metadata instead.
      this.sawSrid = true;
      this._pos += 4;
      t &= ~EWKB_SRID_FLAG;
    }
    if (t & EWKB_Z_FLAG) {
      hasZ = true;
      t &= ~EWKB_Z_FLAG;
    }
    // EWKB M flag, or ISO offsets 2000 (M) / 3000 (ZM)
    if (t & EWKB_M_FLAG || t >= 2000) {
      throw new Error('WKB geometries with M coordinates are not supported');
    }
    if (t >= 1000) {
      hasZ = true;
      t -= 1000;
    }
    if (hasZ) this.sawZ = true;
    return { geomType: t, dims: hasZ ? 3 : 2 };
  }

  private _readByteOrder(): boolean {
    const byte = this._view.getUint8(this._pos);
    this._pos += 1;
    if (byte !== 0 && byte !== 1) {
      throw new Error(`Invalid WKB byte order marker: ${byte}`);
    }
    return byte === 1;
  }

  private _u32(littleEndian: boolean): number {
    const v = this._view.getUint32(this._pos, littleEndian);
    this._pos += 4;
    return v;
  }

  private _coord(littleEndian: boolean, dims: number): [number, number] {
    const x = this._view.getFloat64(this._pos, littleEndian);
    const y = this._view.getFloat64(this._pos + 8, littleEndian);
    this._pos += 8 * dims; // skips Z when present
    return [x, y];
  }

  private _coordSeq(littleEndian: boolean, dims: number): Array<[number, number]> {
    const n = this._u32(littleEndian);
    const out: Array<[number, number]> = new Array<[number, number]>(n);
    for (let i = 0; i < n; i++) {
      out[i] = this._coord(littleEndian, dims);
    }
    return out;
  }

  private _rings(littleEndian: boolean, dims: number): Array<Array<[number, number]>> {
    const n = this._u32(littleEndian);
    const rings: Array<Array<[number, number]>> = new Array<[number, number][]>(n);
    for (let i = 0; i < n; i++) {
      rings[i] = this._coordSeq(littleEndian, dims);
    }
    return rings;
  }
}

/** Decode one WKB buffer; returns null for empty input (null geometry). */
export function decodeWkb(bytes: Uint8Array): WkbGeometry | null {
  if (bytes.length === 0) return null;
  return decodeWkbForImport(bytes).geometry;
}

/** Dropped dimensions or embedded CRS must not seed the original representation. */
export function decodeWkbForImport(bytes: Uint8Array): {
  geometry: WkbGeometry;
  hasZ: boolean;
  hasSrid: boolean;
  hasSingletonMulti: boolean;
} {
  const reader = new WkbReader(bytes);
  const geometry = reader.readGeometry();
  if (reader.sawZ && !warnedZ) {
    warnedZ = true;
    console.warn('emap formats: WKB Z coordinates are not supported; Z values were dropped');
  }
  return {
    geometry,
    hasZ: reader.sawZ,
    hasSrid: reader.sawSrid,
    hasSingletonMulti: reader.sawSingletonMulti,
  };
}

/**
 * Streaming little-endian 2D WKB writer producing the exact buffer pair an
 * Arrow Binary `makeData` consumes: one concatenated `bytes` array plus
 * per-row `valueOffsets` (length = rowCount + 1).
 *
 * Coordinates come from shared `xs`/`ys` arrays addressed by [start, end)
 * runs — the coord-run model the export pipeline accumulates — so no
 * per-vertex array allocation happens on the write path.
 */
export class WkbWriter {
  private _buf: Uint8Array;
  private _view: DataView;
  private _pos = 0;
  private _offsets: number[] = [0];

  constructor(initialSize = 1024 * 64) {
    this._buf = new Uint8Array(initialSize);
    this._view = new DataView(this._buf.buffer);
  }

  /** Close the current row; call once per feature (including null/empty). */
  endRow(): void {
    this._offsets.push(this._pos);
  }

  writePoint(x: number, y: number): void {
    this._ensure(21);
    this._header(1);
    this._coord(x, y);
  }

  writeMultiPoint(points: ReadonlyArray<readonly [number, number]>): void {
    this._ensure(9 + points.length * 21);
    this._header(4);
    this._u32(points.length);
    for (const p of points) {
      this._header(1);
      this._coord(p[0], p[1]);
    }
  }

  writeLineString(xs: Float64Array, ys: Float64Array, start: number, end: number): void {
    const n = end - start;
    this._ensure(9 + n * 16);
    this._header(2);
    this._coordSeq(xs, ys, start, end);
  }

  writeMultiLineString(
    xs: Float64Array,
    ys: Float64Array,
    paths: ReadonlyArray<readonly [number, number]>,
  ): void {
    let total = 9;
    for (const [s, e] of paths) total += 9 + (e - s) * 16;
    this._ensure(total);
    this._header(5);
    this._u32(paths.length);
    for (const [s, e] of paths) {
      this._header(2);
      this._coordSeq(xs, ys, s, e);
    }
  }

  /**
   * `polygons`: one entry per polygon part; each lists its rings as
   * [start, end) runs into xs/ys (shell first, then holes). A single
   * polygon is written as WKB Polygon, multiple as MultiPolygon.
   */
  writePolygons(
    xs: Float64Array,
    ys: Float64Array,
    polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  ): void {
    const single = polygons.length === 1;
    let total = single ? 0 : 9;
    for (const rings of polygons) {
      total += 9;
      for (const [s, e] of rings) total += 4 + (e - s) * 16;
    }
    this._ensure(total);
    if (!single) {
      this._header(6);
      this._u32(polygons.length);
    }
    for (const rings of polygons) {
      this._header(3);
      this._u32(rings.length);
      for (const [s, e] of rings) {
        this._coordSeq(xs, ys, s, e);
      }
    }
  }

  finish(): { bytes: Uint8Array; valueOffsets: Int32Array } {
    return {
      bytes: this._buf.subarray(0, this._pos),
      valueOffsets: Int32Array.from(this._offsets),
    };
  }

  private _ensure(extra: number): void {
    const needed = this._pos + extra;
    if (needed <= this._buf.length) return;
    const next = new Uint8Array(Math.max(needed, this._buf.length * 2));
    next.set(this._buf.subarray(0, this._pos));
    this._buf = next;
    this._view = new DataView(next.buffer);
  }

  private _header(type: number): void {
    this._view.setUint8(this._pos, 1); // little-endian
    this._view.setUint32(this._pos + 1, type, true);
    this._pos += 5;
  }

  private _u32(v: number): void {
    this._view.setUint32(this._pos, v, true);
    this._pos += 4;
  }

  private _coord(x: number, y: number): void {
    this._view.setFloat64(this._pos, x, true);
    this._view.setFloat64(this._pos + 8, y, true);
    this._pos += 16;
  }

  private _coordSeq(xs: Float64Array, ys: Float64Array, start: number, end: number): void {
    this._u32(end - start);
    for (let i = start; i < end; i++) {
      this._view.setFloat64(this._pos, xs[i], true);
      this._view.setFloat64(this._pos + 8, ys[i], true);
      this._pos += 16;
    }
  }
}

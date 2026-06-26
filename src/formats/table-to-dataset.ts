import { DataType, type Table, type Vector } from 'apache-arrow';
import { getDefaultMapshaperAdapter, type PathImporterHandle } from '../adapter/mapshaper-adapter';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { decodeWkb } from './wkb';
import { detectGeometryColumn } from './geometry-column';
import { parseGeoMetadata, type GeoEncoding } from './geoparquet-metadata';

export interface FromArrowTableOptions {
  /** Override geometry column detection by column name. */
  geometryColumn?: string;
  /** Layer name for the resulting dataset (defaults to 'layer'). */
  layerName?: string;
  /**
   * Skip the shared-arc topology build (mapshaper `buildTopology`). Topology
   * is required for emap's vertex editing and most ops, so leave this off
   * unless importing throwaway display-only data.
   */
  noTopology?: boolean;
}

let warnedBigInt = false;

/**
 * Convert an Arrow table (GeoArrow native or WKB geometry column) into a
 * mapshaper dataset — directly, with no GeoJSON intermediate. Geometry rows
 * stream into mapshaper's internal PathImporter; attributes become a
 * DataTable; shared-arc topology is built the same way mapshaper's own
 * importers do.
 *
 * This is also the duckdb-wasm bridge: a query result with an
 * `ST_AsWKB(geometry)` Binary column converts through the same path.
 */
export function fromArrowTable(table: Table, opts: FromArrowTableOptions = {}): MapshaperDataset {
  const adapter = getDefaultMapshaperAdapter();
  const geom = detectGeometryColumn(table, opts.geometryColumn);
  if (!geom && table.numRows > 0) {
    throw new Error(
      'No geometry column found (no GeoParquet "geo" metadata, no geoarrow ' +
        'extension type, no Binary column named geometry/geom/wkb_geometry)',
    );
  }

  const records = buildRecords(
    table,
    geom?.fieldIndex ?? -1,
    getCoveringFieldIndexes(table, geom?.name),
  );
  const importer = adapter.createPathImporter({});
  const geomVector = geom ? table.getChildAt(geom.fieldIndex) : null;

  for (let row = 0; row < table.numRows; row++) {
    importer.startShape(records[row]);
    if (!geomVector || !geomVector.isValid(row)) continue;
    importGeometry(importer, geomVector, row, geom!.encoding);
  }

  const dataset = importer.done();
  adapter.cleanPathsAfterImport(dataset, {});
  if (dataset.arcs && !opts.noTopology) {
    adapter.buildTopology(dataset);
  }

  for (const lyr of dataset.layers) {
    if (!lyr.name) lyr.name = opts.layerName || 'layer';
  }
  dataset.info = dataset.info || {};
  (dataset.info as Record<string, unknown>).input_formats = ['geoarrow'];
  if (geom?.crsString) {
    dataset.info.crs_string = geom.crsString;
  }
  return dataset;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function importGeometry(
  importer: PathImporterHandle,
  vector: Vector,
  row: number,
  encoding: GeoEncoding,
): void {
  if (encoding === 'WKB') {
    const bytes = vector.get(row) as Uint8Array | null;
    if (!bytes || bytes.length === 0) return;
    const decoded = decodeWkb(bytes);
    if (!decoded) return;
    if (decoded.type === 'point') {
      importer.importPoints(decoded.points);
    } else if (decoded.type === 'polyline') {
      for (const path of decoded.paths) importer.importLine(path);
    } else {
      for (let r = 0; r < decoded.rings.length; r++) {
        importer.importRing(decoded.rings[r], decoded.ringIsHole[r]);
      }
    }
    return;
  }

  // Native geoarrow encodings: nested Arrow lists down to a coord leaf
  // (Struct<x,y> separated or FixedSizeList<f64>[2|3] interleaved).
  const value = vector.get(row);
  if (value == null) return;
  switch (encoding) {
    case 'point':
      importer.importPoints([readCoord(value)]);
      break;
    case 'multipoint':
      importer.importPoints(readCoordList(value as Vector));
      break;
    case 'linestring':
      importer.importLine(readCoordList(value as Vector));
      break;
    case 'multilinestring': {
      const lines = value as Vector;
      for (let i = 0; i < lines.length; i++) {
        importer.importLine(readCoordList(lines.get(i) as Vector));
      }
      break;
    }
    case 'polygon': {
      const rings = value as Vector;
      for (let i = 0; i < rings.length; i++) {
        importer.importRing(readCoordList(rings.get(i) as Vector), i > 0);
      }
      break;
    }
    case 'multipolygon': {
      const polygons = value as Vector;
      for (let p = 0; p < polygons.length; p++) {
        const rings = polygons.get(p) as Vector;
        for (let r = 0; r < rings.length; r++) {
          importer.importRing(readCoordList(rings.get(r) as Vector), r > 0);
        }
      }
      break;
    }
  }
}

let warnedNativeZ = false;

/** Coord leaf → [x, y]. Accepts Struct rows and FixedSizeList vectors. */
function readCoord(value: unknown): [number, number] {
  if (value == null) return [NaN, NaN];
  // Interleaved: FixedSizeList<f64>[2|3] yields a Vector (or typed array)
  const v = value as { length?: number; get?: (i: number) => unknown };
  if (typeof v.get === 'function' && typeof v.length === 'number') {
    if (v.length > 2 && !warnedNativeZ) {
      warnedNativeZ = true;
      console.warn('emap formats: 3D GeoArrow coordinates are not supported; Z values dropped');
    }
    return [Number(v.get(0)), Number(v.get(1))];
  }
  if (ArrayBuffer.isView(value)) {
    const arr = value as unknown as ArrayLike<number>;
    return [Number(arr[0]), Number(arr[1])];
  }
  // Separated: StructRow with x / y members
  const s = value as { x?: unknown; y?: unknown };
  return [Number(s.x), Number(s.y)];
}

function readCoordList(list: Vector): Array<[number, number]> {
  const out: Array<[number, number]> = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    out[i] = readCoord(list.get(i));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

function buildRecords(
  table: Table,
  geometryIndex: number,
  skipIndexes = new Set<number>(),
): Array<Record<string, unknown>> {
  const fields = table.schema.fields;
  const records: Array<Record<string, unknown>> = new Array(table.numRows);
  for (let i = 0; i < table.numRows; i++) records[i] = {};

  for (let col = 0; col < fields.length; col++) {
    if (col === geometryIndex || skipIndexes.has(col)) continue;
    const field = fields[col];
    const vector = table.getChildAt(col);
    if (!vector) continue;
    const wrapDate = DataType.isTimestamp(field.type) || DataType.isDate(field.type);
    for (let row = 0; row < table.numRows; row++) {
      records[row][field.name] = toRecordValue(vector.get(row), wrapDate);
    }
  }
  return records;
}

function getCoveringFieldIndexes(table: Table, geometryColumn?: string): Set<number> {
  const indexes = new Set<number>();
  const geo = parseGeoMetadata(table.schema.metadata);
  const column = geometryColumn ? geo?.columns[geometryColumn] : undefined;
  const bbox = column?.covering?.bbox;
  if (!bbox) return indexes;

  for (const path of [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax]) {
    const name = Array.isArray(path) ? path[0] : undefined;
    if (!name) continue;
    const index = table.schema.fields.findIndex((field) => field.name === name);
    if (index !== -1) indexes.add(index);
  }
  return indexes;
}

function toRecordValue(value: unknown, wrapDate: boolean): unknown {
  if (value == null) return null;
  if (typeof value === 'bigint') {
    // duckdb commonly emits Int64 columns; mapshaper DataTables hold plain JS
    // values, so coerce — warning once when the value can't round-trip.
    if (
      !warnedBigInt &&
      (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
    ) {
      warnedBigInt = true;
      console.warn('emap formats: Int64 attribute values exceed 2^53; precision was lost');
    }
    return Number(value);
  }
  if (wrapDate && typeof value === 'number') return new Date(value);
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const v = value as { toJSON?: () => unknown };
    if (typeof v.toJSON === 'function') return v.toJSON();
  }
  return value;
}

/** Test seam: reset one-time warnings. */
export function resetTableImportWarnings(): void {
  warnedBigInt = false;
  warnedNativeZ = false;
}

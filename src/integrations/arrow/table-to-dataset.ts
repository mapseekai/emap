import { DataType, DateUnit, Precision, type Table, type Vector } from 'apache-arrow';
import { getDefaultMapshaperAdapter, type PathImporterHandle } from '../mapshaper/adapter';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { decodeWkbForImport } from './wkb';
import { seedArrowTable } from './table-cache';
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

export interface RecordsFromArrowTableOptions {
  skipColumns?: readonly string[];
}

let warnedBigInt = false;

export function recordsFromArrowTable(
  table: Table,
  opts: RecordsFromArrowTableOptions = {},
): Array<Record<string, unknown>> {
  const fields = table.schema.fields;
  const skipColumns = new Set(opts.skipColumns ?? []);
  const records: Array<Record<string, unknown>> = new Array<Record<string, unknown>>(table.numRows);

  for (let row = 0; row < table.numRows; row++) {
    const record: Record<string, unknown> = {};
    for (const [col, field] of fields.entries()) {
      if (skipColumns.has(field.name)) continue;
      const vector = table.getChildAt(col);
      const wrapDate = DataType.isTimestamp(field.type) || DataType.isDate(field.type);
      Object.defineProperty(record, field.name, {
        configurable: true,
        enumerable: true,
        value: toRecordValue(vector?.get(row), wrapDate),
        writable: true,
      });
    }
    records[row] = record;
  }

  return records;
}

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

  const coveringFields = getCoveringFieldIndexes(table, geom?.name);
  const records = buildRecords(table, geom?.fieldIndex ?? -1, coveringFields);
  const importer = adapter.createPathImporter({});
  const geomVector = geom ? table.getChildAt(geom.fieldIndex) : null;
  const state = {
    hasMultipleParts: false,
    lossless:
      new Set(table.schema.fields.map((field) => field.name)).size === table.numCols &&
      table.schema.fields.every((field, index) => {
        if (index === geom?.fieldIndex)
          return geom.encoding === 'WKB' || hasSeparatedFloat64Coordinates(field.type);
        if (coveringFields.has(index)) return true;
        const type = field.type;
        const sample = records.find((record) => record[field.name] != null)?.[field.name];
        // Match the normalized record-to-Arrow types, not the original storage type.
        if (DataType.isUtf8(type)) return true;
        if (typeof sample === 'number')
          return DataType.isFloat(type) && type.precision === Precision.DOUBLE;
        if (typeof sample === 'boolean') return DataType.isBool(type);
        return (
          sample instanceof Date && DataType.isDate(type) && type.unit === DateUnit.MILLISECOND
        );
      }),
  };

  for (let row = 0; row < table.numRows; row++) {
    importer.startShape(records[row]);
    if (!geomVector || !geomVector.isValid(row)) continue;
    importGeometry(importer, geomVector, row, geom!.encoding, state);
  }

  if (geom?.encoding.startsWith('multi') && !state.hasMultipleParts) state.lossless = false;
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
  if (
    state.lossless &&
    dataset.layers.length === 1 &&
    dataset.layers[0].shapes?.every(
      (shape, row) => Boolean(shape) === Boolean(geomVector?.isValid(row)),
    )
  )
    seedArrowTable(dataset, table, geom?.name);
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
  state: { lossless: boolean; hasMultipleParts: boolean },
): void {
  const points = (coords: Array<[number, number]>) => {
    if (
      !coords.length ||
      coords.some(
        ([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x <= -1e38 || y <= -1e38,
      )
    )
      state.lossless = false;
    importer.importPoints(coords);
  };
  const path = (coords: Array<[number, number]>, hole?: boolean) => {
    const ring = hole !== undefined;
    if (coords.length < (ring ? 4 : 2)) state.lossless = false;
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const [x, y] = coords[i];
      const previous = coords[i - 1];
      const before = coords[i - 2];
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        (previous && x === previous[0] && y === previous[1]) ||
        (before && x === before[0] && y === before[1])
      )
        state.lossless = false;
      if (previous) area += previous[0] * y - x * previous[1];
    }
    if (
      ring &&
      (!area || coords[0]?.[0] !== coords.at(-1)?.[0] || coords[0]?.[1] !== coords.at(-1)?.[1])
    )
      state.lossless = false;
    if (ring) importer.importRing(coords, hole);
    else importer.importLine(coords);
  };
  if (encoding === 'WKB') {
    const bytes = vector.get(row) as Uint8Array | null;
    if (!bytes || bytes.length === 0) return;
    const { geometry: decoded, hasZ, hasSrid, hasSingletonMulti } = decodeWkbForImport(bytes);
    if (hasZ || hasSrid || hasSingletonMulti) state.lossless = false;
    if (decoded.type === 'point') {
      points(decoded.points);
    } else if (decoded.type === 'polyline') {
      for (const coords of decoded.paths) path(coords);
    } else {
      for (let r = 0; r < decoded.rings.length; r++) {
        path(decoded.rings[r], decoded.ringIsHole[r]);
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
      points([readCoord(value, state)]);
      break;
    case 'multipoint':
      if ((value as Vector).length > 1) state.hasMultipleParts = true;
      points(readCoordList(value as Vector, state));
      break;
    case 'linestring':
      path(readCoordList(value as Vector, state));
      break;
    case 'multilinestring': {
      const lines = value as Vector;
      if (lines.length > 1) state.hasMultipleParts = true;
      for (let i = 0; i < lines.length; i++) {
        path(readCoordList(lines.get(i) as Vector, state));
      }
      break;
    }
    case 'polygon': {
      const rings = value as Vector;
      for (let i = 0; i < rings.length; i++) {
        path(readCoordList(rings.get(i) as Vector, state), i > 0);
      }
      break;
    }
    case 'multipolygon': {
      const polygons = value as Vector;
      if (polygons.length > 1) state.hasMultipleParts = true;
      for (let p = 0; p < polygons.length; p++) {
        const rings = polygons.get(p) as Vector;
        for (let r = 0; r < rings.length; r++) {
          path(readCoordList(rings.get(r) as Vector, state), r > 0);
        }
      }
      break;
    }
  }
}

function hasSeparatedFloat64Coordinates(type: DataType): boolean {
  if (DataType.isList(type)) return hasSeparatedFloat64Coordinates(type.valueType);
  return (
    DataType.isStruct(type) &&
    type.children.length === 2 &&
    type.children[0].name === 'x' &&
    type.children[1].name === 'y' &&
    type.children.every(
      (field) => DataType.isFloat(field.type) && field.type.precision === Precision.DOUBLE,
    )
  );
}

let warnedNativeZ = false;

/** Coord leaf → [x, y]. Accepts Struct rows and FixedSizeList vectors. */
function readCoord(value: unknown, state: { lossless: boolean }): [number, number] {
  if (value == null) {
    state.lossless = false;
    return [NaN, NaN];
  }
  let x: unknown;
  let y: unknown;
  // Interleaved: FixedSizeList<f64>[2|3] yields a Vector (or typed array).
  const v = value as { length?: number; get?: (i: number) => unknown };
  if (typeof v.get === 'function' && typeof v.length === 'number') {
    if (v.length > 2 && !warnedNativeZ) {
      warnedNativeZ = true;
      console.warn('emap formats: 3D GeoArrow coordinates are not supported; Z values dropped');
    }
    x = v.get(0);
    y = v.get(1);
  } else if (ArrayBuffer.isView(value)) {
    const arr = value as unknown as ArrayLike<number>;
    x = arr[0];
    y = arr[1];
  } else {
    const coordinate = value as { x?: unknown; y?: unknown };
    x = coordinate.x;
    y = coordinate.y;
  }
  if (typeof x !== 'number' || typeof y !== 'number') state.lossless = false;
  return [Number(x), Number(y)];
}

function readCoordList(list: Vector, state: { lossless: boolean }): Array<[number, number]> {
  const out: Array<[number, number]> = new Array<[number, number]>(list.length);
  for (let i = 0; i < list.length; i++) {
    out[i] = readCoord(list.get(i), state);
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
  const records: Array<Record<string, unknown>> = new Array<Record<string, unknown>>(table.numRows);
  for (let i = 0; i < table.numRows; i++) records[i] = {};

  for (let col = 0; col < fields.length; col++) {
    if (col === geometryIndex || skipIndexes.has(col)) continue;
    const field = fields[col];
    const vector = table.getChildAt(col);
    if (!vector) continue;
    const wrapDate = DataType.isTimestamp(field.type) || DataType.isDate(field.type);
    for (let row = 0; row < table.numRows; row++) {
      Object.defineProperty(records[row], field.name, {
        configurable: true,
        enumerable: true,
        value: toRecordValue(vector.get(row), wrapDate),
        writable: true,
      });
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

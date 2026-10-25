import {
  Binary,
  Bool,
  DateMillisecond,
  Field,
  Float64,
  List,
  RecordBatch,
  Schema,
  Struct,
  Table,
  Utf8,
  makeData,
  vectorFromArray,
  type Data,
} from 'apache-arrow';
import {
  getDefaultMapshaperAdapter,
  type ExportedPath,
  type MapshaperAdapter,
} from '../mapshaper/adapter';
import { resolveDatasetCRSMetadata } from '../../domain/geo/crs-resolver';
import { resolveLayerInList } from '../../engine/map/layer-registry';
import { getLayerId, normalizePointShape } from '../../domain/source/layer-utils';
import type {
  ArcCollection,
  MapshaperDataset,
  MapshaperLayer,
} from '../../shared/types/mapshaper-types';
import { groupPolygonRings } from './group-polygon-rings';
import {
  ARROW_EXTENSION_METADATA,
  ARROW_EXTENSION_NAME,
  buildGeoMetadata,
  type CrsProjjsonLookup,
  crsStringToProjjson,
  extensionNameFromEncoding,
  type GeoEncoding,
} from './geoparquet-metadata';
import { WkbWriter } from './wkb';
import { getCachedArrowTable, cacheArrowTable, getSeededArrowTable } from './table-cache';

export interface ToArrowTableOptions {
  /** Geometry encoding: GeoArrow native nested arrays or WKB binary. */
  encoding?: 'native' | 'wkb';
  /** Layer to export (index or name); defaults to layer 0. */
  layer?: number | string;
  /** Geometry column name; defaults to 'geometry'. */
  geometryColumn?: string;
  /** Optional GeoParquet 1.1 covering bbox struct column name. */
  bboxColumn?: string | false;
  /** Reproject EPSG:3857 coordinates to GeoParquet's default OGC:CRS84 lon/lat output. */
  reprojectToWgs84?: boolean;
  /** Optional authority lookup for writing full CRS PROJJSON objects. */
  crsProjjsonLookup?: CrsProjjsonLookup;
  /** Pre-resolved GeoParquet PROJJSON CRS override. */
  projjsonCrs?: unknown;
}

/**
 * Convert one layer of a mapshaper dataset into an Arrow table — directly,
 * with no GeoJSON intermediate. Geometry coordinates flow from the arc
 * collection through mapshaper's `exportPathData` (absolute coords in shape
 * order) into either GeoArrow native nested vectors (separated x/y struct,
 * near zero-copy via `makeData`) or a WKB Binary column.
 *
 * The table's schema carries both GeoParquet `geo` metadata and a GeoArrow
 * `ARROW:extension:name` on the geometry field, so the output is directly
 * usable as a GeoParquet payload, a GeoArrow IPC payload, or a duckdb-wasm
 * `insertArrowTable` input.
 */
export function toArrowTable(dataset: MapshaperDataset, opts: ToArrowTableOptions = {}): Table {
  return prepareArrowTable(dataset, opts, false);
}

/** Integration-only reuse; cached tables never escape through the public converter. */
export function toCachedArrowTable(
  dataset: MapshaperDataset,
  opts: ToArrowTableOptions = {},
): Table {
  return prepareArrowTable(dataset, opts, true);
}

function prepareArrowTable(
  dataset: MapshaperDataset,
  opts: ToArrowTableOptions,
  reuse: boolean,
): Table {
  const layer = resolveArrowLayer(dataset, opts.layer);
  const sourceCrsString = resolveDatasetCRSMetadata(dataset);
  const reprojectToWgs84 = opts.reprojectToWgs84 === true && isWebMercatorCrs(sourceCrsString);
  const crs =
    opts.projjsonCrs !== undefined
      ? opts.projjsonCrs
      : reprojectToWgs84
        ? undefined
        : crsStringToProjjson(sourceCrsString, opts.crsProjjsonLookup);
  const key = JSON.stringify([
    opts.encoding ?? 'native',
    opts.geometryColumn || 'geometry',
    opts.bboxColumn || false,
    reprojectToWgs84,
    { crs },
  ]);
  const cached =
    reuse &&
    (getCachedArrowTable(dataset, layer, key) ?? getSeededArrowTable(dataset, layer, opts, crs));
  if (cached) return cached;
  const arcs = dataset.arcs;
  const interval = arcs?.getRetainedInterval?.() ?? 0;
  try {
    if (interval) arcs?.setRetainedInterval?.(0);
    const table = convertToArrowTable(dataset, layer, opts, crs, reprojectToWgs84);
    if (reuse) cacheArrowTable(dataset, layer, key, table);
    return table;
  } finally {
    if (interval) arcs?.setRetainedInterval?.(interval);
  }
}

function convertToArrowTable(
  dataset: MapshaperDataset,
  layer: MapshaperLayer,
  opts: ToArrowTableOptions,
  crs: unknown,
  reprojectToWgs84: boolean,
): Table {
  const adapter = getDefaultMapshaperAdapter();
  const geometryType = layer.geometry_type;
  if (!geometryType) {
    throw new Error('Layer has no geometry; attribute-only export is not supported');
  }
  const shapes = layer.shapes ?? [];
  const arcs = dataset.arcs;
  const useWkb = opts.encoding === 'wkb';
  const geometryColumn = opts.geometryColumn || 'geometry';

  const geometry = collectGeometry(
    shapes,
    arcs,
    geometryType,
    adapter,
    getLayerId(layer, dataset.layers.indexOf(layer)),
  );
  const outputGeometry = reprojectToWgs84 ? webMercatorGeometryToWgs84(geometry) : geometry;

  const { geomData, encoding } = useWkb
    ? buildWkbColumn(outputGeometry)
    : buildNativeColumn(outputGeometry, geometryType);

  // Attribute columns
  const records = layer.data?.getRecords?.() ?? [];
  const fieldNames = collectFieldNames(records, shapes.length);
  const fields: Field[] = [];
  const children: Data[] = [];
  for (const name of fieldNames) {
    const { field, data } = buildAttributeColumn(name, records, shapes.length);
    fields.push(field);
    children.push(data);
  }

  const bboxColumn = opts.bboxColumn
    ? resolveUniqueColumnName(opts.bboxColumn, new Set([...fieldNames, geometryColumn]))
    : null;
  if (bboxColumn) {
    const { field, data } = buildBBoxColumn(bboxColumn, outputGeometry);
    fields.push(field);
    children.push(data);
  }

  // Geometry field: geoarrow extension metadata (+ crs when known)
  const extMeta = new Map<string, string>([
    [ARROW_EXTENSION_NAME, extensionNameFromEncoding(encoding)],
  ]);
  if (crs !== undefined) {
    extMeta.set(ARROW_EXTENSION_METADATA, JSON.stringify({ crs }));
  }
  fields.push(new Field(geometryColumn, geomData.type, true, extMeta));
  children.push(geomData);

  const schemaMetadata = new Map<string, string>([
    [
      'geo',
      buildGeoMetadata({
        columnName: geometryColumn,
        encoding,
        geometryTypes: geometry.geometryTypes,
        bbox: outputGeometry.bbox,
        crs,
        bboxColumn: bboxColumn ?? undefined,
      }),
    ],
  ]);

  const schema = new Schema(fields, schemaMetadata);
  const structData = makeData({
    type: new Struct(fields),
    children,
    length: shapes.length,
    nullCount: 0,
  });
  return new Table(schema, [new RecordBatch(schema, structData)]);
}

// ---------------------------------------------------------------------------
// Layer resolution
// ---------------------------------------------------------------------------

export function resolveArrowLayer(
  dataset: MapshaperDataset,
  selector?: number | string,
): MapshaperLayer {
  const layers = dataset.layers ?? [];
  if (layers.length === 0) throw new Error('Dataset has no layers to export');
  if (typeof selector === 'string') {
    const found = resolveLayerInList(layers, selector);
    if (!found) throw new Error(`Layer '${selector}' not found in dataset`);
    return found;
  }
  const idx = selector ?? 0;
  const layer = layers[idx];
  if (!layer) throw new Error(`Layer index ${idx} out of range (${layers.length} layers)`);
  if (selector === undefined && layers.length > 1) {
    console.warn(
      `emap formats: dataset has ${layers.length} layers; exporting layer 0 ` +
        `('${layer.name || ''}') — pass { layer } to choose another`,
    );
  }
  return layer;
}

// ---------------------------------------------------------------------------
// Geometry accumulation (coord-run model)
// ---------------------------------------------------------------------------

/** [start, end) run into the shared xs/ys arrays. */
type CoordRun = [number, number];

interface CollectedGeometry {
  /** Shared coordinate buffers (filled length = `coordCount`). */
  xs: Float64Array;
  ys: Float64Array;
  coordCount: number;
  /**
   * Per-feature structure, `null` for null/empty shapes:
   * - point layers: index range of this feature's points
   * - polyline: one run per path
   * - polygon: polygons → rings → run (shell first, holes after)
   */
  features: Array<null | CoordRun | CoordRun[] | CoordRun[][]>;
  geometryType: 'point' | 'polyline' | 'polygon';
  /** Max parts in any feature — picks singular vs Multi* arrow type. */
  maxParts: number;
  bbox: number[];
  geometryTypes: string[];
}

function collectGeometry(
  shapes: ReadonlyArray<unknown>,
  arcs: ArcCollection | undefined,
  geometryType: 'point' | 'polyline' | 'polygon',
  adapter: MapshaperAdapter,
  layerId: string,
): CollectedGeometry {
  const grow = new GrowableCoords();
  const features: CollectedGeometry['features'] = new Array<
    CoordRun | CoordRun[] | CoordRun[][] | null
  >(shapes.length);
  let maxParts = 0;
  const geometryTypes = new Set<string>();

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape) {
      features[i] = null;
      continue;
    }

    if (geometryType === 'point') {
      const points = normalizePointShape(shape as never);
      if (points.length === 0) {
        features[i] = null;
        continue;
      }
      const start = grow.count;
      for (const p of points) grow.push(p[0], p[1]);
      features[i] = [start, grow.count] as CoordRun;
      maxParts = Math.max(maxParts, points.length);
      geometryTypes.add(points.length > 1 ? 'MultiPoint' : 'Point');
      continue;
    }

    if (!arcs) {
      features[i] = null;
      continue;
    }

    const exported = adapter.exportPathData(shape as number[][], arcs, geometryType);
    if (exported.pathData.length === 0) {
      features[i] = null;
      continue;
    }

    if (geometryType === 'polyline') {
      const runs: CoordRun[] = exported.pathData.map((path) => grow.pushPath(path));
      features[i] = runs;
      maxParts = Math.max(maxParts, runs.length);
      geometryTypes.add(runs.length > 1 ? 'MultiLineString' : 'LineString');
    } else {
      const groups = groupPolygonRings(exported.pathData, arcs, adapter);
      const groupedRings = groups.reduce((count, rings) => count + rings.length, 0);
      if (groupedRings !== exported.pathData.filter((path) => (path.area ?? 0) !== 0).length) {
        throw new Error(
          `Cannot convert polygon in layer "${layerId}", feature ${i}: invalid ring winding or containment; repair ring directions before exporting`,
        );
      }
      if (groups.length === 0) {
        features[i] = null;
        continue;
      }
      const polygons: CoordRun[][] = groups.map((rings) =>
        rings.map((ring) => grow.pushPath(ring)),
      );
      features[i] = polygons;
      maxParts = Math.max(maxParts, polygons.length);
      geometryTypes.add(polygons.length > 1 ? 'MultiPolygon' : 'Polygon');
    }
  }

  return {
    xs: grow.xs,
    ys: grow.ys,
    coordCount: grow.count,
    features,
    geometryType,
    maxParts,
    bbox: grow.bbox(),
    geometryTypes: Array.from(geometryTypes),
  };
}

const WEB_MERCATOR_RADIUS = 6378137;
const RADIANS_TO_DEGREES = 180 / Math.PI;

function isWebMercatorCrs(crsString: string | undefined): boolean {
  return /^EPSG:3857$/i.test(crsString ?? '');
}

function webMercatorGeometryToWgs84(geometry: CollectedGeometry): CollectedGeometry {
  const xs = new Float64Array(geometry.coordCount);
  const ys = new Float64Array(geometry.coordCount);
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;

  for (let i = 0; i < geometry.coordCount; i++) {
    const lon = (geometry.xs[i] / WEB_MERCATOR_RADIUS) * RADIANS_TO_DEGREES;
    const lat =
      RADIANS_TO_DEGREES *
      (Math.PI * 0.5 - 2 * Math.atan(Math.exp(-geometry.ys[i] / WEB_MERCATOR_RADIUS)));
    xs[i] = lon;
    ys[i] = lat;
    if (lon < xmin) xmin = lon;
    if (lon > xmax) xmax = lon;
    if (lat < ymin) ymin = lat;
    if (lat > ymax) ymax = lat;
  }

  return {
    ...geometry,
    xs,
    ys,
    bbox: Number.isFinite(xmin) ? [xmin, ymin, xmax, ymax] : [],
  };
}

class GrowableCoords {
  xs = new Float64Array(1024);
  ys = new Float64Array(1024);
  count = 0;
  private _xmin = Infinity;
  private _ymin = Infinity;
  private _xmax = -Infinity;
  private _ymax = -Infinity;

  push(x: number, y: number): void {
    if (this.count === this.xs.length) {
      const next = this.xs.length * 2;
      const xs = new Float64Array(next);
      const ys = new Float64Array(next);
      xs.set(this.xs);
      ys.set(this.ys);
      this.xs = xs;
      this.ys = ys;
    }
    this.xs[this.count] = x;
    this.ys[this.count] = y;
    this.count++;
    if (x < this._xmin) this._xmin = x;
    if (x > this._xmax) this._xmax = x;
    if (y < this._ymin) this._ymin = y;
    if (y > this._ymax) this._ymax = y;
  }

  pushPath(path: ExportedPath): CoordRun {
    const start = this.count;
    for (const p of path.points) this.push(p[0], p[1]);
    return [start, this.count];
  }

  bbox(): number[] {
    return [this._xmin, this._ymin, this._xmax, this._ymax];
  }
}

// ---------------------------------------------------------------------------
// Geometry column emitters
// ---------------------------------------------------------------------------

function packValidity(features: ReadonlyArray<unknown>): {
  nullBitmap: Uint8Array | undefined;
  nullCount: number;
} {
  let nullCount = 0;
  const bitmap = new Uint8Array(Math.ceil(features.length / 8) || 1);
  for (let i = 0; i < features.length; i++) {
    if (features[i] !== null) {
      bitmap[i >> 3] |= 1 << (i & 7);
    } else {
      nullCount++;
    }
  }
  return { nullBitmap: nullCount > 0 ? bitmap : undefined, nullCount };
}

function buildWkbColumn(geometry: CollectedGeometry): { geomData: Data; encoding: GeoEncoding } {
  const { xs, ys, features, geometryType } = geometry;
  const writer = new WkbWriter();

  for (const feature of features) {
    if (feature !== null) {
      if (geometryType === 'point') {
        const [start, end] = feature as CoordRun;
        if (end - start === 1) {
          writer.writePoint(xs[start], ys[start]);
        } else {
          const pts: Array<[number, number]> = [];
          for (let i = start; i < end; i++) pts.push([xs[i], ys[i]]);
          writer.writeMultiPoint(pts);
        }
      } else if (geometryType === 'polyline') {
        const runs = feature as CoordRun[];
        if (runs.length === 1) {
          writer.writeLineString(xs, ys, runs[0][0], runs[0][1]);
        } else {
          writer.writeMultiLineString(xs, ys, runs);
        }
      } else {
        writer.writePolygons(xs, ys, feature as CoordRun[][]);
      }
    }
    writer.endRow();
  }

  const { bytes, valueOffsets } = writer.finish();
  const { nullBitmap, nullCount } = packValidity(features);
  const geomData = makeData({
    type: new Binary(),
    length: features.length,
    data: bytes,
    valueOffsets,
    nullBitmap,
    nullCount,
  });
  return { geomData, encoding: 'WKB' };
}

function buildBBoxColumn(
  columnName: string,
  geometry: CollectedGeometry,
): { field: Field; data: Data } {
  const n = geometry.features.length;
  const xmin = new Float64Array(n);
  const ymin = new Float64Array(n);
  const xmax = new Float64Array(n);
  const ymax = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const bbox = featureBBox(geometry, geometry.features[i]);
    if (!bbox) continue;
    xmin[i] = bbox[0];
    ymin[i] = bbox[1];
    xmax[i] = bbox[2];
    ymax[i] = bbox[3];
  }

  const fields = ['xmin', 'ymin', 'xmax', 'ymax'].map(
    (name) => new Field(name, new Float64(), false),
  );
  const type = new Struct(fields);
  const { nullBitmap, nullCount } = packValidity(geometry.features);
  const data = makeData({
    type,
    length: n,
    nullBitmap,
    nullCount,
    children: [xmin, ymin, xmax, ymax].map((values) =>
      makeData({ type: new Float64(), length: n, data: values, nullCount: 0 }),
    ),
  });
  return { field: new Field(columnName, type, true), data };
}

function featureBBox(
  geometry: CollectedGeometry,
  feature: CollectedGeometry['features'][number],
): number[] | null {
  if (!feature) return null;
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;

  const visitRun = ([start, end]: CoordRun) => {
    for (let i = start; i < end; i++) {
      const x = geometry.xs[i];
      const y = geometry.ys[i];
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  };

  if (geometry.geometryType === 'point') {
    visitRun(feature as CoordRun);
  } else if (geometry.geometryType === 'polyline') {
    for (const run of feature as CoordRun[]) visitRun(run);
  } else {
    for (const polygon of feature as CoordRun[][]) {
      for (const ring of polygon) visitRun(ring);
    }
  }

  return Number.isFinite(xmin) ? [xmin, ymin, xmax, ymax] : null;
}

function buildNativeColumn(
  geometry: CollectedGeometry,
  geometryType: 'point' | 'polyline' | 'polygon',
): { geomData: Data; encoding: GeoEncoding } {
  const { xs, ys, coordCount, features, maxParts } = geometry;
  const multi = maxParts > 1;

  // Coord leaf: separated layout — Struct<x: f64, y: f64> (GeoParquet 1.1
  // native encoding requires separated; mapshaper stores xx/yy separated
  // already, so this is a straight copy).
  const xField = new Field('x', new Float64(), false);
  const yField = new Field('y', new Float64(), false);
  const coordType = new Struct([xField, yField]);

  const makeCoords = (length: number, xsArr: Float64Array, ysArr: Float64Array) =>
    makeData({
      type: coordType,
      length,
      nullCount: 0,
      children: [
        makeData({ type: new Float64(), length, data: xsArr, nullCount: 0 }),
        makeData({ type: new Float64(), length, data: ysArr, nullCount: 0 }),
      ],
    });

  const { nullBitmap, nullCount } = packValidity(features);
  const n = features.length;

  if (geometryType === 'point' && !multi) {
    // geoarrow.point: coords at row level; null rows hold placeholder zeros.
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const f = features[i] as CoordRun | null;
      if (f) {
        px[i] = xs[f[0]];
        py[i] = ys[f[0]];
      }
    }
    const data = makeData({
      type: coordType,
      length: n,
      nullBitmap,
      nullCount,
      children: [
        makeData({ type: new Float64(), length: n, data: px, nullCount: 0 }),
        makeData({ type: new Float64(), length: n, data: py, nullCount: 0 }),
      ],
    });
    return { geomData: data, encoding: 'point' };
  }

  const coords = makeCoords(coordCount, xs.subarray(0, coordCount), ys.subarray(0, coordCount));
  const listOf = (name: string, child: Data, valueOffsets: Int32Array, withNulls: boolean) =>
    makeData({
      type: new List(new Field(name, child.type, false)),
      length: valueOffsets.length - 1,
      valueOffsets,
      child,
      nullBitmap: withNulls ? nullBitmap : undefined,
      nullCount: withNulls ? nullCount : 0,
    });

  if (geometryType === 'point') {
    // geoarrow.multipoint: List<coords>
    const offsets = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const f = features[i] as CoordRun | null;
      offsets[i + 1] = f ? f[1] : offsets[i];
    }
    return {
      geomData: listOf('points', coords, offsets, true),
      encoding: 'multipoint',
    };
  }

  if (geometryType === 'polyline') {
    // linestring: List<coords>; multilinestring: List<List<coords>>
    if (!multi) {
      const offsets = new Int32Array(n + 1);
      for (let i = 0; i < n; i++) {
        const runs = features[i] as CoordRun[] | null;
        offsets[i + 1] = runs ? runs[runs.length - 1][1] : offsets[i];
      }
      return { geomData: listOf('vertices', coords, offsets, true), encoding: 'linestring' };
    }
    const innerOffsets: number[] = [0];
    const outerOffsets = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const runs = (features[i] as CoordRun[] | null) ?? [];
      for (const run of runs) innerOffsets.push(run[1]);
      outerOffsets[i + 1] = outerOffsets[i] + runs.length;
    }
    const lines = listOf('vertices', coords, Int32Array.from(innerOffsets), false);
    return {
      geomData: listOf('linestrings', lines, outerOffsets, true),
      encoding: 'multilinestring',
    };
  }

  // polygon: List<List<coords>>; multipolygon: List<List<List<coords>>>
  const ringOffsets: number[] = [0];
  const polyOffsets: number[] = [0];
  const outerOffsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const polygons = (features[i] as CoordRun[][] | null) ?? [];
    for (const rings of polygons) {
      for (const run of rings) ringOffsets.push(run[1]);
      polyOffsets.push(ringOffsets.length - 1);
    }
    outerOffsets[i + 1] = outerOffsets[i] + polygons.length;
  }
  const rings = listOf('vertices', coords, Int32Array.from(ringOffsets), false);
  if (!multi) {
    // Single polygon per feature: rings list directly under the row, with
    // row validity. polyOffsets aligns 1:1 with rows here.
    const offsets = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const polygons = features[i] as CoordRun[][] | null;
      offsets[i + 1] = polygons ? offsets[i] + polygons[0].length : offsets[i];
    }
    return { geomData: listOf('rings', rings, offsets, true), encoding: 'polygon' };
  }
  const polygons = listOf('rings', rings, Int32Array.from(polyOffsets), false);
  return {
    geomData: listOf('polygons', polygons, outerOffsets, true),
    encoding: 'multipolygon',
  };
}

// ---------------------------------------------------------------------------
// Attribute columns
// ---------------------------------------------------------------------------

function collectFieldNames(records: Array<Record<string, unknown>>, rowCount: number): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const limit = Math.min(records.length, rowCount);
  for (let i = 0; i < limit; i++) {
    const rec = records[i];
    if (!rec) continue;
    for (const key of Object.keys(rec)) {
      if (!seen.has(key)) {
        seen.add(key);
        names.push(key);
      }
    }
  }
  return names;
}

/** First `name`/`name_1`/`name_2`… variant not present in `reserved`. */
export function resolveUniqueColumnName(requested: string, existing: ReadonlySet<string>): string {
  if (!existing.has(requested)) return requested;
  let suffix = 1;
  let candidate = `${requested}_${suffix}`;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${requested}_${suffix}`;
  }
  return candidate;
}

/** Unique variant of `requested` against the table's existing field names. */
export function resolveTableColumnName(table: Table, requested: string): string {
  return resolveUniqueColumnName(
    requested,
    new Set(table.schema.fields.map((field) => field.name)),
  );
}

function buildAttributeColumn(
  name: string,
  records: Array<Record<string, unknown>>,
  rowCount: number,
): { field: Field; data: Data } {
  const values: unknown[] = new Array<unknown>(rowCount);
  let sample: unknown = null;
  for (let i = 0; i < rowCount; i++) {
    const v = records[i]?.[name];
    values[i] = v === undefined ? null : v;
    if (sample === null && values[i] !== null) sample = values[i];
  }

  let type: Float64 | Utf8 | Bool | DateMillisecond;
  if (typeof sample === 'number') {
    type = new Float64();
  } else if (typeof sample === 'boolean') {
    type = new Bool();
  } else if (sample instanceof Date) {
    type = new DateMillisecond();
  } else {
    type = new Utf8();
    for (let i = 0; i < rowCount; i++) {
      const v = values[i];
      if (v !== null && typeof v !== 'string') {
        values[i] = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
    }
  }
  if (type instanceof Float64) {
    // Mixed-type columns degrade to strings rather than NaN-ing values.
    const mixed = values.some((v) => v !== null && typeof v !== 'number');
    if (mixed) {
      type = new Utf8();
      for (let i = 0; i < rowCount; i++) {
        const v = values[i];
        if (v !== null && typeof v !== 'string') values[i] = String(v);
      }
    }
  }

  const vector = vectorFromArray(values, type);
  const field = new Field(name, type, true);
  return { field, data: vector.data[0] };
}

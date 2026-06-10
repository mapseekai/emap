/**
 * GeoParquet "geo" file metadata and GeoArrow field extension metadata —
 * build + parse helpers shared by the import and export paths.
 *
 * GeoParquet spec: https://geoparquet.org/releases/v1.1.0/
 * GeoArrow spec:   https://geoarrow.org/extension-types.html
 */

/** Geometry encodings this module reads and writes. */
export type GeoEncoding =
  | 'WKB'
  | 'point'
  | 'linestring'
  | 'polygon'
  | 'multipoint'
  | 'multilinestring'
  | 'multipolygon';

/** Parsed `geo` metadata for one geometry column. */
export interface GeoColumnMetadata {
  encoding: GeoEncoding;
  geometry_types?: string[];
  crs?: unknown;
  bbox?: number[];
}

/** Parsed GeoParquet `geo` file metadata. */
export interface GeoMetadata {
  version?: string;
  primary_column: string;
  columns: Record<string, GeoColumnMetadata>;
}

export const ARROW_EXTENSION_NAME = 'ARROW:extension:name';
export const ARROW_EXTENSION_METADATA = 'ARROW:extension:metadata';

/** Parse the `geo` key out of an Arrow schema metadata map, if present. */
export function parseGeoMetadata(metadata: Map<string, string>): GeoMetadata | null {
  const raw = metadata.get('geo');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.primary_column !== 'string' || !parsed.columns) return null;
    return parsed as GeoMetadata;
  } catch {
    console.warn('emap formats: ignoring malformed GeoParquet "geo" metadata');
    return null;
  }
}

/** Build the `geo` metadata JSON string for one geometry column. */
export function buildGeoMetadata(opts: {
  columnName: string;
  encoding: GeoEncoding;
  geometryTypes: string[];
  bbox?: number[];
  crs?: unknown;
}): string {
  const column: GeoColumnMetadata & Record<string, unknown> = {
    encoding: opts.encoding,
    geometry_types: opts.geometryTypes,
  };
  if (opts.bbox && opts.bbox.every((v) => Number.isFinite(v))) column.bbox = opts.bbox;
  // GeoParquet: `crs: null` explicitly means OGC:CRS84 (lon/lat). Omitting
  // the key has the same default, but null is the spec's recommended form.
  column.crs = opts.crs ?? null;
  const geo: GeoMetadata = {
    version: '1.1.0',
    primary_column: opts.columnName,
    columns: { [opts.columnName]: column },
  };
  return JSON.stringify(geo);
}

/**
 * GeoArrow extension name (`geoarrow.point`, `geoarrow.wkb`, …) → encoding.
 * Returns null for non-geoarrow or unsupported extension names.
 */
export function encodingFromExtensionName(name: string | undefined): GeoEncoding | null {
  if (!name || !name.startsWith('geoarrow.')) return null;
  const sub = name.slice('geoarrow.'.length);
  if (sub === 'wkb') return 'WKB';
  if (
    sub === 'point' ||
    sub === 'linestring' ||
    sub === 'polygon' ||
    sub === 'multipoint' ||
    sub === 'multilinestring' ||
    sub === 'multipolygon'
  ) {
    return sub;
  }
  return null;
}

/** Encoding → GeoArrow extension name. */
export function extensionNameFromEncoding(encoding: GeoEncoding): string {
  return encoding === 'WKB' ? 'geoarrow.wkb' : `geoarrow.${encoding}`;
}

/**
 * Map a PROJJSON CRS object to emap's `dataset.info.crs_string` convention.
 * Only authority-coded CRSs translate ("EPSG:nnnn"); null/undefined means
 * OGC:CRS84, which emap treats as EPSG:4326 (axis order is lon/lat in both).
 */
export function projjsonToCrsString(crs: unknown): string | null {
  if (crs == null) return 'EPSG:4326';
  if (typeof crs !== 'object') return null;
  const id = (crs as { id?: { authority?: string; code?: number | string } }).id;
  if (id?.authority && id.code != null) {
    const authority = String(id.authority).toUpperCase();
    if (authority === 'OGC' && String(id.code).toUpperCase() === 'CRS84') return 'EPSG:4326';
    return `${authority}:${id.code}`;
  }
  console.warn('emap formats: geometry CRS has no authority id; leaving dataset CRS unset');
  return null;
}

/**
 * Map emap's `crs_string` to the GeoParquet `crs` value: null for 4326 /
 * CRS84 (the spec default), a minimal authority-id PROJJSON for other
 * EPSG codes, undefined (omit + warn) for anything unrecognized.
 */
export function crsStringToProjjson(crsString: string | undefined): unknown {
  if (!crsString) return null;
  const m = /^(EPSG|OGC):([\w]+)$/i.exec(crsString.trim());
  if (!m) {
    console.warn(`emap formats: cannot express CRS '${crsString}' as PROJJSON; omitting`);
    return undefined;
  }
  const authority = m[1].toUpperCase();
  const code = m[2];
  if ((authority === 'EPSG' && code === '4326') || (authority === 'OGC' && code === 'CRS84')) {
    return null;
  }
  // Minimal PROJJSON: authority id + name only (no `type` — we don't ship
  // a CRS database to know geographic vs projected). Readers that resolve
  // by authority code (GDAL, pyproj) handle this; strict validators may
  // warn. Better than omitting, which would imply the CRS84 default.
  return {
    name: `${authority}:${code}`,
    id: { authority, code: /^\d+$/.test(code) ? Number(code) : code },
  };
}

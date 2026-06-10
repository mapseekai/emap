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

const OGC_CRS84_PROJJSON = {
  $schema: 'https://proj.org/schemas/v0.5/projjson.schema.json',
  type: 'GeographicCRS',
  name: 'WGS 84 longitude-latitude',
  datum: {
    type: 'GeodeticReferenceFrame',
    name: 'World Geodetic System 1984',
    ellipsoid: {
      name: 'WGS 84',
      semi_major_axis: 6378137,
      inverse_flattening: 298.257223563,
    },
  },
  coordinate_system: {
    subtype: 'ellipsoidal',
    axis: [
      {
        name: 'Geodetic longitude',
        abbreviation: 'Lon',
        direction: 'east',
        unit: 'degree',
      },
      {
        name: 'Geodetic latitude',
        abbreviation: 'Lat',
        direction: 'north',
        unit: 'degree',
      },
    ],
  },
  id: {
    authority: 'OGC',
    code: 'CRS84',
  },
};

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
  // GeoParquet: a missing `crs` key means the default OGC:CRS84. `crs: null`
  // explicitly means the CRS is undefined/unknown, so only write a null when
  // the caller deliberately passes null.
  if (opts.crs !== undefined) column.crs = opts.crs;
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
 * Only authority-coded CRSs translate ("EPSG:nnnn"). A null CRS means
 * undefined/unknown in GeoParquet 1.1; a missing CRS key is handled by the
 * caller as the default OGC:CRS84.
 */
export function projjsonToCrsString(crs: unknown): string | null {
  if (crs == null) return null;
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
 * Map emap's `crs_string` to the GeoParquet `crs` value: a full OGC:CRS84
 * PROJJSON object for 4326 / CRS84, a minimal authority-id object for other
 * EPSG codes, null for anything unrecognized/unknown.
 */
export function crsStringToProjjson(crsString: string | undefined): unknown {
  if (!crsString) return null;
  const m = /^(EPSG|OGC):([\w]+)$/i.exec(crsString.trim());
  if (!m) {
    console.warn(`emap formats: cannot express CRS '${crsString}' as PROJJSON; marking unknown`);
    return null;
  }
  const authority = m[1].toUpperCase();
  const code = m[2];
  if ((authority === 'EPSG' && code === '4326') || (authority === 'OGC' && code === 'CRS84')) {
    return OGC_CRS84_PROJJSON;
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

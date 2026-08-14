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
  covering?: {
    bbox?: {
      xmin: string[];
      ymin: string[];
      xmax: string[];
      ymax: string[];
    };
    [key: string]: unknown;
  };
}

/** Parsed GeoParquet `geo` file metadata. */
export interface GeoMetadata {
  version?: string;
  primary_column: string;
  columns: Record<string, GeoColumnMetadata>;
}

export type CrsProjjsonLookup = (authority: string, code: string) => unknown | undefined;
export type CrsProjjsonAsyncLookup = (
  authority: string,
  code: string,
) => Promise<unknown | undefined>;

export interface CrsStringToProjjsonOptions {
  strict?: boolean;
}

export class GeoParquetCrsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoParquetCrsError';
  }
}

export const ARROW_EXTENSION_NAME = 'ARROW:extension:name';
export const ARROW_EXTENSION_METADATA = 'ARROW:extension:metadata';

/** Parse the `geo` key out of an Arrow schema metadata map, if present. */
const EPSG_3857_PROJJSON = {
  $schema: 'https://proj.org/schemas/v0.7/projjson.schema.json',
  type: 'ProjectedCRS',
  name: 'WGS 84 / Pseudo-Mercator',
  base_crs: {
    type: 'GeographicCRS',
    name: 'WGS 84',
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
        { name: 'Geodetic latitude', abbreviation: 'Lat', direction: 'north', unit: 'degree' },
        { name: 'Geodetic longitude', abbreviation: 'Lon', direction: 'east', unit: 'degree' },
      ],
    },
    id: { authority: 'EPSG', code: 4326 },
  },
  conversion: {
    name: 'Popular Visualisation Pseudo-Mercator',
    method: {
      name: 'Popular Visualisation Pseudo Mercator',
      id: { authority: 'EPSG', code: 1024 },
    },
    parameters: [
      {
        name: 'Latitude of natural origin',
        value: 0,
        unit: 'degree',
        id: { authority: 'EPSG', code: 8801 },
      },
      {
        name: 'Longitude of natural origin',
        value: 0,
        unit: 'degree',
        id: { authority: 'EPSG', code: 8802 },
      },
      { name: 'False easting', value: 0, unit: 'metre', id: { authority: 'EPSG', code: 8806 } },
      { name: 'False northing', value: 0, unit: 'metre', id: { authority: 'EPSG', code: 8807 } },
    ],
  },
  coordinate_system: {
    subtype: 'Cartesian',
    axis: [
      { name: 'Easting', abbreviation: 'X', direction: 'east', unit: 'metre' },
      { name: 'Northing', abbreviation: 'Y', direction: 'north', unit: 'metre' },
    ],
  },
  id: { authority: 'EPSG', code: 3857 },
};

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
  bboxColumn?: string;
}): string {
  const column: GeoColumnMetadata & Record<string, unknown> = {
    encoding: opts.encoding,
    geometry_types: opts.geometryTypes,
  };
  if (opts.bbox && opts.bbox.every((v) => Number.isFinite(v))) column.bbox = opts.bbox;
  if (opts.bboxColumn) {
    column.covering = {
      bbox: {
        xmin: [opts.bboxColumn, 'xmin'],
        ymin: [opts.bboxColumn, 'ymin'],
        xmax: [opts.bboxColumn, 'xmax'],
        ymax: [opts.bboxColumn, 'ymax'],
      },
    };
  }
  // GeoParquet: a missing `crs` key means the default OGC:CRS84. We still
  // write `crs:null` when the caller deliberately marks the export CRS as
  // unknown; the import path treats both forms as EPSG:4326 for compatibility.
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
 * Only authority-coded CRSs translate ("EPSG:nnnn"). A null CRS is treated
 * like the GeoParquet default CRS for import compatibility; a missing CRS key
 * is handled by the caller the same way.
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
 * Map emap's `crs_string` to the GeoParquet `crs` value. WGS84 lon/lat data
 * uses the GeoParquet default CRS by omitting the `crs` key, unknown labels
 * become `crs:null`, and non-default authority CRS values are written as
 * PROJJSON when possible.
 */
function unsupportedCrsResult(
  crsString: string,
  opts: CrsStringToProjjsonOptions | undefined,
): null {
  const message = `GeoParquet export cannot express CRS '${crsString}' as PROJJSON`;
  if (opts?.strict) throw new GeoParquetCrsError(message);
  console.warn(`emap formats: cannot express CRS '${crsString}' as PROJJSON; marking unknown`);
  return null;
}

function unresolvedEpsgResult(code: string, opts: CrsStringToProjjsonOptions | undefined): null {
  const message = `GeoParquet export requires PROJJSON for EPSG:${code}, but it could not be resolved`;
  if (opts?.strict) throw new GeoParquetCrsError(message);
  console.warn(`emap formats: EPSG:${code} PROJJSON not found; marking CRS unknown`);
  return null;
}

function parseCrsAuthorityCode(crsString: string): { authority: string; code: string } | null {
  const match = /^(EPSG|OGC):([\w:]+)$/i.exec(crsString.trim());
  if (!match) return null;
  return { authority: match[1].toUpperCase(), code: match[2] };
}

function isDefaultCrs(authority: string, code: string): boolean {
  return (
    (authority === 'EPSG' && code === '4326') ||
    (authority === 'OGC' && code.toUpperCase() === 'CRS84')
  );
}

export function crsStringToProjjson(
  crsString: string | undefined,
  lookup?: CrsProjjsonLookup,
  opts?: CrsStringToProjjsonOptions,
): unknown {
  if (!crsString) return null;
  const parsed = parseCrsAuthorityCode(crsString);
  if (!parsed) return unsupportedCrsResult(crsString, opts);
  const { authority, code } = parsed;
  if (isDefaultCrs(authority, code)) return undefined;

  // Built-in 3857 wins over the lookup: the curated constant avoids a
  // network fetch for the most common CRS (the async lookup falls back to
  // CDN resolution).
  if (authority === 'EPSG' && code === '3857') {
    return EPSG_3857_PROJJSON;
  }

  const resolved = lookup?.(authority, code);
  if (resolved !== undefined) return normalizeProjjsonForExport(resolved);

  if (authority === 'EPSG') {
    return unresolvedEpsgResult(code, opts);
  }

  return unsupportedCrsResult(crsString, opts);
}

export async function crsStringToProjjsonAsync(
  crsString: string | undefined,
  lookup?: CrsProjjsonAsyncLookup,
  opts?: CrsStringToProjjsonOptions,
): Promise<unknown> {
  if (!crsString) return null;
  const parsed = parseCrsAuthorityCode(crsString);
  if (!parsed) return unsupportedCrsResult(crsString, opts);
  const { authority, code } = parsed;
  if (isDefaultCrs(authority, code)) return undefined;

  // See crsStringToProjjson: built-in 3857 constant before any lookup.
  if (authority === 'EPSG' && code === '3857') {
    return EPSG_3857_PROJJSON;
  }

  const resolved = await lookup?.(authority, code);
  if (resolved !== undefined) return normalizeProjjsonForExport(resolved);

  if (authority === 'EPSG') {
    return unresolvedEpsgResult(code, opts);
  }

  return unsupportedCrsResult(crsString, opts);
}

function normalizeProjjsonForExport(value: unknown): unknown {
  return replaceDatumEnsembles(value);
}

function replaceDatumEnsembles(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(replaceDatumEnsembles);
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(input)) {
    if (key !== 'datum_ensemble') out[key] = replaceDatumEnsembles(child);
  }

  if (!('datum' in out) && input.datum_ensemble && typeof input.datum_ensemble === 'object') {
    const ensemble = input.datum_ensemble as Record<string, unknown>;
    out.datum = replaceDatumEnsembles({
      type: 'GeodeticReferenceFrame',
      name: datumNameFromEnsemble(ensemble.name),
      ellipsoid: ensemble.ellipsoid,
    });
  }

  return out;
}

function datumNameFromEnsemble(name: unknown): unknown {
  if (typeof name !== 'string') return name;
  return name.replace(/\s+ensemble$/i, '');
}

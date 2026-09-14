import type { Table } from 'apache-arrow';
import {
  ARROW_EXTENSION_NAME,
  encodingFromExtensionName,
  parseGeoMetadata,
  projjsonToCrsString,
  type GeoEncoding,
} from './geoparquet-metadata';

/** Resolved geometry column of an Arrow table. */
export interface GeometryColumnInfo {
  fieldIndex: number;
  name: string;
  encoding: GeoEncoding;
  /** emap crs_string ('EPSG:nnnn') or null when unknown/unset. */
  crsString: string | null;
}

/** Column names the heuristic fallback accepts as a WKB geometry column. */
const GEOMETRY_NAME_HINTS = ['geometry', 'geom', 'wkb_geometry', 'wkb'];

/**
 * Locate the geometry column. Detection precedence:
 * 1. GeoParquet `geo` schema metadata (`primary_column` + per-column encoding)
 * 2. A field whose `ARROW:extension:name` starts with `geoarrow.`
 * 3. Heuristic: a Binary-typed column named geometry/geom/wkb_geometry/wkb —
 *    the shape DuckDB's `ST_AsWKB(...)` results arrive in.
 *
 * `geometryColumn` (when supplied) overrides the column *name* but encoding
 * detection still runs against that field.
 */
export function detectGeometryColumn(
  table: Table,
  geometryColumn?: string,
): GeometryColumnInfo | null {
  const fields = table.schema.fields;
  const geo = parseGeoMetadata(table.schema.metadata);

  const findIndex = (name: string) => fields.findIndex((f) => f.name === name);

  // Explicit caller override
  if (geometryColumn) {
    const idx = findIndex(geometryColumn);
    if (idx === -1) {
      throw new Error(`Geometry column '${geometryColumn}' not found in table`);
    }
    return describeField(table, idx, geo?.columns[geometryColumn]);
  }

  // 1. GeoParquet geo metadata
  if (geo) {
    const idx = findIndex(geo.primary_column);
    if (idx !== -1) {
      return describeField(table, idx, geo.columns[geo.primary_column]);
    }
  }

  // 2. geoarrow extension metadata
  for (let i = 0; i < fields.length; i++) {
    const extName = fields[i].metadata.get(ARROW_EXTENSION_NAME);
    if (extName?.startsWith('geoarrow.')) {
      return describeField(table, i, undefined);
    }
  }

  // 3. name + Binary type heuristic (duckdb ST_AsWKB bridge)
  for (const hint of GEOMETRY_NAME_HINTS) {
    const idx = fields.findIndex((f) => f.name.toLowerCase() === hint);
    if (idx !== -1 && isBinaryField(table, idx)) {
      return {
        fieldIndex: idx,
        name: fields[idx].name,
        encoding: 'WKB',
        crsString: null,
      };
    }
  }

  return null;
}

function isBinaryField(table: Table, idx: number): boolean {
  const type = table.schema.fields[idx].type;
  const name = type.toString().toLowerCase();
  return name.startsWith('binary') || name.startsWith('largebinary');
}

function describeField(
  table: Table,
  idx: number,
  geoColumn: { encoding?: unknown; crs?: unknown } | undefined,
): GeometryColumnInfo {
  const field = table.schema.fields[idx];

  // Encoding: geo metadata wins, then extension name, then Binary→WKB.
  let encoding: GeoEncoding | null = null;
  const declaredEncoding = geoColumn?.encoding;
  if (declaredEncoding !== undefined) {
    if (
      declaredEncoding === 'WKB' ||
      declaredEncoding === 'point' ||
      declaredEncoding === 'linestring' ||
      declaredEncoding === 'polygon' ||
      declaredEncoding === 'multipoint' ||
      declaredEncoding === 'multilinestring' ||
      declaredEncoding === 'multipolygon'
    ) {
      encoding = declaredEncoding;
    } else {
      throw new Error(
        `Unsupported geometry encoding '${String(declaredEncoding)}' for column '${field.name}'`,
      );
    }
  }
  if (!encoding) {
    const extName = field.metadata.get(ARROW_EXTENSION_NAME);
    encoding = encodingFromExtensionName(extName);
    if (!encoding && extName?.startsWith('geoarrow.')) {
      throw new Error(`Unsupported GeoArrow extension '${extName}' for column '${field.name}'`);
    }
  }
  if (!encoding && isBinaryField(table, idx)) {
    encoding = 'WKB';
  }
  if (!encoding) {
    throw new Error(
      `Cannot determine geometry encoding for column '${field.name}' ` +
        `(no geo metadata, no geoarrow extension type, not a Binary column)`,
    );
  }

  // CRS: geo metadata's PROJJSON, else geoarrow extension metadata's crs.
  // Missing `crs` uses GeoParquet's default OGC:CRS84. For compatibility with
  // existing files, explicit `crs:null` is also read as the default CRS.
  let crsString: string | null = null;
  if (geoColumn && 'crs' in geoColumn) {
    crsString = projjsonToCrsString(geoColumn.crs);
  } else if (geoColumn) {
    crsString = 'EPSG:4326';
  } else {
    const extMeta = field.metadata.get('ARROW:extension:metadata');
    if (extMeta) {
      try {
        const parsed = JSON.parse(extMeta);
        if (parsed && 'crs' in parsed) crsString = projjsonToCrsString(parsed.crs);
      } catch {
        // tolerate malformed extension metadata
      }
    }
  }

  return { fieldIndex: idx, name: field.name, encoding, crsString };
}

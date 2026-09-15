import { assertNotAborted } from './types';
import type { ImportGeoPackageOptions } from './types';

type Cell = string | number | bigint | Uint8Array | null;
interface Statement {
  bind(params: readonly Cell[]): boolean;
  step(): boolean;
  get(params?: null, config?: { useBigInt: boolean }): Cell[];
  free(): boolean;
}
interface Database {
  prepare(sql: string): Statement;
  run(sql: string): unknown;
}
/** @internal Narrow SQLite WASM boundary: no feature objects, rendering, or native SQLite. */
export interface GeoPackageSqlite {
  rows(sql: string, params?: readonly Cell[]): IterableIterator<Cell[]>;
  close(): void;
}
let ready:
  | Promise<typeof import('@ngageoint/geopackage/dist/lib/db/sqljsAdapter.js').SqljsAdapter>
  | undefined;

/** The upstream compiled WASM module is reused, but every import owns a separate database. */
export async function openGeoPackageSqlite(
  bytes: Uint8Array,
  options: ImportGeoPackageOptions,
): Promise<GeoPackageSqlite> {
  assertNotAborted(options.signal);
  ready ??= import('@ngageoint/geopackage/dist/lib/db/sqljsAdapter.js')
    .then(async ({ SqljsAdapter }) => {
      // Explicit low-level import avoids the package's Canvas, wkx and GeoJSON APIs.
      SqljsAdapter.setSqljsWasmLocateFile(() => options.wasmUrl ?? 'sql-wasm.wasm');
      const probe = await new SqljsAdapter().initialize();
      probe.close();
      return SqljsAdapter;
    })
    .catch((error) => {
      ready = undefined;
      throw error;
    });
  const Adapter = await ready;
  assertNotAborted(options.signal);
  const adapter = await new Adapter(bytes).initialize();
  const db = adapter.getDBConnection() as Database;
  try {
    db.run('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
  } catch (error) {
    adapter.close();
    throw error;
  }
  let closed = false;
  return {
    *rows(sql, params = []) {
      if (closed) throw new Error('GeoPackage database has been closed');
      const statement = db.prepare(sql);
      try {
        if (params.length) statement.bind(params);
        while (statement.step()) yield statement.get(null, { useBigInt: true });
      } finally {
        statement.free();
      }
    },
    close() {
      if (!closed) {
        closed = true;
        adapter.close();
      }
    },
  };
}

export function quoteIdentifier(name: string): string {
  if (!name || name.includes('\0')) throw new Error('Invalid GeoPackage SQL identifier');
  return '"' + name.replaceAll('"', '""') + '"';
}
export function asInteger(value: Cell | undefined, label: string): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number))
    throw new Error(`Invalid GeoPackage ${label}`);
  return number;
}
export function asText(value: Cell | undefined, label: string): string {
  if (typeof value !== 'string' || !value.length) throw new Error(`Invalid GeoPackage ${label}`);
  return value;
}
export interface GeoPackageColumn {
  name: string;
  type: string;
  primary: number;
}
export interface GeoPackageTable {
  name: string;
  column: string;
  geometryType: string;
  srs: number;
  crs?: string;
  columns: GeoPackageColumn[];
  order: string;
}

export function readFeatureTables(
  db: GeoPackageSqlite,
  options: ImportGeoPackageOptions,
  maxLayers: number,
): GeoPackageTable[] {
  const id = asInteger([...db.rows('PRAGMA application_id')][0]?.[0], 'application_id');
  if (id !== 0x47504b47 && id !== 0x47503130)
    throw new Error('Not a GeoPackage database (application_id)');
  const featureRows = [
    ...db.rows(`SELECT c.table_name, g.column_name, g.geometry_type_name, g.srs_id, c.srs_id
    FROM gpkg_contents c LEFT JOIN gpkg_geometry_columns g ON c.table_name = g.table_name
    WHERE c.data_type = 'features' ORDER BY c.table_name LIMIT ${maxLayers + 1}`),
  ];
  if (featureRows.length > maxLayers) throw new RangeError('GeoPackage layer limit exceeded');
  if (
    options.layers &&
    (!options.layers.length || new Set(options.layers).size !== options.layers.length)
  )
    throw new Error('GeoPackage layers must be a non-empty unique list');
  const selected = options.layers
    ? options.layers.map((name) => {
        const row = featureRows.find((row) => row[0] === name);
        if (!row) throw new Error(`GeoPackage feature table not found: ${name}`);
        return row;
      })
    : featureRows;
  const wkt2 = [...db.rows('PRAGMA table_info(gpkg_spatial_ref_sys)')].some(
    (row) => row[1] === 'definition_12_063',
  );
  const names = new Set<string>();
  return selected.map((row) => {
    const name = asText(row[0], 'table name');
    if (names.has(name)) throw new Error(`Multiple geometry columns in ${name}`);
    names.add(name);
    const column = asText(row[1], `geometry column for ${name}`);
    const geometryType = asText(row[2], 'geometry type').toUpperCase();
    if (
      ![
        'POINT',
        'MULTIPOINT',
        'LINESTRING',
        'MULTILINESTRING',
        'POLYGON',
        'MULTIPOLYGON',
        'GEOMETRY',
        'GEOMETRYCOLLECTION',
      ].includes(geometryType)
    )
      throw new Error(`Unsupported GeoPackage geometry type ${geometryType} in ${name}`);
    const srs = asInteger(row[3], 'SRS id');
    if (asInteger(row[4], 'contents SRS id') !== srs)
      throw new Error(`Conflicting GeoPackage SRS metadata in ${name}`);
    const columns = [...db.rows(`PRAGMA table_info(${quoteIdentifier(name)})`)].map((info) => ({
      name: asText(info[1], 'column name'),
      type: String(info[2] ?? '').toUpperCase(),
      primary: asInteger(info[5], 'primary key'),
    }));
    if (!columns.some((field) => field.name === column))
      throw new Error(`Geometry column not found in ${name}`);
    const primary = columns.find((field) => field.primary === 1) ?? columns[0];
    if (!primary) throw new Error(`No columns found in ${name}`);
    const metadata = [
      ...db.rows(
        `SELECT organization, organization_coordsys_id, definition${wkt2 ? ', definition_12_063' : ''} FROM gpkg_spatial_ref_sys WHERE srs_id = ?`,
        [srs],
      ),
    ][0];
    if (!metadata) throw new Error(`Missing GeoPackage SRS definition ${srs}`);
    let crs = Object.hasOwn(options.sourceCrs ?? {}, name) ? options.sourceCrs![name] : undefined;
    if (!crs && srs !== 0 && srs !== -1) {
      if (String(metadata[0]).toUpperCase() === 'EPSG' && asInteger(metadata[1], 'EPSG code') > 0)
        crs = `EPSG:${metadata[1]}`;
      else {
        const definition = [metadata[3], metadata[2]].find(
          (value) =>
            typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'undefined',
        );
        if (definition) crs = String(definition);
      }
    }
    return { name, column, geometryType, srs, crs, columns, order: quoteIdentifier(primary.name) };
  });
}

import { readFile } from 'node:fs/promises';
import { SqljsAdapter } from '@ngageoint/geopackage/dist/lib/db/sqljsAdapter.js';

export function wkb(type: number, values: number[] | Uint8Array[], little = true): Uint8Array {
  const bytes = new Uint8Array(
    5 +
      values.reduce<number>(
        (size, item) => size + (item instanceof Uint8Array ? item.byteLength : 8),
        0,
      ),
  );
  const view = new DataView(bytes.buffer);
  bytes[0] = Number(little);
  view.setUint32(1, type, little);
  let offset = 5;
  for (const item of values) {
    if (item instanceof Uint8Array) {
      bytes.set(item, offset);
      offset += item.length;
    } else {
      view.setFloat64(offset, item, little);
      offset += 8;
    }
  }
  return bytes;
}
export function count(value: number, little = true): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, little);
  return bytes;
}
export function coordinates(values: number[][], little = true): Uint8Array {
  const bytes = new Uint8Array(values.reduce((n, point) => n + point.length * 8, 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const point of values)
    for (const value of point) {
      view.setFloat64(offset, value, little);
      offset += 8;
    }
  return bytes;
}
export function line(points: number[][], little = true, dimension = 0): Uint8Array {
  return wkb(
    2 + dimension * 1000,
    [count(points.length, little), coordinates(points, little)],
    little,
  );
}
export function polygon(rings: number[][][], little = true, dimension = 0): Uint8Array {
  return wkb(
    3 + dimension * 1000,
    [
      count(rings.length, little),
      ...rings.flatMap((ring) => [count(ring.length, little), coordinates(ring, little)]),
    ],
    little,
  );
}
export function collection(type: number, geometries: Uint8Array[], little = true): Uint8Array {
  return wkb(type, [count(geometries.length, little), ...geometries], little);
}
export function gpkg(
  geometry: Uint8Array,
  srs = 4326,
  envelope = 0,
  little = true,
  empty = false,
): Uint8Array {
  const header = 8 + [0, 4, 6, 6, 8][envelope] * 8;
  const bytes = new Uint8Array(header + geometry.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x47;
  bytes[1] = 0x50;
  bytes[3] = Number(little) | (envelope << 1) | (empty ? 0x10 : 0);
  view.setInt32(4, srs, little);
  bytes.set(geometry, header);
  return bytes;
}
export interface FixtureTable {
  name: string;
  type: string;
  srs?: number;
  rows: Array<{
    id?: number | bigint;
    geometry: Uint8Array | null;
    values?: Record<string, unknown>;
  }>;
  columns?: Record<string, string>;
  srsOrganization?: string;
  srsOrganizationCode?: number;
  srsDefinition?: string;
}
let wasm: Promise<string> | undefined;
export function testGeoPackageWasmUrl(): Promise<string> {
  return (wasm ??= readFile(
    new URL('../../node_modules/@ngageoint/geopackage/dist/sql-wasm.wasm', import.meta.url),
  ).then((bytes) => 'data:application/wasm;base64,' + bytes.toString('base64')));
}
function quoted(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"';
}

/** Real SQLite GeoPackage fixture, written without either GeoJSON or the production decoder. */
export async function fixtureGeoPackage(
  tables: FixtureTable[],
  addNonVectors = true,
): Promise<Uint8Array> {
  SqljsAdapter.setSqljsWasmLocateFile(() => 'unused');
  const url = await testGeoPackageWasmUrl();
  SqljsAdapter.setSqljsWasmLocateFile(() => url);
  const adapter = await new SqljsAdapter().initialize();
  try {
    const db = adapter.getDBConnection();
    db.run(`PRAGMA application_id=1196444487;
      PRAGMA user_version=10400;
      CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT, organization_coordsys_id INTEGER, definition TEXT, description TEXT);
      CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT, identifier TEXT, description TEXT, last_change TEXT, min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
      CREATE TABLE gpkg_geometry_columns (table_name TEXT PRIMARY KEY, column_name TEXT, geometry_type_name TEXT, srs_id INTEGER, z INTEGER, m INTEGER);`);
    for (const srs of new Set([
      0,
      -1,
      4326,
      3857,
      4490,
      ...tables.map((table) => table.srs ?? 4326),
    ])) {
      db.run('INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)', [
        `SRS ${srs}`,
        srs,
        srs > 0 ? 'EPSG' : 'NONE',
        srs,
        'undefined',
        'fixture',
      ]);
    }
    for (const table of tables) {
      if (table.srsDefinition || table.srsOrganization || table.srsOrganizationCode !== undefined) {
        const srs = table.srs ?? 4326;
        db.run(
          'UPDATE gpkg_spatial_ref_sys SET organization = ?, organization_coordsys_id = ?, definition = ? WHERE srs_id = ?',
          [
            table.srsOrganization ?? (srs > 0 ? 'EPSG' : 'NONE'),
            table.srsOrganizationCode ?? srs,
            table.srsDefinition ?? 'undefined',
            srs,
          ],
        );
      }
      const columns = { name: 'TEXT', ...table.columns };
      db.run(
        `CREATE TABLE ${quoted(table.name)} (fid INTEGER PRIMARY KEY, geom ${table.type}, ${Object.entries(
          columns,
        )
          .map(([name, type]) => `${quoted(name)} ${type}`)
          .join(', ')})`,
      );
      db.run(
        'INSERT INTO gpkg_contents(table_name, data_type, identifier, description, last_change, srs_id) VALUES (?, ?, ?, ?, ?, ?)',
        [table.name, 'features', table.name, '', '2026-01-01T00:00:00.000Z', table.srs ?? 4326],
      );
      db.run('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, 2, 2)', [
        table.name,
        'geom',
        table.type,
        table.srs ?? 4326,
      ]);
      for (const [index, row] of table.rows.entries()) {
        const values = [
          row.id ?? index + 1,
          row.geometry,
          ...Object.keys(columns).map((name) => row.values?.[name] ?? null),
        ];
        const params: unknown[] = [];
        const bindings = values.map((value) => {
          if (typeof value === 'bigint') return value.toString();
          params.push(value);
          return '?';
        });
        db.run(`INSERT INTO ${quoted(table.name)} VALUES (${bindings.join(', ')})`, params);
      }
    }
    if (addNonVectors)
      db.run(`CREATE TABLE raster_tiles(tile_data BLOB); CREATE TABLE metadata_only(value TEXT);
      INSERT INTO gpkg_contents(table_name,data_type) VALUES ('raster_tiles','tiles'), ('metadata_only','attributes');`);
    return await adapter.export();
  } finally {
    adapter.close();
  }
}

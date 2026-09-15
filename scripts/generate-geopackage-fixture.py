"""Generate a small vector-only GeoPackage fixture without a GeoJSON intermediate."""
from pathlib import Path
import sqlite3
import struct

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'packages/examples/public/fixtures/example-geopackage.gpkg'


def u32(value):
    return struct.pack('<I', value)


def point(x, y):
    return b'\x01' + u32(1) + struct.pack('<dd', x, y)


def line(points):
    return b'\x01' + u32(2) + u32(len(points)) + b''.join(struct.pack('<dd', *p) for p in points)


def polygon(rings):
    return b'\x01' + u32(3) + u32(len(rings)) + b''.join(u32(len(r)) + b''.join(struct.pack('<dd', *p) for p in r) for r in rings)


def blob(wkb):
    return b'GP\x00\x01' + struct.pack('<i', 4326) + wkb


if __name__ == '__main__':
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    if TARGET.exists():
        TARGET.unlink()
    with sqlite3.connect(TARGET) as db:
        db.executescript("""
        PRAGMA application_id=1196444487;
        PRAGMA user_version=10400;
        CREATE TABLE gpkg_spatial_ref_sys(srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY,
          organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
        CREATE TABLE gpkg_contents(table_name TEXT PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE,
          description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT '2026-01-01T00:00:00.000Z',
          min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
        CREATE TABLE gpkg_geometry_columns(table_name TEXT NOT NULL, column_name TEXT NOT NULL,
          geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL,
          PRIMARY KEY(table_name,column_name));
        """)
        wkt = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'
        db.executemany('INSERT INTO gpkg_spatial_ref_sys VALUES(?,?,?,?,?,?)', [
            ('Undefined Cartesian', -1, 'NONE', -1, 'undefined', ''),
            ('Undefined geographic', 0, 'NONE', 0, 'undefined', ''),
            ('WGS 84', 4326, 'EPSG', 4326, wkt, ''),
        ])
        tables = [('areas', 'POLYGON'), ('roads', 'MULTILINESTRING'), ('places', 'POINT'), ('empty_lines', 'LINESTRING')]
        for name, kind in tables:
            db.execute(f'CREATE TABLE "{name}"(fid INTEGER PRIMARY KEY, geom {kind}, name TEXT, category TEXT)')
            db.execute('INSERT INTO gpkg_contents(table_name,data_type,identifier,srs_id) VALUES(?,?,?,?)', (name,'features',name,4326))
            db.execute('INSERT INTO gpkg_geometry_columns VALUES(?,?,?,?,0,0)', (name,'geom',kind,4326))
        shell = [(116.30,39.90),(116.36,39.90),(116.36,39.94),(116.30,39.94),(116.30,39.90)]
        hole = [(116.32,39.91),(116.32,39.925),(116.34,39.925),(116.34,39.91),(116.32,39.91)]
        db.execute('INSERT INTO areas VALUES(?,?,?,?)',(1,blob(polygon([shell,hole])),'含洞片区','service-area'))
        roads = b'\x01' + u32(5) + u32(2) + line([(116.30,39.90),(116.36,39.90)]) + line([(116.29,39.93),(116.37,39.95)])
        db.execute('INSERT INTO roads VALUES(?,?,?,?)',(1,blob(roads),'多部件道路','road'))
        db.executemany('INSERT INTO places VALUES(?,?,?,?)',[
            (1,blob(point(116.31,39.93)),'站点 A','station'),
            (2,blob(point(116.35,39.905)),'站点 B','station'),
            (3,None,'无几何记录','attribute-preserved'),
            (9223372036854775807,blob(point(116.3456789012345,39.9312345678901)),'64 位 ID','precision'),
        ])
    print(TARGET, TARGET.stat().st_size)

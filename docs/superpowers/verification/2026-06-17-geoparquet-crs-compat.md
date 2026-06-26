# GeoParquet CRS Compatibility Verification

Date: 2026-06-17

## Automated Commands

Run from `/Users/zhang/code/emap`:

```bash
npm run test:run -- src/formats/geoparquet-metadata.test.ts src/formats/epsg-projjson.test.ts src/formats/dataset-to-table.test.ts src/formats/geoparquet-io.test.ts src/source/topology-source.test.ts
npm run test:duckdb
npm run typecheck
npm run build
npm pack --dry-run
```

## GDAL Smoke

Generate or reuse CRS84, EPSG:3857, and EPSG:4490 GeoParquet samples from the test harness, then run:

```bash
ogrinfo -al -so /absolute/path/to/crs84.parquet
ogrinfo -al -so /absolute/path/to/epsg3857.parquet
ogrinfo -al -so /absolute/path/to/epsg4490.parquet
```

Expected observations:
- Driver reports Parquet or GeoParquet.
- Geometry column is present.
- Feature count matches the sample.
- Extent matches the sample coordinates.
- EPSG:3857 and EPSG:4490 samples report a CRS.

## DuckDB Smoke

Run with DuckDB spatial and parquet extensions enabled:

```sql
INSTALL spatial;
INSTALL parquet;
LOAD spatial;
LOAD parquet;
SELECT count(*) FROM read_parquet('/absolute/path/to/epsg3857.parquet');
SELECT ST_GeometryType(geometry) FROM read_parquet('/absolute/path/to/epsg3857.parquet') LIMIT 1;
```

Expected observations:
- Row count matches the sample.
- Geometry values are readable.
- Attribute columns are present.

## QGIS Smoke

Open each sample in QGIS:
- Layer loads without a repair prompt.
- CRS is shown as expected.
- Attributes are visible.
- Geometry appears in the expected location.

Verification:
- Run a placeholder scan on the new file for `TBD|TODO|FIXME|???`.
- GitNexus detect_changes staged should be low/no symbols.

Commit:
- Suggested subject: `Document GeoParquet compatibility verification`
- Use `git add -f docs/superpowers/verification/2026-06-17-geoparquet-crs-compat.md` because docs/superpowers is ignored.

Report:
- Status
- File created
- Verification
- Commit hash

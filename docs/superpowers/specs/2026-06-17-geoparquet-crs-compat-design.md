# GeoParquet CRS Compatibility Design

Date: 2026-06-17

## Context

The DuckDB integration branch already includes the optional
`@zwishing/emap/duckdb` runtime, geometry operations, attribute operations,
relation operations, map-op adapters, examples, and integration tests.

The remaining work in this pass is not a new DuckDB spatial operation. It is
the format bridge needed for DuckDB, GDAL, QGIS, and other GeoParquet readers
to interpret exported datasets consistently:

- GeoParquet 1.1 metadata must identify the geometry column, CRS, geometry
  types, extent, and bbox covering column.
- Known CRS identifiers must be represented as proper PROJJSON, not lossy
  strings.
- Export must preserve coordinates by default; it must not silently reproject
  datasets to CRS84.
- Imports of formats with specification-implied WGS84 coordinates should not
  be treated as unknown CRS when mapshaper omits CRS metadata.

## Goals

- Make GeoParquet export standards-first and externally verifiable.
- Preserve original coordinates and CRS by default.
- Write complete PROJJSON for known EPSG CRS values.
- Fail export for known CRS values that cannot be expressed as GeoParquet CRS
  metadata.
- Add GeoParquet 1.1 bbox covering metadata by default.
- Keep the implementation isolated to the formats and source import boundary.
- Validate output against GDAL, DuckDB, and a manual QGIS smoke test.

## Non-Goals

- No new DuckDB spatial operation in this change.
- No public arbitrary SQL or additional DuckDB runtime surface.
- No default coordinate reprojection during GeoParquet export.
- No bundled full EPSG PROJJSON table in the main package.
- No automated QGIS dependency requirement.
- No silent downgrade from known EPSG to unknown CRS.

## Decisions

### Compatibility Priority

GeoParquet standard compatibility takes priority over offline convenience.
The export path should generate files that GDAL, QGIS, and DuckDB can read with
correct geometry and CRS metadata.

### CRS Policy

Default export behavior keeps source coordinates unchanged.

- `EPSG:4326` and `OGC:CRS84` use the GeoParquet default CRS84 behavior.
- `EPSG:3857` uses an in-tree stable PROJJSON object.
- Other known EPSG codes resolve to complete PROJJSON through
  `@zwishing/epsg-index` assets.
- If a known EPSG CRS cannot be resolved, export fails.
- Custom Proj4 strings and unknown CRS labels are not converted to fake CRS
  objects. In the strict default mode, export fails with a clear message.

If a future workflow needs lossy exports, it can add an explicit option such as
`allowUnknownCrs: true`. That is outside this change.

### PROJJSON Loading

The default resolver may fetch PROJJSON from the published
`@zwishing/epsg-index` asset base URL. It must also accept injected `fetch` and
`baseUrl` options so tests, self-hosted deployments, and offline app shells can
control where CRS assets come from.

Fetch failures, non-OK responses, malformed JSON, or missing records for known
EPSG codes fail the export.

### BBox Covering

GeoParquet export writes a bbox covering column by default.

- Default column name: `bbox`.
- If a dataset already has a `bbox` field, choose a unique suffix such as
  `bbox_1`.
- GeoParquet metadata must point to the actual covering column and struct
  fields.
- Callers may disable this with `bboxColumn: false`.

Global bbox metadata should still be written when geometry bounds are known.

### Spec-Implied Import CRS

`TopologySource` should mark imports as `EPSG:4326` only when the file format
specification implies WGS84 lon/lat and mapshaper did not provide any CRS
metadata.

Covered formats:

- GeoJSON
- TopoJSON
- JSON inputs interpreted as GeoJSON/TopoJSON
- KML

Existing `.prj`, `crs_string`, or parsed mapshaper CRS metadata must not be
overwritten.

## Architecture

This change stays within existing boundaries:

```text
TopologySource import
  -> infer spec-implied CRS only when metadata is absent
  -> MapshaperDataset
  -> exportGeoParquet()
  -> resolveDatasetCRSMetadata()
  -> resolve full PROJJSON for known CRS
  -> toArrowTable()
  -> add geometry, attributes, bbox covering
  -> build GeoParquet 1.1 metadata
  -> strip Arrow extension field metadata for Parquet container compatibility
  -> parquet-wasm writeParquet()
```

### `TopologySource`

`TopologySource` owns file import lifecycle, so it is the right boundary for
format-implied CRS defaults. It should set `dataset.info.crs_string =
'EPSG:4326'` only after import succeeds and only when no CRS metadata exists.

### `dataset-to-table`

`toArrowTable()` owns conversion from mapshaper geometry and attributes to
Arrow columns. It should:

- Preserve source coordinates by default.
- Build geometry extension metadata for Arrow/GeoArrow paths.
- Provide geometry type lists from actual per-feature output.
- Build optional bbox covering struct columns.
- Pass resolved CRS metadata into GeoParquet metadata generation.

### `geoparquet-metadata`

This module owns the GeoParquet `geo` JSON object. It should:

- Include `version: "1.1.0"`.
- Set the primary geometry column.
- Include encoding, geometry types, global bbox, CRS, and covering metadata.
- Normalize known PROJJSON values where required for external compatibility.

### `epsg-projjson`

This module owns EPSG-to-PROJJSON resolution. It should:

- Keep the local generated table compact by storing asset paths instead of
  entire PROJJSON objects.
- Fetch complete PROJJSON definitions on demand.
- Cache successes and failures by URL.
- Return a distinct failure state for known-but-unresolved EPSG codes so export
  can fail instead of marking the CRS unknown.

### `geoparquet-io`

`exportGeoParquet()` orchestrates the export policy:

- Resolve CRS before table construction.
- Apply strict CRS failure rules.
- Default to WKB encoding and bbox covering.
- Remove Arrow extension field metadata before writing Parquet when needed for
  GDAL/libarrow compatibility.
- Keep GeoParquet file metadata as the source of geometry/CRS truth.

## Error Handling

Export should fail before writing bytes when:

- A known EPSG CRS has no resolvable PROJJSON.
- CRS asset fetch fails.
- CRS asset response is not OK.
- CRS asset JSON cannot be parsed.
- A custom or unknown CRS label cannot be expressed as PROJJSON under strict
  default policy.
- Parquet compression is unsupported.

Errors should name the CRS and the resolution source when possible. The failure
should be actionable for app developers: provide `baseUrl`, inject `fetch`, or
use a supported CRS.

Warnings are acceptable only for test cases or future explicit lossy modes.
The default standard-compatible export should not silently write unknown CRS
for known CRS input.

## External Acceptance

### GDAL

Use `ogrinfo` on exported sample files to confirm:

- Driver recognizes the file as Parquet/GeoParquet.
- Geometry column is present.
- Feature count is correct.
- Extent is correct.
- CRS is reported for non-CRS84 known EPSG exports.

### DuckDB

Use DuckDB spatial/parquet reads to confirm:

- Geometry values are readable.
- Feature count and attributes round-trip.
- Relation/geometry operations can consume exported fixtures without losing
  geometry metadata.

### QGIS

Manual release smoke test:

- Open exported GeoParquet samples.
- Confirm layer loads without a repair prompt.
- Confirm CRS is shown correctly.
- Confirm attributes are present.
- Confirm geometry appears in the expected location.

QGIS remains manual for this change; missing local QGIS must not block unit
tests or CI.

## Test Plan

Unit tests:

- GeoJSON/TopoJSON/KML imports set `EPSG:4326` only when no CRS metadata exists.
- Existing CRS metadata is preserved on import.
- `toArrowTable()` writes bbox covering columns and resolves name collisions.
- Geometry type metadata reflects actual single/multi feature output.
- `EPSG:3857` writes complete PROJJSON without network access.
- Other known EPSG values fetch PROJJSON through injected `fetch`.
- Known EPSG fetch failure rejects export.
- Custom/unknown CRS labels reject export in strict mode.
- `bboxColumn: false` disables covering metadata.
- Parquet export strips Arrow extension field metadata while retaining
  GeoParquet `geo` file metadata.

Integration or fixture tests:

- Export a CRS84/4326 sample and verify default CRS metadata behavior.
- Export an EPSG:3857 sample and verify coordinates are unchanged while CRS is
  written.
- Export an EPSG:4490 sample through mocked asset fetch and verify PROJJSON is
  written.
- Round-trip GeoParquet import/export retains geometry, attributes, and CRS
  metadata.

External manual checks:

- Run GDAL `ogrinfo` on generated samples.
- Run DuckDB spatial read queries on generated samples.
- Open generated samples in QGIS and record pass/fail notes.

## Implementation Order

1. Finalize strict CRS resolution semantics in `epsg-projjson` and
   `geoparquet-metadata`.
2. Finalize `toArrowTable()` bbox covering, geometry type, and CRS metadata
   wiring.
3. Finalize `exportGeoParquet()` default policy and field metadata stripping.
4. Finalize `TopologySource` spec-implied CRS defaults.
5. Add or update focused unit tests for each policy.
6. Add external verification notes or helper fixtures for GDAL, DuckDB, and
   QGIS manual smoke testing.
7. Run full format tests, DuckDB integration tests, typecheck, build, and
   package dry-run before release.

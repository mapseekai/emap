---
id: geopackage
slug: /data/geopackage
title: Direct GeoPackage vector import
api: ["importGeoPackage", "importGeoPackageInWorker", "geoPackagePlugin", "ImportGeoPackageOptions", "GeoPackageWorkerOptions", "GeoPackagePluginOptions", "GeoPackageLimits", "GeoPackageProgress", "GeoPackageDataset", "GeoPackageMetadata", "GeoPackageTableMetadata"]
examples: ["geopackage-viewer"]
stability: experimental
verifiedVersion: unreleased
---

# Direct GeoPackage vector import

`@mapseekai/emap/geopackage` uses the SQL.js/WASM adapter from `@ngageoint/geopackage@4.2.9`. It does not call that library's GeoJSON, wkx geometry-object, tile, or image APIs. The conversion reads GP Binary/WKB directly into numeric buffers.

```text
.gpkg bytes → SQLite WASM / prepared statements
  → gpkg_contents + gpkg_geometry_columns + gpkg_spatial_ref_sys
  → GP Binary header / WKB → Float64Array XY + Int32Array arc lengths
  → layers + DataTable + one shared ArcCollection → one dataset
```

All selected `data_type = 'features'` tables remain separate named layers within **one dataset**. Tile/raster and attribute-only tables are excluded. A tile-only package is rejected explicitly. This API never creates one independent dataset or Source per feature table.

## Installation and assets

The integration is backed by `pnpm add @ngageoint/geopackage`, pinned to 4.2.9. It imports only the package's SQL.js adapter. Native `better-sqlite3` is not used and its build script is disabled in this browser repository.

Deploy these published assets in the same public directory:

```text
@mapseekai/emap/dist/emap-geopackage-worker.js
@mapseekai/emap/dist/mapshaper-vendor.js
@mapseekai/emap/dist/sql-wasm.wasm
```

Main-thread imports need `wasmUrl`; worker imports also need `workerUrl`. Keep the mapshaper vendor adjacent to the worker. Serve the assets with JavaScript and `application/wasm` content types and permit Worker/WASM under the application's CSP. No CDN is required. Compiled WASM may be reused in one execution environment, but every import owns its database connection.

## Obtain one dataset directly

```ts
import { importGeoPackage } from '@mapseekai/emap/geopackage';
const bytes = await file.arrayBuffer();
const dataset = await importGeoPackage(bytes, {
  wasmUrl: '/assets/sql-wasm.wasm',
  layers: ['roads', 'stations'], // omit to read all feature tables
  targetCrs: 'EPSG:3857',
});
console.log(dataset.layers);
console.log(dataset.arcs?.getVertexData?.().xx);
console.log(dataset.info.geopackage.tables);
```

A validation/count pass determines exact coordinate-buffer lengths. The second SQL pass writes directly into typed arrays rather than building a complete GeoJSON tree. Path coordinates enter shared arc buffers; points become native mapshaper XY tuples only at the final boundary. Attributes become DataTables. Shared topology is built once across all layers; `noTopology: true` is only appropriate for disposable output that does not need topology.

## Mount a native Cordis format plugin

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';
const map = await Emap.create({ container: 'map' });
const fiber = map.ctx.plugin(geoPackagePlugin({
  workerUrl: '/assets/emap-geopackage-worker.js',
  wasmUrl: '/assets/sql-wasm.wasm',
}));
await fiber.await();
const source = new TopologySource('gpkg', { formats: map.formats });
await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
await map.addSource('gpkg', source);
for (const [index, layer] of source.getLayers().entries()) {
  const type = layer.geometry_type === 'point' ? 'circle'
    : layer.geometry_type === 'polyline' ? 'line'
    : layer.geometry_type === 'polygon' ? 'fill' : undefined;
  if (type) map.addLayer({ id: `gpkg-${index}`, source: 'gpkg', 'source-layer': layer.name, type });
}
await map.dispose();
```

Importing the module does not register a codec or initialize a database. Registrations belong to the map instance. Disposing the Fiber unregisters the format and cancels pending imports without deleting datasets that have already loaded. GeoPackage export is not provided.

## Workers, progress, and cancellation

```ts
import { importGeoPackageInWorker } from '@mapseekai/emap/geopackage';
const controller = new AbortController();
const dataset = await importGeoPackageInWorker(bytes, {
  workerUrl: '/assets/emap-geopackage-worker.js',
  wasmUrl: '/assets/sql-wasm.wasm',
  signal: controller.signal,
  onProgress: ({ phase, table, rows }) => console.log(phase, table, rows),
});
// Call controller.abort() when the user cancels.
```

SQLite queries, WKB decoding, reprojection and topology building execute in the worker. Arc/point buffers are transferred as ArrayBuffers and rehydrated into ArcCollection/DataTable without JSON serialization. The input is copied by default; `transferInput: true` transfers an exclusively owned, full input buffer explicitly. Cancellation terminates the worker and rejects the Promise. Failures never silently fall back to the main thread or commit partial layers. Main-thread imports yield between batches but cannot preempt a synchronous topology build.

## Data semantics

| Input | Behavior |
| --- | --- |
| Multiple table CRSs | Normalize to `targetCrs`, or the first selected table's CRS; all-table selection is ordered by table name. |
| Undefined or unresolvable CRS | Never guess. Mixing undefined and known CRS requires explicit `sourceCrs` table overrides. |
| Standard point/line/polygon and multi-geometries | Preserve records and multipart structure, with normalized shell/hole winding. |
| Mixed GEOMETRY / GeometryCollection | Split dimension families into sublayers inside the same dataset. Keep null records and independently editable attribute copies. |
| NULL / EMPTY / empty tables | Keep aligned rows; empty tables keep column metadata and declared geometry type. |
| Z/M/ZM | Decode dimension strides correctly, retain XY only, and record `hasZ/hasM`; this is not 3D editing support. |
| Curves, custom extensions, malformed headers/counts/coordinates | Reject explicitly rather than silently drop data. |
| Integer/BLOB/date values | Safe integers remain numbers, larger integers become lossless decimal strings, BLOBs remain Uint8Array, dates retain SQLite values. |

`dataset.info.geopackage` records original tables, geometry columns, SRS, SQL column definitions, row counts and output-layer mappings. Attribute names are assigned as own properties so a legal `__proto__` column cannot mutate object prototypes.

## Resource bounds

Default input and decoded-coordinate budgets are each 2 GiB; defaults also cap input rows at 10 million, feature tables at 4096 and nesting at 32 levels. Lower these with `limits` for untrusted uploads. SQLite WASM loads the database into its own heap; attributes, topology work and copied worker input consume additional memory. This is not zero-copy file I/O and does not guarantee that a 2 GiB file will fit in a browser.

The [multi-layer example](/mapseekai/emap/examples/geopackage-viewer/) starts in Worker mode and can compare the main-thread result, table inventory, shared arcs, and original import metadata.

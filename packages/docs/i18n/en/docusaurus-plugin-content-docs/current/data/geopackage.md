---
id: geopackage
slug: /data/geopackage
title: Direct GeoPackage vector import
api: ["importGeoPackage", "importGeoPackageInWorker", "geoPackagePlugin", "ImportGeoPackageOptions", "GeoPackageWorkerOptions", "GeoPackagePluginOptions", "GeoPackageLimits", "GeoPackageProgress", "GeoPackageDataset", "GeoPackageMetadata", "GeoPackageTableMetadata"]
examples: ["geopackage-viewer"]
stability: experimental
verifiedVersion: 0.12.0
---

# Direct GeoPackage vector import

`@mapseekai/emap/geopackage` uses the SQL.js/WASM adapter from `@ngageoint/geopackage@4.2.9` to read SQLite and decode GP Binary/WKB directly into numeric buffers.

```ts
import { importGeoPackage } from '@mapseekai/emap/geopackage'; // import the GeoPackage reader

const bytes = await file.arrayBuffer(); // read the selected .gpkg file
const dataset = await importGeoPackage(bytes, {
  wasmUrl: '/assets/sql-wasm.wasm', // point to deployed SQL.js WASM
  layers: ['roads', 'stations'], // read only the required feature tables
  targetCrs: 'EPSG:3857', // normalize the output CRS
});
```

## Core parameters

Signature: `importGeoPackage(content: ArrayBuffer | Uint8Array, options?: ImportGeoPackageOptions): Promise<GeoPackageDataset>`.

`ImportGeoPackageOptions`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `layers` | `readonly string[]` | Omit to read every feature table | Feature-table names; non-empty, unique, and ordered. |
| `targetCrs` | `string` | CRS of the first selected table | Common output CRS. |
| `wasmUrl` | `string` | `'sql-wasm.wasm'` | SQL.js WASM URL. |

Import scans geometry for buffer lengths, then writes TypedArrays.

## More import paths

### Import pipeline

```text
.gpkg bytes
  → SQLite WASM / prepared statement
  → gpkg_contents + gpkg_geometry_columns + gpkg_spatial_ref_sys
  → GP Binary header + WKB
  → Float64Array XY + Int32Array arc lengths
  → mapshaper layers + DataTable + one shared ArcCollection
  → one dataset / one topology build
```

By default, it reads `data_type = 'features'` tables, preserving each layer, name, fields, and attributes; tile-only packages error.

### Advanced import parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `sourceCrs` | `Readonly<Record<string, string>>` | `undefined` | Source-CRS overrides by table name. |
| `noTopology` | `boolean` | `false` | Whether to build shared-arc topology for lines and polygons. |
| `limits` | `Partial<GeoPackageLimits>` | See “Resource bounds” | Resource-threshold overrides. |
| `signal` | `AbortSignal` | `undefined` | Import cancellation signal. |
| `onProgress` | `(progress: GeoPackageProgress) => void` | `undefined` | Phase-progress callback. |

### Installation and assets

Install `@ngageoint/geopackage@4.2.9`, then deploy these published assets publicly:

```text
@mapseekai/emap/dist/emap-geopackage-worker.js
@mapseekai/emap/dist/mapshaper-vendor.js
@mapseekai/emap/dist/sql-wasm.wasm
```

Main-thread imports use `wasmUrl`; Worker imports also need `workerUrl` beside `mapshaper-vendor.js`. Server and CSP must support JavaScript, WASM, and Workers.

### Mount a native Cordis format plugin

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';

const map = await Emap.create({ container: 'map' });
const fiber = map.ctx.plugin(
  geoPackagePlugin({
    workerUrl: '/assets/emap-geopackage-worker.js',
    wasmUrl: '/assets/sql-wasm.wasm',
    layers: ['roads'],
  }),
);
await fiber.await();

const source = new TopologySource('gpkg', { formats: map.formats });
await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
await map.addSource('gpkg', source);
```

Signature: `geoPackagePlugin(options?: GeoPackagePluginOptions): Plugin.Object`. It registers `.gpkg`; Fiber disposal unregisters the format and cancels pending imports.

`GeoPackagePluginOptions` extends `ImportGeoPackageOptions` and all advanced import parameters, adding or overriding:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `workerUrl` | `string \| URL` | `undefined` | GeoPackage Worker-script URL; enables Worker import. |
| `wasmUrl` | `string` | `sql-wasm.wasm` resolved relative to `workerUrl` in a Worker | SQL.js WASM URL. |

After registration, a `TopologySource` with `formats: map.formats` loads `.gpkg` by extension.

### Workers, progress, and cancellation

```ts
import { importGeoPackageInWorker } from '@mapseekai/emap/geopackage';

const controller = new AbortController();
const dataset = await importGeoPackageInWorker(bytes, {
  workerUrl: '/assets/emap-geopackage-worker.js',
  wasmUrl: '/assets/sql-wasm.wasm',
  signal: controller.signal,
  onProgress: ({ phase, table, rows }) => console.log(phase, table, rows),
});
```

Signature: `importGeoPackageInWorker(content: ArrayBuffer | Uint8Array, options: GeoPackageWorkerOptions): Promise<GeoPackageDataset>`. `GeoPackageWorkerOptions` extends `ImportGeoPackageOptions` and requires `workerUrl` (`string \| URL`, the `emap-geopackage-worker.js` URL); `transferInput` (`boolean`, default `false`) transfers an owned `ArrayBuffer` when `true` and copies first otherwise. Without `wasmUrl`, Worker import resolves `sql-wasm.wasm` from the `workerUrl` directory.

`GeoPackageProgress`:

| Parameter | Type | Description |
| --- | --- | --- |
| `phase` | `'scan' \| 'decode' \| 'topology'` | Current import phase. |
| `table` | `string` | Current `scan` or `decode` table; `undefined` during `topology`. |
| `rows` | `number` | Cumulative rows or topology output shapes. |

Scan and decode report every 4,096 rows and table boundary; topology reports once before creation. `signal` can terminate the Worker.

## Data semantics

| Input | Behavior |
| --- | --- |
| Different table CRSs | Normalize to the first selected table's CRS; `targetCrs` selects another target. |
| Undefined or unresolvable CRS | `sourceCrs` supplies a source CRS by table. |
| Point / MultiPoint / LineString / MultiLineString / Polygon / MultiPolygon | Preserves features and multipart structure; normalizes polygon-ring winding. |
| Mixed GEOMETRY / GeometryCollection | Splits into point, line, and polygon sublayers with independent attributes. |
| NULL / EMPTY / empty tables | Preserves attributes, geometry positions, fields, and declared type. |
| Z / M / ZM | Reads dimensionality, imports XY, and records `hasZ` / `hasM`. |
| Integer, BLOB, and date values | Safe integers become `number`, larger ones decimal `string`, BLOBs `Uint8Array`. |

`GeoPackageDataset` is a `MapshaperDataset` with `info.geopackage: GeoPackageMetadata`: `tables` holds one `GeoPackageTableMetadata` per selected table, `dimensions` is always `'xy'`, and `integerEncoding` is always `'safe-number-or-decimal-string'` (the SQLite integer encoding policy).

Each `GeoPackageTableMetadata`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `table` | `string` | Source table name | GeoPackage feature-table name. |
| `geometryColumn` | `string` | Source geometry-column name | GP Binary column. |
| `declaredType` | `string` | Source declaration | Uppercase geometry type. |
| `sourceSrsId` | `number` | Source SRS ID | Original `srs_id`. |
| `sourceCrs` | `string \| null` | Resolved value | Source or override CRS; `null` if unresolved. |
| `rows` | `number` | Scan result | Input records. |
| `outputLayers` | `string[]` | Import result | Generated dataset-layer names. |
| `hasZ`, `hasM` | `boolean` | Scan result | Presence of Z / M dimensions. |
| `columns` | `Array<{ name: string; type: string; primary: number }>` | Source schema | Column names, declared types, and primary-key sequence. |

## Resource bounds

`limits` merges with defaults; every value is a positive safe integer, and `maxGeometryDepth` is at most 256.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `maxInputBytes` | `number` | 2 GiB | Raw GeoPackage byte ceiling. |
| `maxDecodedBytes` | `number` | 2 GiB | Decoded-buffer ceiling before TypedArray allocation. |
| `maxFeatures` | `number` | 10,000,000 | Selected-table cumulative-record ceiling. |
| `maxLayers` | `number` | 4,096 | Discovered feature-table ceiling. |
| `maxGeometryDepth` | `number` | 32 | WKB geometry nesting-depth ceiling. |

SQLite WASM, attributes, topology, and copied Worker input consume memory; tighten `limits` for public uploads.

## Runnable examples

- [GeoPackage multi-layer example](/mapseekai/emap/examples/geopackage-viewer/)

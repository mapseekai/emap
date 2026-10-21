---
id: installation
slug: /getting-started/installation
title: Installation
api: ["Emap", "TopologySource"]
examples: ["getting-started/vector-file"]
stability: stable
verifiedVersion: 0.14.0
---

# Installation

Install `@mapseekai/emap`, then import it and its stylesheet from the application entry point; browsers need ES modules, Canvas 2D, and a non-zero map container.

```bash
pnpm add @mapseekai/emap # install the core package; npm projects use npm install @mapseekai/emap
```

```ts
import { Emap, TopologySource } from '@mapseekai/emap'; // import map APIs
import '@mapseekai/emap/style.css'; // import built-in control and editing styles
```

## More environment and module configuration

Browser floors: Chrome or Edge 109, Firefox 115, Safari 16.4. Development and release use Node.js `>=22.18 <25`; browser applications need ES2022, ES modules, Canvas 2D, and a non-zero map container.

Feature entry points are `package.json` export subpaths: `/arrow`, `/duckdb`, `/geopackage`, `/maplibre`, `/context`, `/services`, `/providers`, `/plugins`, `/presets`, `/ai`, and `/style.css`. Browser bundles use `module: "ESNext"` with `moduleResolution: "bundler"`:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

emap's public declarations use extensionless relative imports and are verified with
`module: "ESNext"` and `moduleResolution: "bundler"`. Use this configuration for
browser applications; Node.js supports the development, build, and test tools.

Choose `renderer: 'canvas2d'`, `'webgl2'`, or `'webgpu'` when creating the map.
WebGL2 is the default; WebGPU requires a secure context and an available GPU adapter.
The host can select Canvas2D for devices that need it.

## More optional capabilities and peer dependencies

Core declarations reference MapLibre's full types, so `maplibre-gl@^6.4.1` is a
required peer installed automatically by npm/pnpm with their default settings.
Basemaps still require explicit MapLibre plugin registration. Install Arrow,
Parquet, and DuckDB peers when needed; subpath entries share the core dependencies.

| Entry point | Required peer dependencies | Enables |
| --- | --- | --- |
| `@mapseekai/emap` | `maplibre-gl` `^6.4.1` | Maps, sources, layers, editing, and public MapLibre types. |
| `@mapseekai/emap/arrow` (Arrow / GeoArrow) | `apache-arrow` `^17.0.0` | Arrow table interoperability and GeoArrow I/O. |
| `@mapseekai/emap/arrow` (GeoParquet) | `apache-arrow` `^17.0.0`, `parquet-wasm` `^0.7.1` | GeoParquet I/O. |
| `@mapseekai/emap/duckdb` | `@duckdb/duckdb-wasm` `1.33.1-dev64.0`, `apache-arrow` `^17.0.0` | DuckDB-Wasm queries and spatial processing. |
| `@mapseekai/emap/geopackage` | None | GeoPackage vector-table import. |
| `@mapseekai/emap/maplibre` | `maplibre-gl` `^6.4.1` | MapLibre basemaps and online overlays. |

### GeoArrow and GeoParquet

`@mapseekai/emap/arrow` provides GeoArrow, GeoParquet, and Arrow table interoperability; GeoParquet also needs `parquet-wasm@^0.7.1`:

```bash
pnpm add apache-arrow@^17.0.0 parquet-wasm@^0.7.1
```

Import before the first GeoArrow or GeoParquet read or write:

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);
// For optional-format input loaded before addSource:
const optionalSource = new TopologySource('upload', { formats: map.formats });
```

### DuckDB queries and spatial processing

`@mapseekai/emap/duckdb` provides DuckDB-Wasm queries, GeoParquet queries, and spatial processing:

```bash
pnpm add @duckdb/duckdb-wasm@1.33.1-dev64.0 apache-arrow@^17.0.0
```

```ts
import { createDuckDbRuntimeFromJsDelivr } from '@mapseekai/emap/duckdb';
```

For GeoParquet, install `parquet-wasm@^0.7.1` and import `@mapseekai/emap/arrow` to register formats.

### GeoPackage import

`@mapseekai/emap/geopackage` decodes GeoPackage vector tables into typed-buffer datasets. Worker import requires `dist/emap-geopackage-worker.js` and `dist/sql-wasm.wasm`; see [GeoPackage](../data/geopackage.md).

### MapLibre online basemaps and overlays

`@mapseekai/emap/maplibre` provides MapLibre basemaps and online overlays:

```bash
pnpm add maplibre-gl@^6.4.1
```

```ts
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';
```

See the [plugins guide](../guides/plugins.md).

### Worker execution

Web Worker uses the core package; publish `emap-worker.js` and `mapshaper-vendor.js`. See [Web Worker](../guides/worker.md).

## Next steps

- [Concepts overview](../concepts/overview.md)
- [Data formats](../data/formats.md)

## Runnable examples

- [Open a vector file](/mapseekai/emap/examples/getting-started/vector-file/)

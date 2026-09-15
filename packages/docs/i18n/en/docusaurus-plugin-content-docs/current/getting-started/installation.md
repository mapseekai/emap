---
id: installation
slug: /getting-started/installation
title: Installation
api: ["Emap", "TopologySource"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.12.0
---

# Installation

Install `@mapseekai/emap`, then import the library and its stylesheet from the application entry point. Emap runs in browsers with ES modules, Canvas 2D, and modern JavaScript support.

## Install the core package

Use the package manager for your project:

```bash
pnpm add @mapseekai/emap
```

Or:

```bash
npm install @mapseekai/emap
```

Import the APIs you need and the stylesheet from the application entry point:

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';
```

The stylesheet includes styles for built-in controls and editing UI. The map container needs a non-zero width and height.

## TypeScript resolution for optional modules

Beyond the root entry, every feature entry point is a `package.json` export subpath: `/arrow`, `/duckdb`, `/geopackage`, `/maplibre`, `/context`, `/services`, `/providers`, `/plugins`, `/presets`, `/ai`, plus the `/style.css` stylesheet. Vite and other browser bundlers use `bundler` resolution:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

Native Node ESM projects use matching `Node16` or `NodeNext` settings for both `module` and `moduleResolution`:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```

## Optional capabilities and peer dependencies

The core package does not need these dependencies. Install them only when using their associated entry points.

### GeoArrow and GeoParquet

`@mapseekai/emap/arrow` supplies GeoArrow and GeoParquet import, export, and Arrow table interoperability. Install `apache-arrow` for GeoArrow and Arrow tables; GeoParquet also needs `parquet-wasm`:

```bash
pnpm add apache-arrow parquet-wasm
```

Import this entry point before the first GeoArrow or GeoParquet read or write:

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);
// For optional-format input loaded before addSource:
const optionalSource = new TopologySource('upload', { formats: map.formats });
```

### DuckDB queries and spatial processing

`@mapseekai/emap/duckdb` supplies DuckDB-Wasm query and spatial-processing APIs. Install `@duckdb/duckdb-wasm`, then import this entry point:

```bash
pnpm add @duckdb/duckdb-wasm
```

```ts
import { createDuckDbRuntimeFromJsDelivr } from '@mapseekai/emap/duckdb';
```

When `@mapseekai/emap/duckdb` processes GeoParquet, also install `apache-arrow` and `parquet-wasm`, and import `@mapseekai/emap/arrow`.

### GeoPackage import

`@mapseekai/emap/geopackage` decodes GeoPackage vector tables straight into a typed-buffer dataset. No extra install is needed: `@ngageoint/geopackage` ships as a bundled dependency. Worker import requires publishing `dist/emap-geopackage-worker.js` and `dist/sql-wasm.wasm` from the package; see [GeoPackage](../data/geopackage.md) for the asset, CRS, and memory contracts.

### MapLibre online basemaps and overlays

`@mapseekai/emap/maplibre` provides MapLibre basemap and online overlay services. Install `maplibre-gl`:

```bash
pnpm add maplibre-gl
```

```ts
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';
```

Service configuration is covered in the [plugins guide](../guides/plugins.md).

### Worker execution

Routing dataset operations to a Web Worker needs no extra dependency, but the application must publish `emap-worker.js` and `mapshaper-vendor.js`; see [Web Worker](../guides/worker.md).

## Next steps

- Read [Concepts overview](../concepts/overview.md) to create a map and add sources and layers.
- Read [Data formats](../data/formats.md) to load and export supported formats.
- Open the [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/) for a complete example.

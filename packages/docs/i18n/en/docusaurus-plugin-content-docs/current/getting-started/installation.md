---
id: installation
slug: /getting-started/installation
title: Installation
api: ["Emap","TopologySource"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.9.1
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

`@mapseekai/emap/arrow` and `@mapseekai/emap/duckdb` are `package.json` export subpaths. Vite and other browser bundlers use `bundler` resolution:

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
import '@mapseekai/emap/arrow';
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

## Next steps

- Read [Concepts overview](../concepts/overview.md) to create a map and add sources and layers.
- Read [Data formats](../data/formats.md) to load and export supported formats.
- Open the [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/) for a complete example.
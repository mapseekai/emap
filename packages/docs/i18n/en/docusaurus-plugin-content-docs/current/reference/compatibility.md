---
id: compatibility
slug: /reference/compatibility
title: Compatibility
api: ["ArcCollection","ArcCutPoint","ArcIterator","ArcVertexData","ArrowDotPathOptions","bumpAttributeVersion","bumpEditVersion","CanvasPainter","Coord2","DataTable","DefaultMapshaperAdapter","EditOverlayRenderer","ExportedFile","FeatureShape","GeometryType","getDefaultMapshaperAdapter","Handler","HandlerManager","HandlerResult","isHandler","isPathLayer","isPointLayer","LegacyPointShape","MapshaperAdapter","MapshaperBBox","MapshaperDataset","MapshaperLayer","MapshaperWorkerPool","MapshaperWorkerPoolOptions","NormalizedPointerEvent","PackedSession","PathGeometryType","PathLayer","PathPart","PathShape","PointerModifiers","PointerMoveEvent","PointLayer","PointShape","PointStyle","RunnerInputFiles","SegmentIntersection","setDefaultMapshaperAdapter","SignedArcId","StrokeStyle","TopologySource.fromBytes","Transform","VertexDotStyle","Emap","MapOptions","initParquetWasm","setParquetWasm","createDuckDbRuntimeFromJsDelivr"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.9.1
---

# Compatibility

Emap runs in the browser and requires a DOM container with an actual size, Canvas 2D, and ES module support. Its JavaScript target is ES2022.

## Browsers and development environment

| Environment | Requirement |
| --- | --- |
| Chrome / Edge | 109 or later |
| Firefox | 115 or later |
| Safari | 16.4 or later |
| Node.js (development and release tooling) | `>=22.18 <25` |
| TypeScript | ES2022, DOM, and ES module libraries under `strict` mode |

Applications that use Workers, WASM, file uploads, or MapLibre need the corresponding CSP, cross-origin asset, and device-performance conditions in their deployment environment.

## Bundlers and TypeScript

The root entry point, `@mapseekai/emap/arrow`, and `@mapseekai/emap/duckdb` are published through package `exports`. Vite and other browser bundlers use this TypeScript configuration:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

Native Node ESM uses paired `"module": "Node16"` and `"moduleResolution": "Node16"` settings, or paired `NodeNext` settings. The resolver must support package `exports` to resolve optional subpaths.

## Optional peer dependencies

| Entry point or capability | Peer dependencies to install |
| --- | --- |
| Core `@mapseekai/emap` | None |
| Arrow and GeoArrow from `@mapseekai/emap/arrow` | `apache-arrow` `^17.0.0` |
| GeoParquet import and export from the Arrow entry point | `apache-arrow` `^17.0.0`, `parquet-wasm` `^0.7.1` |
| `@mapseekai/emap/duckdb` | `@duckdb/duckdb-wasm` `1.33.1-dev64.0`, `apache-arrow` `^17.0.0` |

All of these peers are optional installs; install the dependencies required by the entry points your application imports. GeoParquet loads `parquet-wasm` on first use. Environments whose bundler cannot resolve that module can inject an initialized module with `setParquetWasm`.

## Worker assets

When `workerUrl` is enabled, the page must be able to fetch `emap-worker.js`, and the same directory must contain `mapshaper-vendor.js`. The Worker loads that vendor asset relatively.

Low-level commands that modify a dataset directly call `bumpEditVersion()` after geometry changes and `bumpAttributeVersion()` after attribute-only changes so spatial indexes and attribute-style caches invalidate at their respective boundaries.

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.MapshaperWorkerPool](/mapseekai/emap/api/classes/emap.MapshaperWorkerPool.html)
- [src_arrow.initParquetWasm](/mapseekai/emap/api/functions/arrow.initParquetWasm.html)

## Runnable examples

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [web-worker](/mapseekai/emap/examples/web-worker/)

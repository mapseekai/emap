---
id: compatibility
slug: /reference/compatibility
title: Compatibility
api: ["ArcCollection","ArcCutPoint","ArcIterator","ArcVertexData","ArrowDotPathOptions","bumpAttributeVersion","bumpEditVersion","CanvasPainter","Coord2","DataTable","DefaultMapshaperAdapter","EditOverlayRenderer","ExportedFile","FeatureShape","GeometryType","getDefaultMapshaperAdapter","Handler","HandlerManager","HandlerResult","isHandler","isPathLayer","isPointLayer","LegacyPointShape","MapshaperAdapter","MapshaperBBox","MapshaperDataset","MapshaperLayer","MapshaperWorkerPool","MapshaperWorkerPoolOptions","NormalizedPointerEvent","PackedSession","PathGeometryType","PathLayer","PathPart","PathShape","PointerModifiers","PointerMoveEvent","PointLayer","PointShape","PointStyle","RunnerInputFiles","SegmentIntersection","setDefaultMapshaperAdapter","SignedArcId","StrokeStyle","TopologySource.fromBytes","Transform","VertexDotStyle"]
examples: ["geoparquet-viewer"]
stability: stable
verifiedVersion: 0.8.1
---

# Compatibility

Emap is browser-first and requires a sized DOM container, Canvas, and modern module tooling. The optional `duckdb` subpath requires DuckDB-Wasm. The `arrow` subpath's in-memory Arrow and GeoArrow APIs use `apache-arrow` without WASM; only GeoParquet import and export lazily load `parquet-wasm`.

## Supported baseline

| Environment | Declared baseline | Automated verification |
|---|---|---|
| Node.js development and release tooling | `>=22.18 <25` | Pull requests use Node 22.18 and Node 24; releases use Node 22.18 |
| JavaScript output syntax | ES2022 | Production bundle build and self-containment checks |
| Chromium | Chrome / Edge 109+ | Playwright with stable Chrome |
| Firefox | Firefox 115+ | Playwright Firefox |
| WebKit / Safari | Safari 16.4+ | Playwright WebKit |

The browser baseline is the minimum target the project declares and continuously verifies; older browsers are not actively blocked. Applications using touch input, workers, WASM, file uploads, or MapLibre should also verify CSP, cross-origin assets, and device performance in their deployment environment.

## TypeScript module resolution

`@mapseekai/emap/arrow` and `@mapseekai/emap/duckdb` are exposed through `package.json` `exports`:

- Vite and other browser bundlers use `"module": "ESNext"` with `"moduleResolution": "bundler"`.
- Native Node ESM pairs `Node16` or `NodeNext` for both `module` and `moduleResolution`.

Legacy `node`/`node10` resolution cannot resolve these subpaths even when their declaration files exist. See [Installation and your first map](../getting-started/installation.md#typescript-resolution-for-optional-modules) for the complete setup.

## Behavior notes

Worker builds must serve `emap-worker.js` and mapshaper vendor assets from URLs reachable by the page.
When a custom low-level command mutates a dataset directly, call `bumpEditVersion()` for geometry
changes and `bumpAttributeVersion()` for attribute-only changes so spatial indexes and attribute-style
caches invalidate on their respective boundaries.

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.MapshaperWorkerPool](/mapseekai/emap/api/classes/emap.MapshaperWorkerPool.html)

## Runnable examples

- [web-worker](/mapseekai/emap/examples/web-worker/)
- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)

## Minimal snippet

```ts
import "@mapseekai/emap/style.css"
new Emap({ container: "map", workerUrl: "/dist/emap-worker.js" })
```

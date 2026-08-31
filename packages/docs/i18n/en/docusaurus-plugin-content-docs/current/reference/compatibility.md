---
id: compatibility
slug: /reference/compatibility
title: Compatibility
api: ["ArcCollection","ArcCutPoint","ArcIterator","ArcVertexData","ArrowDotPathOptions","bumpEditVersion","CanvasPainter","Coord2","DataTable","DefaultMapshaperAdapter","EditOverlayRenderer","ExportedFile","FeatureShape","GeometryType","getDefaultMapshaperAdapter","Handler","HandlerManager","HandlerResult","isHandler","isPathLayer","isPointLayer","LegacyPointShape","MapshaperAdapter","MapshaperBBox","MapshaperDataset","MapshaperLayer","MapshaperWorkerPool","MapshaperWorkerPoolOptions","NormalizedPointerEvent","PackedSession","PathGeometryType","PathLayer","PathPart","PathShape","PointerModifiers","PointerMoveEvent","PointLayer","PointShape","PointStyle","RunnerInputFiles","SegmentIntersection","setDefaultMapshaperAdapter","SignedArcId","StrokeStyle","TopologySource.fromBytes","Transform","VertexDotStyle"]
examples: ["geoparquet-viewer"]
stability: stable
verifiedVersion: 0.5.0
---

# Compatibility

Emap is browser-first and requires a sized DOM container, Canvas, and modern module tooling. The optional `arrow` and `duckdb` subpaths also require their corresponding WASM dependencies.

## TypeScript module resolution

`@mapseekai/emap/arrow` and `@mapseekai/emap/duckdb` are exposed through `package.json` `exports`:

- Vite and other browser bundlers use `"module": "ESNext"` with `"moduleResolution": "bundler"`.
- Native Node ESM pairs `Node16` or `NodeNext` for both `module` and `moduleResolution`.

Legacy `node`/`node10` resolution cannot resolve these subpaths even when their declaration files exist. See [Installation and your first map](../getting-started/installation.md#typescript-resolution-for-optional-modules) for the complete setup.

## Behavior notes

Worker builds must serve `emap-worker.js` and mapshaper vendor assets from URLs reachable by the page.

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

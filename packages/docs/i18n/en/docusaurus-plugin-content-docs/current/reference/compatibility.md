---
id: compatibility
slug: /reference/compatibility
title: Compatibility
api: ["ArcCollection","ArcIterator","ArcVertexData","bumpEditVersion","CanvasPainter","Coord2","DataTable","DefaultMapshaperAdapter","EditOverlayRenderer","ExportedFile","FeatureShape","GeometryType","getDefaultMapshaperAdapter","Handler","HandlerManager","HandlerResult","isHandler","isPathLayer","isPointLayer","LegacyPointShape","MapshaperAdapter","MapshaperBBox","MapshaperDataset","MapshaperLayer","MapshaperWorkerPool","MapshaperWorkerPoolOptions","NormalizedPointerEvent","PackedSession","PathGeometryType","PathLayer","PathPart","PathShape","PointerModifiers","PointerMoveEvent","PointLayer","PointShape","PointStyle","RunnerInputFiles","SegmentIntersection","setDefaultMapshaperAdapter","SignedArcId","StrokeStyle","TopologySource.fromBytes","Transform","VertexDotStyle"]
examples: ["geoparquet-viewer"]
stability: stable
verifiedVersion: 0.5.0
---

# Compatibility

emap is browser-first and requires a sized DOM container, Canvas, and modern module tooling. Optional formats and DuckDB features require their WASM dependencies.

## Behavior notes

Worker builds must serve `emap-worker.js` and mapshaper vendor assets from URLs reachable by the page.

## API

- [src.MapOptions](https://zwishing.github.io/emap/api/interfaces/index.MapOptions.html)
- [src.MapshaperWorkerPool](https://zwishing.github.io/emap/api/classes/index.MapshaperWorkerPool.html)

## Runnable examples

- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)
- [geoparquet-viewer](https://zwishing.github.io/emap/examples/geoparquet-viewer/)

## Minimal snippet

```ts
import "@zwishing/emap/style.css"
new Emap({ container: "map", workerUrl: "/dist/emap-worker.js" })
```

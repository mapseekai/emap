---
id: faq
slug: /reference/faq
title: FAQ
api: ["Emap", "MapOptions", "TopologySource", "SourceLoadError"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: unreleased
---

# FAQ

## Why is my map blank?

Confirm that the map container and its parents have non-zero width and height; import `@mapseekai/emap/style.css`; wait for `TopologySource` to finish loading before calling `map.addSource(...)`; make the layer `source` match the registered source ID; and move the view to the data with `map.setExtent(source.getExtent())` or a camera method.

## How do I load my own file?

Create a source from a URL:

```ts
const source = await TopologySource.fromUrl("roads", "/data/roads.geojson")
await map.addSource("roads", source)
map.setExtent(source.getExtent())
```

The URL must be reachable by the browser; cross-origin URLs must return CORS headers that permit the application. Binary content can load through `setData({ filename, content })` on `new TopologySource(id)`. The `filename` extension selects the import format.

## Why is my layer not visible?

A layer's `type` must match the source layer's geometry type, and its `source` must match the source ID. A source can have multiple rendering layers, and layers added later draw above earlier ones.

## When do I need a Worker?

Set `useWorker` and `workerUrl` only to move heavier data processing off the main thread. Publish `emap-worker.js` and `mapshaper-vendor.js` in the same page-reachable directory.

## How do I use Arrow, GeoParquet, or DuckDB?

Import Arrow, GeoArrow, and GeoParquet APIs from `@mapseekai/emap/arrow` and install `apache-arrow`; GeoParquet also installs `parquet-wasm`. Import DuckDB APIs from `@mapseekai/emap/duckdb` and install `@duckdb/duckdb-wasm` and `apache-arrow`. See [Compatibility](./compatibility.md) for each entry point's peer dependencies.

## How do I handle a failed operation?

Check `OpResult`'s `ok` field; on failure, use `error.kind` to show a recovery action or record diagnostics. Source preflight and loading errors provide details through `SourceLoadError` `code` and `diagnostics`.

## API

- [src.Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [src.TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [src.SourceLoadError](/mapseekai/emap/api/classes/emap.SourceLoadError.html)

## Runnable examples

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [web-worker](/mapseekai/emap/examples/web-worker/)

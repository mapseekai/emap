---
id: faq
slug: /reference/faq
title: FAQ
api: ["Emap", "MapOptions", "TopologySource", "SourceLoadError"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.14.0
---

# FAQ

Common ways to configure map display, load local and remote data, and enable format plugins and background processing.

```ts
const source = await TopologySource.fromUrl('roads', '/data/roads.geojson'); // Load data from a URL
await map.addSource('roads', source); // Register it with the same ID
map.setExtent(source.getExtent()); // Fit its data extent
```

## Core questions

### How do I set up map display?

`MapOptions.container` locates the canvas mount point. Give it and its parents non-zero dimensions and import `@mapseekai/emap/style.css`; set `interactive: false` for static displays.

Load with `TopologySource.fromUrl()` or `source.setData()`, register with the same `id`, call `map.setExtent(source.getExtent())`, and match `LayerSpecification.source` to that `id`; use `'source-layer'` for a source with multiple data layers.

### How do I load my own file?

`TopologySource.fromUrl(id, url, options?)` uses `id` for `map.addSource` and layer `source`; cross-origin URLs require CORS. For memory data, `source.setData({ filename, content })` selects an importer by extension; a file array creates one dataset layer per file. `TopologySource.fromBytes(id, bytes, { filename })` accepts `ArrayBuffer`; `filename` defaults to `${id}.geojson`.

### How do I display a specific layer?

`spec.id` is the unique layer key; `spec.source` names a registered source and `'source-layer'` selects its data layer. Use `'circle'` for points, `'line'` for lines and outlines, and `'fill'` for polygon fills; `'visible'` renders the layer and `before` controls draw order.

## More data formats

`arrowFormatsPlugin` registers Arrow and GeoParquet extensions on `map.formats`. `setData()` imports by filename; `export()` supports `'geoparquet'` and `'geoarrow'`. The Arrow entry point requires `apache-arrow`; GeoParquet also requires `parquet-wasm`.

Create DuckDB with `createDuckDbRuntimeFromJsDelivr(options?)`; `spatialExtensionUrls` supplies self-hosted extension WASM. `queryGeoParquetWithDuckDb()` accepts data, required SQL, and a runtime; `geometryColumn` selects geometry, `layerName` defaults to `'layer'`, and `noTopology` is display-only. Requires `@duckdb/duckdb-wasm` and `apache-arrow`; see [Compatibility](./compatibility.md).

## More background processing

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `useWorker` | `boolean \| 'auto'` | `false` | Routes dataset replacements to a Worker. |
| `workerThreshold` | `number` | `50000` | Worker threshold for `'auto'`. |
| `workerUrl` | `string` | `'emap-worker.js'` | Bundle URL relative to `document.baseURI`. |
| `workerPoolSize` | `number` | `1` | Maintained Worker count. |
| `workerRouting` | `WorkerRoutingFn` | Engine routing | Custom `'auto'` routing. |

Publish `emap-worker.js` beside `mapshaper-vendor.js`.

## More error handling

`MapshaperOps` returns `OpResult<T>`: read `value` when `ok`, otherwise branch on `error.kind`. Errors expose target IDs, validation fields, DuckDB details, or mapshaper causes; `SourceLoadError` contains a diagnostic code, severity, message, and optional CRS values for recovery.

## API

- [src.Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [src.TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [src.SourceLoadError](/mapseekai/emap/api/classes/emap.SourceLoadError.html)

## Runnable examples

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [web-worker](/mapseekai/emap/examples/web-worker/)

---
slug: /data/formats
title: Data formats
---

# Data formats

Core imports support GeoJSON, TopoJSON, Shapefile ZIP, KML, and mapshaper project data. Optional format helpers add GeoParquet and GeoArrow import/export.

## Behavior notes

Pass `filename` when loading bytes because parser selection is extension-based. GeoParquet and GeoArrow require the formats entry to initialize optional WASM helpers.

## API

- [src.TopologySource](https://zwishing.github.io/emap/api/classes/index.TopologySource.html)
- [src_formats.importGeoParquet](https://zwishing.github.io/emap/api/functions/src_formats.importGeoParquet.html)
- [src_formats.exportGeoArrow](https://zwishing.github.io/emap/api/functions/src_formats.exportGeoArrow.html)

## Runnable examples

- [geoparquet-viewer](https://zwishing.github.io/emap/examples/geoparquet-viewer/)
- [export-geoparquet](https://zwishing.github.io/emap/examples/export-geoparquet/)
- [export-roundtrip](https://zwishing.github.io/emap/examples/export-roundtrip/)

## Minimal snippet

```ts
await source.setData({ filename: "districts.geojson", content })
await initParquetWasm({ module })
```

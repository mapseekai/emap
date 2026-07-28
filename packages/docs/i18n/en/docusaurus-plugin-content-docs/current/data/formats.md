---
id: formats
slug: /data/formats
title: Data formats
api: ["buildGeoMetadata","crsStringToProjjson","decodeWkb","detectGeometryColumn","Emap","exportGeoArrow","ExportGeoArrowOptions","exportGeoParquet","ExportGeoParquetOptions","fromArrowTable","FromArrowTableOptions","GeoColumnMetadata","GeoEncoding","GeoMetadata","GeometryColumnInfo","importGeoArrow","ImportGeoArrowOptions","importGeoParquet","ImportGeoParquetOptions","initParquetWasm","InitParquetWasmOptions","ParquetWasmModule","ParquetWasmTable","parseGeoMetadata","projjsonToCrsString","registerArrowFormats","setArrowTable","setParquetWasm","toArrowTable","toArrowTableFromSource","ToArrowTableOptions","TopologySource.fromBytes","WkbGeometry","WkbWriter"]
examples: ["duckdb-geoparquet-query","export-geoparquet","export-roundtrip","geoparquet-viewer"]
stability: stable
verifiedVersion: 0.5.0
---

# Data formats

Core imports support GeoJSON, TopoJSON, Shapefile ZIP, KML, and mapshaper project data. Optional format helpers add GeoParquet and GeoArrow import/export.

## Behavior notes

Pass `filename` when loading bytes because parser selection is extension-based. GeoParquet and GeoArrow require the formats entry to initialize optional WASM helpers.

## API

- [src.TopologySource](/emap/api/classes/index.TopologySource.html)
- [src_formats.importGeoParquet](/emap/api/functions/src_formats.importGeoParquet.html)
- [src_formats.exportGeoArrow](/emap/api/functions/src_formats.exportGeoArrow.html)

## Runnable examples

- [geoparquet-viewer](/emap/examples/geoparquet-viewer/)
- [export-geoparquet](/emap/examples/export-geoparquet/)
- [export-roundtrip](/emap/examples/export-roundtrip/)

## Minimal snippet

```ts
await source.setData({ filename: "districts.geojson", content })
await initParquetWasm({ module })
```

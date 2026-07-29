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

Emap separates core formats from optional formats so a GeoJSON-only
application does not pay for Arrow, Parquet, or WASM.

## Support matrix

| Format | Extensions | Import | Export | Entry |
|---|---|---|---|---|
| GeoJSON | `.json`, `.geojson` | yes | yes | core |
| TopoJSON | `.topojson`, `.json` | yes | yes | core |
| Shapefile ZIP | `.zip` | yes | yes, as ZIP | core |
| KML | `.kml` | yes | no | core |
| mapshaper snapshot | `.msx` | yes | yes | core |
| GeoParquet | `.parquet`, `.geoparquet` | yes | yes | `@zwishing/emap/arrow` |
| GeoArrow | `.arrow`, `.arrows`, `.feather` | yes | yes | `@zwishing/emap/arrow` |

## Load URLs and bytes

```ts
const source = await TopologySource.fromUrl(
  'districts',
  '/data/districts.geojson',
);
```

The URL path or response Content-Type provides the format. When a generic
Content-Type hides the real extension, use the bytes API with a filename:

```ts
const bytes = new Uint8Array(await file.arrayBuffer());
const source = await TopologySource.fromBytes('upload', bytes, {
  filename: file.name,
});
```

The filename selects the importer. Do not rename every upload to `data.bin`.

An existing source can be reloaded:

```ts
await source.setData({
  filename: 'roads.topojson',
  content: bytes,
});
```

`setData` resolves after the dataset is populated and the `data` event fires.
A newer load supersedes an older in-flight load.

## Shapefile ZIP

A ZIP needs `.shp` and normally includes `.dbf`, `.shx`, and `.prj`. Emap
enforces entry-count, expanded-size, and compression-ratio limits. Pass the
complete ZIP rather than only the `.shp` bytes.

## Enable GeoParquet and GeoArrow

Before parquet/arrow import or export:

```ts
import '@zwishing/emap/arrow';
```

This side-effect import registers format plugins. GeoArrow does not need WASM.
GeoParquet lazily imports `parquet-wasm` on first use. Bundlers such as Vite and
webpack 5 normally emit the WASM asset automatically.

Set an explicit WASM location:

```ts
import { initParquetWasm } from '@zwishing/emap/arrow';

await initParquetWasm({
  wasmInput: '/assets/parquet_wasm_bg.wasm',
});
```

Or inject an already initialized module:

```ts
import { setParquetWasm } from '@zwishing/emap/arrow';

setParquetWasm(parquetModule);
```

`initParquetWasm({ module })` is not a current signature. Use `wasmInput`, or
inject through `setParquetWasm(module)`.

## Arrow table interoperability

```ts
import {
  fromArrowTable,
  setArrowTable,
  toArrowTable,
} from '@zwishing/emap/arrow';

setArrowTable(source, duckdbResultTable);
const table = toArrowTable(source.getDataset()!);
const dataset = fromArrowTable(table);
```

This path converts coordinate buffers directly without a GeoJSON intermediate.

## Export

`TopologySource.export` always returns one `Blob`:

```ts
const blob = await source.export({
  format: 'geojson',
});
```

Shapefile sidecars are packed into one ZIP Blob.

GeoParquet:

```ts
const blob = await source.export({
  format: 'geoparquet',
  layer: 'districts',
  encoding: 'wkb',
});
```

GeoParquet defaults to WKB for DuckDB, GeoPandas, and GDAL interoperability.
GeoArrow defaults to native coordinate encoding. Both optional formats export
one layer at a time.

## Browser download

```ts
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'districts.geojson';
link.click();
URL.revokeObjectURL(url);
```

## Troubleshooting

- A “requires Arrow module” error means the side-effect import did not run.
- For a Parquet WASM 404, let the bundler emit it or pass the final URL through
  `wasmInput`.
- If Shapefile attributes or CRS are missing, verify matching `.dbf` and `.prj`
  files exist in the ZIP.

## API

- [TopologySource](/emap/api/classes/index.TopologySource.html)
- [ExportOptions](/emap/api/interfaces/index.ExportOptions.html)
- [initParquetWasm](/emap/api/functions/arrow.initParquetWasm.html)
- [setParquetWasm](/emap/api/functions/arrow.setParquetWasm.html)
- [toArrowTable](/emap/api/functions/arrow.toArrowTable.html)

## Runnable examples

- [GeoParquet viewer](/emap/examples/geoparquet-viewer/)
- [Export GeoParquet](/emap/examples/export-geoparquet/)
- [Export round trip](/emap/examples/export-roundtrip/)

---
id: formats
slug: /data/formats
title: Data formats
api: ["buildGeoMetadata", "crsStringToProjjson", "DatasetFormatPlugin", "decodeWkb", "detectGeometryColumn", "Emap", "ExportedFormatFile", "exportGeoArrow", "ExportGeoArrowOptions", "exportGeoParquet", "ExportGeoParquetOptions", "fromArrowTable", "FromArrowTableOptions", "GeoColumnMetadata", "GeoEncoding", "GeoMetadata", "GeometryColumnInfo", "importGeoArrow", "ImportGeoArrowOptions", "importGeoParquet", "ImportGeoParquetOptions", "initParquetWasm", "InitParquetWasmOptions", "ParquetWasmModule", "ParquetWasmTable", "parseGeoMetadata", "projjsonToCrsString", "registerArrowFormats", "registerFormat", "setArrowTable", "setParquetWasm", "toArrowTable", "toArrowTableFromSource", "ToArrowTableOptions", "TopologySource.export", "TopologySource.fromBytes", "TopologySource.fromUrl", "WkbGeometry", "WkbWriter", "TopologySource", "ExportOptions"]
examples: ["export-formats","getting-started/kml-viewer","flatgeobuf-viewer","geoparquet-viewer"]
stability: stable
verifiedVersion: unreleased
---

# Data formats

Emap loads, stores, and exports geographic data in the browser through `TopologySource`. Core formats ship with `@mapseekai/emap`; GeoParquet, GeoArrow, and FlatGeobuf are enabled when an application needs them.

## Supported formats

| Format | File extensions | Import | Export | Requirement |
| --- | --- | --- | --- | --- |
| GeoJSON | `.geojson`, `.json` | yes | yes | core |
| TopoJSON | `.topojson`, `.json` | yes | yes | core |
| Shapefile ZIP | `.zip` | yes | yes, ZIP Blob | core |
| KML | `.kml` | yes | no | core |
| mapshaper snapshot | `.msx` | yes | yes | core |
| GeoParquet | `.parquet`, `.geoparquet` | yes | yes | `@mapseekai/emap/arrow` |
| GeoArrow | `.arrow`, `.arrows`, `.feather` | yes | yes | `@mapseekai/emap/arrow` |
| FlatGeobuf | `.fgb` | after registration | after registration | application-local plugin |

GeoJSON, TopoJSON, and KML use `EPSG:4326` when their data has no CRS metadata. KML is import-only.

## Load URLs and bytes

`TopologySource.fromUrl()` loads from a URL; the URL path or response Content-Type identifies its format.

```ts
import { TopologySource } from '@mapseekai/emap';

const source = await TopologySource.fromUrl(
  'districts',
  '/data/districts.geojson',
);
```

For uploaded files, pass the original filename to `fromBytes()`. Its extension selects the importer.

```ts
const bytes = new Uint8Array(await file.arrayBuffer());
const source = await TopologySource.fromBytes('upload', bytes, {
  filename: file.name,
});
```

`setData()` reloads a source from a URL, file, or file array. It completes after the dataset is populated and its `data` event fires. A later load supersedes an unresolved one.

```ts
await source.setData({
  filename: 'roads.topojson',
  content: bytes,
});
```

Pass a complete ZIP for a Shapefile. It needs `.shp`; matching `.dbf`, `.shx`, and `.prj` files supply attributes, indexes, and CRS. `TopologySource` applies ZIP limits for compressed input, expanded size, entry count, and compression ratio; configure application thresholds with `zipLimits`.

## GeoParquet and GeoArrow

Import the optional entry point before importing, exporting, or interoperating with Arrow Tables:

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);
// For optional-format input loaded before addSource:
const optionalSource = new TopologySource('upload', { formats: map.formats });
```

This registers GeoParquet and GeoArrow formats. GeoParquet loads `parquet-wasm` on first use; an application may instead supply a WASM URL or an initialized module:

```ts
import { initParquetWasm, setParquetWasm } from '@mapseekai/emap/arrow';

await initParquetWasm({ wasmInput: '/assets/parquet_wasm_bg.wasm' });
setParquetWasm(parquetModule);
```

`TopologySource.export()` returns a `Blob`. GeoParquet uses WKB encoding by default and GeoArrow uses native coordinate encoding; both export one layer per call.

```ts
const blob = await source.export({
  format: 'geoparquet',
  layer: 'districts',
  encoding: 'wkb',
});
```

## FlatGeobuf

An application installs `flatgeobuf` and registers a format plugin with the instance-scoped `registerFormat(map.formats, codec)`. The plugin supplies import, export, and the `.fgb` extension; after registration, use `fromBytes()` or `export({ format: 'flatgeobuf' })`. See the complete integration in the [FlatGeobuf viewer](/mapseekai/emap/examples/flatgeobuf-viewer/).

## Export and download

Export core formats directly:

```ts
const blob = await source.export({ format: 'geojson' });
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'districts.geojson';
link.click();
URL.revokeObjectURL(url);
```

Shapefile `.shp`, `.shx`, `.dbf`, and optional `.prj` files are packed into one ZIP Blob. Exports do not use rendering LOD simplification.

TopoJSON preserves coordinate precision without quantization by default, making it suitable for storage, restoration, and repeated imports. To explicitly enable lossy compression, use `source.export({ format: 'topojson', quantization: true })`. Automatic quantization moves vertices and should not be used for internal data transfers. Disabling quantization cannot restore precision already lost in stored data; reimport the original file instead.

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [ExportOptions](/mapseekai/emap/api/interfaces/emap.ExportOptions.html)
- [registerFormat](/mapseekai/emap/api/functions/emap.registerFormat.html)
- [DatasetFormatPlugin](/mapseekai/emap/api/interfaces/emap.DatasetFormatPlugin.html)
- [initParquetWasm](/mapseekai/emap/api/functions/arrow.initParquetWasm.html)
- [setParquetWasm](/mapseekai/emap/api/functions/arrow.setParquetWasm.html)

## Runnable examples

- [Export formats](/mapseekai/emap/examples/export-formats/)
- [FlatGeobuf viewer](/mapseekai/emap/examples/flatgeobuf-viewer/)
- [GeoParquet viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [KML viewer](/mapseekai/emap/examples/getting-started/kml-viewer/)

## GeoPackage

The optional `/geopackage` entry imports vector tables directly from SQLite/WKB into typed arrays without GeoJSON. It returns one multi-layer dataset and supports Workers, CRS normalization and cancellation. See [direct GeoPackage import](geopackage.md). GeoPackage export is not provided.

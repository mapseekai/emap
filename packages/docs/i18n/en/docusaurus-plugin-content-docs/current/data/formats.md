---
id: formats
slug: /data/formats
title: Data formats
api: ["buildGeoMetadata","crsStringToProjjson","DatasetFormatPlugin","decodeWkb","detectGeometryColumn","Emap","ExportedFormatFile","exportGeoArrow","ExportGeoArrowOptions","exportGeoParquet","ExportGeoParquetOptions","fromArrowTable","FromArrowTableOptions","GeoColumnMetadata","GeoEncoding","GeoMetadata","GeometryColumnInfo","importGeoArrow","ImportGeoArrowOptions","importGeoParquet","ImportGeoParquetOptions","initParquetWasm","InitParquetWasmOptions","ParquetWasmModule","ParquetWasmTable","parseGeoMetadata","projjsonToCrsString","registerArrowFormats","registerFormat","setArrowTable","setParquetWasm","toArrowTable","toArrowTableFromSource","ToArrowTableOptions","TopologySource.export","TopologySource.fromBytes","TopologySource.fromUrl","WkbGeometry","WkbWriter"]
examples: ["duckdb-geoparquet-query","export-formats","flatgeobuf-viewer","geoparquet-viewer"]
stability: stable
verifiedVersion: 0.8.1
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
| GeoParquet | `.parquet`, `.geoparquet` | yes | yes | `@mapseekai/emap/arrow` |
| GeoArrow | `.arrow`, `.arrows`, `.feather` | yes | yes | `@mapseekai/emap/arrow` |
| FlatGeobuf | `.fgb` | after registration | after registration | application-local plugin (`flatgeobuf`); not core or `@mapseekai/emap/arrow` |

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
import '@mapseekai/emap/arrow';
```

`@mapseekai/emap/arrow` is a `package.json` export subpath. Configure a modern
TypeScript resolver before importing it; see
[Installation](../getting-started/installation.md) for browser-bundler, native
Node ESM, and legacy-resolver requirements.


This side-effect import registers format plugins. GeoArrow does not need WASM.
GeoParquet lazily imports `parquet-wasm` on first use. Bundlers such as Vite and
webpack 5 normally emit the WASM asset automatically.

Set an explicit WASM location:

```ts
import { initParquetWasm } from '@mapseekai/emap/arrow';

await initParquetWasm({
  wasmInput: '/assets/parquet_wasm_bg.wasm',
});
```

Or inject an already initialized module:

```ts
import { setParquetWasm } from '@mapseekai/emap/arrow';

setParquetWasm(parquetModule);
```

`initParquetWasm({ module })` is not a current signature. Use `wasmInput`, or
inject through `setParquetWasm(module)`.

## Enable FlatGeobuf

FlatGeobuf is not a core format and is not part of `@mapseekai/emap/arrow`.
Install its separate dependency:

```bash
pnpm add flatgeobuf
```

Adapt or copy
[`installFlatGeobufFormat`](https://github.com/mapseekai/emap/blob/master/packages/examples/src/flatgeobuf-format.ts)
into an application-local module, then import and call it before the first
`.fgb` import or export:

```ts
import * as emap from '@mapseekai/emap';
import { installFlatGeobufFormat } from './flatgeobuf-format';

installFlatGeobufFormat(emap);
```

Pass the `@mapseekai/emap` module namespace: the helper calls the module-level
`registerFormat` and `getDefaultMapshaperAdapter` APIs, so an `Emap` instance is
not valid. There is no `@mapseekai/emap/flatgeobuf` export. The current example
helper buffers the whole file and has no streaming or range reads. It reads an
EPSG code from the FlatGeobuf header; on export, it writes that code only when
the dataset CRS is an `EPSG:<number>` identifier.

After registration, load with an `.fgb` filename and export with:

```ts
const blob = await source.export({ format: 'flatgeobuf' });
```

See the complete integration in the [FlatGeobuf viewer](/mapseekai/emap/examples/flatgeobuf-viewer/).

## Arrow table interoperability

```ts
import {
  fromArrowTable,
  setArrowTable,
  toArrowTableFromSource,
} from '@mapseekai/emap/arrow';

await setArrowTable(source, duckdbResultTable);
const table = toArrowTableFromSource(source);
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

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [ExportOptions](/mapseekai/emap/api/interfaces/emap.ExportOptions.html)
- [initParquetWasm](/mapseekai/emap/api/functions/arrow.initParquetWasm.html)
- [setParquetWasm](/mapseekai/emap/api/functions/arrow.setParquetWasm.html)
- [toArrowTable](/mapseekai/emap/api/functions/arrow.toArrowTable.html)
- [registerFormat](/mapseekai/emap/api/functions/emap.registerFormat.html)
- [DatasetFormatPlugin](/mapseekai/emap/api/interfaces/emap.DatasetFormatPlugin.html)
- [ExportedFormatFile](/mapseekai/emap/api/interfaces/emap.ExportedFormatFile.html)

## Runnable examples

- [DuckDB GeoParquet query](/mapseekai/emap/examples/duckdb-geoparquet-query/)
- [Export formats](/mapseekai/emap/examples/export-formats/)
- [FlatGeobuf viewer](/mapseekai/emap/examples/flatgeobuf-viewer/)
- [GeoParquet viewer](/mapseekai/emap/examples/geoparquet-viewer/)

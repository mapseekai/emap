---
id: formats
slug: /data/formats
title: Data formats
api: ["buildGeoMetadata", "crsStringToProjjson", "DatasetFormatPlugin", "decodeWkb", "detectGeometryColumn", "Emap", "ExportedFormatFile", "exportGeoArrow", "ExportGeoArrowOptions", "exportGeoParquet", "ExportGeoParquetOptions", "fromArrowTable", "FromArrowTableOptions", "GeoColumnMetadata", "GeoEncoding", "GeoMetadata", "GeometryColumnInfo", "importGeoArrow", "ImportGeoArrowOptions", "importGeoParquet", "ImportGeoParquetOptions", "initParquetWasm", "InitParquetWasmOptions", "ParquetWasmModule", "ParquetWasmTable", "parseGeoMetadata", "projjsonToCrsString", "registerArrowFormats", "registerFormat", "setArrowTable", "setParquetWasm", "toArrowTable", "toArrowTableFromSource", "ToArrowTableOptions", "TopologySource.export", "TopologySource.fromBytes", "TopologySource.fromUrl", "WkbGeometry", "WkbWriter", "TopologySource", "ExportOptions", "TopologySource.setData"]
examples: ["export-formats","getting-started/kml-viewer","flatgeobuf-viewer","geoparquet-viewer"]
stability: stable
verifiedVersion: 0.14.0
---

# Data formats

Emap loads, stores, and exports vector data through `TopologySource`. Core formats work out of the box; optional entries provide GeoPackage, GeoParquet, and GeoArrow; register a format plugin to read and write FlatGeobuf.

Use the File/handle entry points in the [raster integration](./geotiff.md) for GeoTIFF/BigTIFF. Original files remain external, and files above 2GiB require valid pyramids.

```ts
const source = await TopologySource.fromUrl('districts', '/data/districts.geojson'); // load data by URL and extension
await map.addSource('districts', source); // add the data to the map
const blob = await source.export({ format: 'geojson' }); // export the current dataset
```

## Core methods

| Method | Parameters | Description |
| --- | --- | --- |
| `TopologySource.fromUrl(name, url)` | `string`, `string` | Load from a URL. |
| `TopologySource.fromBytes(name, bytes, options?)` | `string`, `Uint8Array`, `TopologySourceOptions` | Load from bytes. |
| `source.setData(data)` | URL, file, or file array | Replace source data. |
| `source.export(options)` | `ExportOptions` | Export the dataset as a `Blob`. |

## Core formats

| Format | File extensions | Import | Export |
| --- | --- | --- | --- |
| GeoJSON | `.geojson`, `.json` | yes | yes |
| TopoJSON | `.topojson`, `.json` | yes | yes |
| Shapefile ZIP | `.zip` | yes | yes, ZIP Blob |
| KML | `.kml` | yes | Export imported data as GeoJSON or another vector format |
| mapshaper snapshot | `.msx` | yes | yes |

GeoJSON, TopoJSON, and KML without CRS metadata use `EPSG:4326`.

## More formats and plugins

| Format | File extensions | Import | Export | Entry point |
| --- | --- | --- | --- | --- |
| GeoPackage | `.gpkg` | yes | Export imported data as GeoParquet | `@mapseekai/emap/geopackage` |
| GeoParquet | `.parquet`, `.geoparquet` | yes | yes | `@mapseekai/emap/arrow` |
| GeoArrow | `.arrow`, `.arrows`, `.feather` | yes | yes | `@mapseekai/emap/arrow` |
| FlatGeobuf | `.fgb` | after registration | after registration | application-registered plugin |

## Loading data

Three entry points share `TopologySourceOptions`:

```ts
// Load from a URL; the path or response Content-Type identifies the format
const source = await TopologySource.fromUrl('districts', '/data/districts.geojson');

// Load from bytes; the filename extension selects the importer
const source = await TopologySource.fromBytes('upload', bytes, { filename: file.name });

// Reload an existing source; a later load supersedes an unresolved one
await source.setData({ filename: 'roads.topojson', content: bytes });
```

`setData()` completion fires `data`; each file-array item becomes a layer.

Core `TopologySourceOptions` parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `formats` | `FormatRegistryContract` | empty registry | Plugin-format registry. |
| `resourceLimits.maxInputBytes` | `number` | 2 GiB | Raw-byte ceiling per import. |
| `zipLimits` | `ZipExtractionLimits` | see below | Shapefile ZIP extraction limits. |
| `adapter` | `MapshaperAdapter` | default adapter | mapshaper adapter. |

`zipLimits` thresholds:

| Parameter | Default | Description |
| --- | --- | --- |
| `maxCompressedBytes` | 2 GiB | Compressed-input ceiling. |
| `maxBytes` | 2 GiB | Kept-entry uncompressed-size ceiling. |
| `maxEntries` | 5000 | Entry-count ceiling. |
| `maxRatio` | 100 | Expansion-ratio ceiling; ZIP-bomb defense. |

Tighten these thresholds for public uploads.

## Exporting data

`TopologySource.export()` serializes the in-memory dataset at full precision to a `Blob`:

```ts
const blob = await source.export({ format: 'geojson' });
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'districts.geojson';
link.click();
URL.revokeObjectURL(url);
```

Core `ExportOptions` parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `format` | `ExportFormat` | required | Export format. |
| `layer` | `number \| string` | `0` | GeoParquet / GeoArrow layer. |
| `encoding` | `'wkb' \| 'native'` | see below | GeoParquet / GeoArrow geometry encoding. |
| `quantization` | `boolean` | `false` | Lossy TopoJSON coordinate quantization. |

- **GeoJSON**: single-file `application/geo+json`.
- **TopoJSON**: unquantized by default; `quantization: true` trades precision for size.
- **Shapefile**: ZIP Blob of `.shp`, `.shx`, `.dbf`, and optional `.prj`.
- **mapshaper snapshot**: `.msx`, `application/octet-stream`.
- **GeoParquet**: `wkb` by default; one layer per call.
- **GeoArrow**: `native` by default; one layer per call.

## Format notes

### GeoJSON, TopoJSON, KML

The core package parses these three text formats.

### Shapefile ZIP

Pass a complete ZIP containing at least `.shp`; matching `.dbf`, `.shx`, and `.prj` provide attributes, indexes, and CRS, while duplicate basenames error.

### GeoParquet and GeoArrow

`/arrow` provides both formats; mounting `arrowFormatsPlugin` enables map-instance I/O. It requires `apache-arrow`, and GeoParquet also needs `parquet-wasm`:

```bash
pnpm add apache-arrow
pnpm add parquet-wasm # GeoParquet only
```

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);
```

`parquet-wasm` loads on first GeoParquet use; an application can instead supply WASM or a module:

```ts
import { initParquetWasm, setParquetWasm } from '@mapseekai/emap/arrow';

await initParquetWasm({ wasmInput: '/assets/parquet_wasm_bg.wasm' });
setParquetWasm(parquetModule);
```

On import, `geometryColumn` overrides geometry-column detection; on export, use `layer` and `encoding`.

### FlatGeobuf

Install `flatgeobuf`, then register `registerFormat(map.formats, codec)`; the plugin provides `.fgb` I/O. See the [FlatGeobuf viewer](/mapseekai/emap/examples/flatgeobuf-viewer/).

### GeoPackage

`/geopackage` decodes vector tables from SQLite/WKB directly into a typed-buffer dataset with main-thread and Worker import, CRS normalization, and cancellation:

```ts
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';
await map.ctx.plugin(
  geoPackagePlugin({
    workerUrl: '/assets/emap-geopackage-worker.js',
    wasmUrl: '/assets/sql-wasm.wasm',
  }),
);
```

Parameters: `layers`, `targetCrs`, `wasmUrl`, `workerUrl`, `signal`, `onProgress`; export GeoParquet to write. See [direct GeoPackage import](geopackage.md).

## Advanced format registration

Core formats are built into the `TopologySource` mapshaper adapter; plugin formats register in instance-scoped `map.formats`. Pass `formats` when constructing a `TopologySource` to join the registry.

```text
Import                                  Export
file / URL / bytes                      export({ format, layer, encoding })
        │                                        │
        ▼ by extension                     ▼ by format name
          getFormatForExtension              getExportHandler
  ┌──────────────┐                      ┌──────────────┐
  │ plugin match?│                      │ plugin match?│ ← matches exportFormats keys
  └──────┬───────┘                      └──────┬───────┘
   yes   │    │ no                      yes   │    │ no
         ▼    ▼                               ▼    ▼
     plugin  mapshaper                    handler  mapshaper
     importBinary core import             (dataset, core export
         │    │                          options)     │
         └──┬─┘                            └───┬─────┘
            ▼                                  ▼
     MapshaperDataset              ExportedFormatFile[]
                                            │ MIME from mimeTypes[format]
                                            ▼
                                          Blob
```

### Registration and lifecycle

- `register(plugin)` requires globally unique plugin names, extensions, and `exportFormats` keys.
- The registry freezes plugins and manages calls with `AbortController`; unregistering or disposal settles waiters with AbortError.
- `provider.formats` releases the registry with the map; `/arrow` and `/geopackage` feature plugins unregister automatically.
- Plugin formats import one file; core formats support mixed multi-file imports.

### Format plugin contract

A plugin format implements `DatasetFormatPlugin`:

```ts
interface DatasetFormatPlugin {
  name: string; // unique registration key, used for unregister and conflict detection
  extensions: readonly string[]; // import matches by extension (no dot)
  importBinary(content: Uint8Array, filename: string): Promise<MapshaperDataset>;
  exportFormats: {
    // export({ format }) matches keys here
    [format: string]: (dataset, options?) => Promise<ExportedFormatFile[]>;
  };
  mimeTypes?: { [format: string]: string }; // Blob MIME per export format
}
```

Registration:

```ts
// Option 1: a Cordis plugin, unregistered automatically with its lifecycle (used by built-in optional entries)
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);

// Option 2: manual registration of an application-local codec; returns an unregister function
import { registerFormat } from '@mapseekai/emap';
const unregister = registerFormat(map.formats, myCodec);
```

Pass the map registry when constructing an independent source:

```ts
const source = new TopologySource('upload', { formats: map.formats });
```

## Developing a format plugin

To integrate a format: install a parser → implement `DatasetFormatPlugin` → register it on `map.formats`. CSV example:

```ts
import type { DatasetFormatPlugin } from '@mapseekai/emap';

// Complete runnable example: name,lon,lat CSV with a header row
const geoCsvCodec: DatasetFormatPlugin = {
  name: 'geocsv',
  extensions: ['geocsv'],
  async importBinary(content, filename) {
    const lines = new TextDecoder().decode(content).trim().split('\n');
    const shapes: [number, number][][] = [];
    const records: Record<string, unknown>[] = [];
    for (const line of lines.slice(1)) {
      const [name, lon, lat] = line.split(',');
      shapes.push([[Number(lon), Number(lat)]]); // point feature: array of coordinate pairs
      records.push({ name, lon: Number(lon), lat: Number(lat) });
    }
    return {
      layers: [
        {
          name: filename.replace(/\.geocsv$/, ''),
          geometry_type: 'point',
          shapes,
          data: {
            // attribute table: mapshaper DataTable (layer.data)
            getRecords: () => records,
            getRecordAt: (i) => records[i],
            getFields: () => ['name', 'lon', 'lat'],
            size: () => records.length,
          },
        },
      ],
      info: { crs_string: 'EPSG:4326' },
    };
  },
  exportFormats: {
    geocsv: async (dataset) => {
      const layer = dataset.layers[0];
      const rows = (layer.data?.getRecords() ?? []).map((r) => `${r.name},${r.lon},${r.lat}`);
      return [
        {
          filename: `${layer.name ?? 'layer'}.geocsv`,
          content: ['name,lon,lat', ...rows].join('\n'),
        },
      ];
    },
  },
  mimeTypes: { geocsv: 'text/csv' },
};
```

Codec implementation requirements:

- A codec is pure binary I/O and runs on the main thread or in a Worker.
- `importBinary` returns editable `layers`, `shapes`, `data`, and `info.crs_string`.
- Export handlers return `ExportedFormatFile[]`; only `shapefile` supports multi-file ZIP.
- On unregister or map disposal, waiting calls settle with AbortError; codecs may check an external AbortSignal.

Once registered, use the format like any other:

```ts
import { registerFormat, TopologySource } from '@mapseekai/emap';

const unregister = registerFormat(map.formats, geoCsvCodec);

const source = await TopologySource.fromBytes('upload', bytes, {
  filename: 'cities.geocsv',
  formats: map.formats,
});
await map.addSource('upload', source);

const blob = await source.export({ format: 'geocsv' });

// Unregister when the format is no longer needed; map disposal unregisters all formats automatically
unregister();
```

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

---
id: file-upload
slug: /recipes/file-upload
title: File upload
api: ["TopologySource.fromBytes", "TopologySource", "TopologySourceFromBytesOptions"]
examples: ["flatgeobuf-viewer", "geoparquet-viewer", "getting-started/points"]
stability: stable
verifiedVersion: 0.13.0
---

# File upload

Use `TopologySource.fromBytes` to import a browser `File`, then add the returned source to an `Emap`.

```ts
const file = input.files?.[0] // read the selected browser file
if (!file) return // stop when no file is selected

const source = await TopologySource.fromBytes("upload", await file.arrayBuffer(), {
  filename: file.name, // select the importer from the extension
  formats: map.formats, // include registered format plugins
  resourceLimits: {
    maxInputBytes: 50 * 1024 * 1024, // cap raw input
  },
  zipLimits: {
    maxCompressedBytes: 50 * 1024 * 1024, // cap ZIP input
    maxBytes: 200 * 1024 * 1024, // cap extracted bytes
    maxEntries: 1_000, // cap ZIP entries
    maxRatio: 100, // reject ZIP bombs
  },
})
await map.addSource(source.id, source) // add the imported source
```



## Core parameters

### `TopologySource.fromBytes(id, bytes, options?)`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | Required | Returned source identifier. |
| `bytes` | `Uint8Array \| ArrayBuffer` | Required | Raw file bytes; `ArrayBuffer` converts to `Uint8Array`. |
| `options` | `TopologySourceFromBytesOptions` | Omitted | Importer, format registry, and resource ceilings. |

## More import options

`TopologySourceFromBytesOptions` adds `filename` to `TopologySourceOptions` without `data`; its other options also apply to the constructor.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `filename` | `string` | `` `${id}.geojson` `` | Import filename; its extension selects the format. Keep `file.name` for uploads. Core extensions: `.geojson`, `.topojson`, `.json`, `.zip`, `.shp`, `.kml`, `.msx`. |
| `formats` | `FormatRegistryContract` | Separate empty `FormatRegistry` | Format plugin registry; pass `map.formats` for plugin formats. |
| `resourceLimits` | `Partial<ImportResourceLimits>` | Fields merge with defaults | Raw-input resource ceilings. |
| `resourceLimits.maxInputBytes` | `number` | `2 * 1024 ** 3` (2 GiB) | Raw-byte ceiling per logical import; URL, memory, and plugin imports share it; `setData` arrays total all files. |
| `zipLimits` | `ZipExtractionLimits` | Fields merge with the defaults below | Shapefile ZIP extraction ceilings. |
| `zipLimits.maxCompressedBytes` | `number` | `2 * 1024 ** 3` (2 GiB) | Compressed ZIP input ceiling. |
| `zipLimits.maxBytes` | `number` | `2 * 1024 ** 3` (2 GiB) | Extracted-byte ceiling across retained ZIP entries. |
| `zipLimits.maxEntries` | `number` | `5000` | ZIP entry ceiling. |
| `zipLimits.maxRatio` | `number` | `100` | Maximum extracted-to-compressed ratio; protects against ZIP bombs. |
| `adapter` | `MapshaperAdapter` | Default mapshaper adapter | Adapter for core import, export, transformation, and bounds. |

## Replace source data

`setData` reimports a source with external data and returns `Promise<TopologySource>`; it resolves after commit and `data`, and reports exceptions through the Promise and `error`. The latest consecutive call owns the next `data` / `error` result, preventing stale file-picker results.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `TopologySourceInput` | Required | URL, one file, or file array; uses the source's `formats`, `resourceLimits`, and `zipLimits`. |
| `data` (URL) | `string` | — | URL import; path extension selects the format, or response `Content-Type` can infer one. |
| `data.filename` | `string` | Required | File name; its extension selects a core importer or plugin. |
| `data.content` | `Uint8Array` | Required | File bytes; `setData` accepts `Uint8Array`. |
| `data[]` | `Array<{ filename: string; content: Uint8Array }>` | — | Multi-file import; each file becomes a dataset layer; ZIP expands primary Shapefile files. |

## Create a reusable source

The constructor reuses a source through `setData`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | Required | Source identifier. |
| `options` | `TopologySourceOptions` | Omitted | Supports the `formats`, `resourceLimits`, `zipLimits`, `adapter`, and `data` above. |
| `options.data` | `TopologySourceInput` | Omitted | Starts import at construction; `await source.setData(data)` when awaiting the result. |

## API

- `TopologySource`
- `TopologySourceFromBytesOptions`

## Runnable examples

- [GeoParquet viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [FlatGeobuf viewer](/mapseekai/emap/examples/flatgeobuf-viewer/)
- [Getting started: points](/mapseekai/emap/examples/getting-started/points/)

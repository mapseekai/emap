---
id: file-upload
slug: /recipes/file-upload
title: File upload
api: ["TopologySource.fromBytes", "TopologySource", "TopologySourceFromBytesOptions"]
examples: ["flatgeobuf-viewer", "geoparquet-viewer", "getting-started/points"]
stability: stable
verifiedVersion: unreleased
---

# File upload

Use `TopologySource.fromBytes` to import a browser `File`. The filename extension selects the importer; once loading succeeds, add the returned source to an `Emap`.

## Upload with ZIP extraction limits

Set `zipLimits` for ZIP uploads to cap compressed input, extracted bytes, entry count, and compression ratio. `fromBytes` rejects when import fails, so handle the error at the application boundary and keep the map usable.

```ts
const file = input.files?.[0]
if (!file) return

const source = await TopologySource.fromBytes("upload", await file.arrayBuffer(), {
  filename: file.name,
  zipLimits: {
    maxCompressedBytes: 50 * 1024 * 1024,
    maxBytes: 200 * 1024 * 1024,
    maxEntries: 1_000,
    maxRatio: 100,
  },
})
await map.addSource(source.id, source)
```

Keep the selected filename in `filename`. Core import supports GeoJSON, TopoJSON, Shapefile ZIP, KML, MSX, and other registered formats. `@mapseekai/emap/arrow` supplies GeoParquet and GeoArrow support; FlatGeobuf requires the application to register its format plugin.

## API

- `TopologySource`
- `TopologySourceFromBytesOptions`

## Runnable examples

- [GeoParquet viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [FlatGeobuf viewer](/mapseekai/emap/examples/flatgeobuf-viewer/)
- [Getting started: points](/mapseekai/emap/examples/getting-started/points/)
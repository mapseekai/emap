---
id: file-upload
slug: /recipes/file-upload
title: File upload
api: ["TopologySource.fromBytes"]
examples: ["flatgeobuf-viewer","geoparquet-viewer","getting-started/points"]
stability: stable
verifiedVersion: 0.8.1
---

# File upload

Use `TopologySource.fromBytes` for browser file inputs. Keep the original filename so mapshaper can choose the importer and preserve format-specific sidecar behavior.

## Behavior notes

Catch load errors, display a retryable message, and add the source/layer only after the promise resolves.

Before loading a FlatGeobuf `.fgb` upload, the application must register its
local `flatgeobuf` format plugin. This is not a core or
`@mapseekai/emap/arrow` package entry. Follow the
`installFlatGeobufFormat(emap)` setup in [Data formats](../data/formats.md);
`emap` is the module namespace, not an `Emap` map instance. Register first,
then call `fromBytes`; see the
[FlatGeobuf viewer](/mapseekai/emap/examples/flatgeobuf-viewer/).

## API

- [src.TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [src.TopologySourceFromBytesOptions](/mapseekai/emap/api/interfaces/emap.TopologySourceFromBytesOptions.html)

## Runnable examples

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [flatgeobuf-viewer](/mapseekai/emap/examples/flatgeobuf-viewer/)
- [getting-started/points](/mapseekai/emap/examples/getting-started/points/)

## Minimal snippet

```ts
const file = input.files?.[0]
if (!file) throw new Error("Choose a file")
const source = await TopologySource.fromBytes("upload", await file.arrayBuffer(), {
  filename: file.name,
})
```

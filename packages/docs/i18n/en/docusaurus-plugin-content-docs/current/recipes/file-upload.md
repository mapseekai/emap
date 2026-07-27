---
id: file-upload
slug: /recipes/file-upload
title: File upload
api: ["TopologySource.fromBytes"]
examples: ["geoparquet-viewer","getting-started/points"]
stability: stable
verifiedVersion: 0.5.0
---

# File upload

Use `TopologySource.fromBytes` for browser file inputs. Keep the original filename so mapshaper can choose the importer and preserve format-specific sidecar behavior.

## Behavior notes

Catch load errors, display a retryable message, and add the source/layer only after the promise resolves.

## API

- [src.TopologySource](https://zwishing.github.io/emap/api/classes/index.TopologySource.html)
- [src.TopologySourceFromBytesOptions](https://zwishing.github.io/emap/api/interfaces/index.TopologySourceFromBytesOptions.html)

## Runnable examples

- [geoparquet-viewer](https://zwishing.github.io/emap/examples/geoparquet-viewer/)
- [getting-started/points](https://zwishing.github.io/emap/examples/getting-started/points/)

## Minimal snippet

```ts
const file = input.files?.[0]
const source = await TopologySource.fromBytes("upload", await file.arrayBuffer(), { filename: file.name })
```

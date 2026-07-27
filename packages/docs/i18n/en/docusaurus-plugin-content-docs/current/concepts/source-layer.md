---
slug: /concepts/source-layer
title: Sources and layers
---

# Sources and layers

A `TopologySource` owns imported mapshaper data. A `LayerSpecification` selects one source layer and describes how it is painted.

## Behavior notes

Layer `id` must be stable and unique. `type` is `fill`, `line`, or `circle`. `source-layer` is optional for multi-layer datasets; omit it to render the first compatible layer.

## API

- [src.TopologySource](https://zwishing.github.io/emap/api/classes/index.TopologySource.html)
- [src.LayerSpecification](https://zwishing.github.io/emap/api/interfaces/index.LayerSpecification.html)

## Runnable examples

- [getting-started/points](https://zwishing.github.io/emap/examples/getting-started/points/)
- [merge-layers](https://zwishing.github.io/emap/examples/merge-layers/)

## Minimal snippet

```ts
const source = await TopologySource.fromBytes("points", bytes, { filename: "points.geojson" })
map.addLayer({ id: "points-circle", type: "circle", source: "points" })
```

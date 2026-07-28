---
id: source-layer
slug: /concepts/source-layer
title: Sources and layers
api: ["CirclePaint","DatasetFormatPlugin","Emap","ExportedFormatFile","ExportFormat","ExportOptions","FillPaint","ITopologySource","LayerLayout","LayerPaint","LayerSpecification","LayerType","LinePaint","registerFormat","resolvePointStyle","resolveStrokeStyle","TopologySource","TopologySource.fromBytes","TopologySourceData","TopologySourceFromBytesOptions","TopologySourceInput","TopologySourceOptions","ZipExtractionLimits"]
examples: ["getting-started/geojson-viewer","getting-started/lines","getting-started/points","merge-layers","rename-layer","split-layer"]
stability: stable
verifiedVersion: 0.5.0
---

# Sources and layers

A `TopologySource` owns imported mapshaper data. A `LayerSpecification` selects one source layer and describes how it is painted.

## Behavior notes

Layer `id` must be stable and unique. `type` is `fill`, `line`, or `circle`. `source-layer` is optional for multi-layer datasets; omit it to render the first compatible layer.

## API

- [src.TopologySource](/emap/api/classes/index.TopologySource.html)
- [src.LayerSpecification](/emap/api/interfaces/index.LayerSpecification.html)

## Runnable examples

- [getting-started/points](/emap/examples/getting-started/points/)
- [merge-layers](/emap/examples/merge-layers/)

## Minimal snippet

```ts
const source = await TopologySource.fromBytes("points", bytes, { filename: "points.geojson" })
map.addLayer({ id: "points-circle", type: "circle", source: "points" })
```

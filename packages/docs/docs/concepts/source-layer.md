---
id: source-layer
slug: /concepts/source-layer
title: 数据源与图层
api: ["CirclePaint","DatasetFormatPlugin","Emap","ExportedFormatFile","ExportFormat","ExportOptions","FillPaint","ITopologySource","LayerLayout","LayerPaint","LayerSpecification","LayerType","LinePaint","registerFormat","resolvePointStyle","resolveStrokeStyle","TopologySource","TopologySource.fromBytes","TopologySourceData","TopologySourceFromBytesOptions","TopologySourceInput","TopologySourceOptions","ZipExtractionLimits"]
examples: ["getting-started/geojson-viewer","getting-started/lines","getting-started/points","merge-layers","rename-layer","split-layer"]
stability: stable
verifiedVersion: 0.5.0
---

# 数据源与图层

`TopologySource` 保存导入后的 mapshaper 数据。`LayerSpecification` 选择其中一个 source layer，并声明渲染样式。

## 行为说明

图层 `id` 必须稳定且唯一。`type` 可为 `fill`、`line` 或 `circle`。多图层数据可设置 `source-layer`；省略时渲染第一个兼容图层。

## API

- [src.TopologySource](/emap/api/classes/index.TopologySource.html)
- [src.LayerSpecification](/emap/api/interfaces/index.LayerSpecification.html)

## 可运行示例

- [getting-started/points](/emap/examples/getting-started/points/)
- [merge-layers](/emap/examples/merge-layers/)

## 最小片段

```ts
const source = await TopologySource.fromBytes("points", bytes, { filename: "points.geojson" })
map.addLayer({ id: "points-circle", type: "circle", source: "points" })
```

---
id: faq
slug: /reference/faq
title: FAQ
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# FAQ

地图空白时，检查容器尺寸、source 加载状态、layer type/source ID 和相机范围。

## 行为说明

操作失败时，检查 expression policy、缺失 fixture、CRS 约束，以及可选 WASM 依赖是否已初始化。

## API

- [src.Emap](/emap/api/classes/index.Emap.html)
- [src.TopologySource](/emap/api/classes/index.TopologySource.html)

## 可运行示例

- [getting-started/geojson-viewer](/emap/examples/getting-started/geojson-viewer/)
- [duckdb-query](/emap/examples/duckdb-query/)

## 最小片段

```ts
if (source.getExtent().hasBounds()) map.setExtent(source.getExtent())
```

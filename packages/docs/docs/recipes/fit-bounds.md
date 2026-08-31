---
id: fit-bounds
slug: /recipes/fit-bounds
title: 适配范围
api: ["Emap"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.8.1
---

# 适配范围

加载 source 后读取范围并适配相机。用户上传或过滤后的图层可能为空，因此要判断空范围。

## 行为说明

首次加载、测试和示例使用 `duration: 0`；首个有效渲染之后再使用动画 duration。

## API

- [src.Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [src.FitBoundsOptions](/mapseekai/emap/api/interfaces/emap.FitBoundsOptions.html)

## 可运行示例

- [getting-started/geojson-viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [getting-started/polygon-fill](/mapseekai/emap/examples/getting-started/polygon-fill/)

## 最小片段

```ts
const extent = source.getExtent()
if (extent.hasBounds()) map.fitBounds(extent, { padding: 48, duration: 0 })
```

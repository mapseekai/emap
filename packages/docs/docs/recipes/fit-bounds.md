---
id: fit-bounds
slug: /recipes/fit-bounds
title: 适配范围
api: ["Emap", "Bounds", "FitBoundsOptions"]
examples: ["getting-started/geojson-viewer", "getting-started/polygon-fill"]
stability: stable
verifiedVersion: 0.9.0
---

# 适配范围

数据源加载完成后，用它的 `Bounds` 调整相机。空数据源和过滤后没有要素的数据源会返回空范围，调用 `fitBounds` 前应检查 `hasBounds()`。

## 适配已加载数据

```ts
const extent = source.getExtent()
if (extent.hasBounds()) {
  map.fitBounds(extent, { padding: 48, duration: 0 })
}
```

`padding` 为四周保留像素空间，`duration` 控制相机动画时长。首次展示数据时使用 `duration: 0` 可立即显示范围；交互触发的视图调整可使用动画时长。

## API

- `Emap`
- `Bounds`
- `FitBoundsOptions`

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [面填充](/mapseekai/emap/examples/getting-started/polygon-fill/)
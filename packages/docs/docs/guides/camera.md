---
id: camera
slug: /guides/camera
title: 相机
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# 相机

相机 API 在数据范围、地图坐标和 Canvas 像素之间转换。优先使用相机方法，不要修改 viewport 内部状态。

## 行为说明

`fitBounds` 支持 padding 和 duration；测试或首次绘制使用 `duration: 0`。用户手势会停止当前动画。

## API

- [src.Emap](/emap/api/classes/index.Emap.html)
- [src.FitBoundsOptions](/emap/api/interfaces/index.FitBoundsOptions.html)
- [src.FlyToOptions](/emap/api/interfaces/index.FlyToOptions.html)

## 可运行示例

- [getting-started/geojson-viewer](/emap/examples/getting-started/geojson-viewer/)
- [crs-switch](/emap/examples/crs-switch/)

## 最小片段

```ts
map.fitBounds(source.getExtent(), { padding: 48, duration: 0 })
map.flyTo({ center: [120, 30], zoom: 7 })
```

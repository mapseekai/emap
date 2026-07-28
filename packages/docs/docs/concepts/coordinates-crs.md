---
id: coordinates-crs
slug: /concepts/coordinates-crs
title: 坐标与 CRS
api: ["AffineTransform","AnimationOptions","Bounds","CameraOptions","DEFAULT_CRS","Emap","FitBoundsOptions","FlyToOptions","inferFromPrj","normalizeCrsString","Projection","resolveDatasetCRS","Viewport"]
examples: ["crs-switch","project"]
stability: stable
verifiedVersion: 0.5.0
---

# 坐标与 CRS

地图坐标来自数据源 CRS，屏幕坐标来自 Canvas 视口。使用 `project`、`unproject`、`fitBounds` 和 `setExtent`，不要手写矩阵。

## 行为说明

导入时会尽量读取 CRS 元数据。投影操作会更新 dataset 坐标并进入历史；地理坐标缓冲区应显式处理距离行为。

## API

- [src.Emap](/emap/api/classes/index.Emap.html)
- [src.resolveDatasetCRS](/emap/api/functions/index.resolveDatasetCRS.html)

## 可运行示例

- [project](/emap/examples/project/)
- [crs-switch](/emap/examples/crs-switch/)
- [duckdb-buffer](/emap/examples/duckdb-buffer/)

## 最小片段

```ts
const point = map.project([120, 30])
await map.ops.projectLayer({ source: "main", targetCrs: "EPSG:3857" })
```

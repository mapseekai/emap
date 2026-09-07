---
id: performance
slug: /recipes/performance
title: 性能
api: ["Emap"]
examples: ["simplify","simplify-control","web-worker"]
stability: stable
verifiedVersion: 0.9.0
---

# 性能

保持渲染工作量小：使用图层可见性、简化、Worker 路由和稳定 paint 对象，不要在每次交互时重新加载数据。

## 行为说明

大型拓扑操作使用 `useWorker: "auto"` 和合适的 `workerThreshold`；小型指针编辑保留在主线程。

大图层在数据载入或替换时预建空间索引，并与要素查询共享。局部视角下，点、线、面只遍历空间候选；视口覆盖大部分数据范围时继续直接扫描，避免大量候选的查询和排序开销。分类线条还会缓存每个样式桶的有序弧列表。

完整绘制超过约 33 ms 时，拖动和缩放会复用已有画布，交互结束后重新精绘。首次建索引需要额外时间和内存，几何编辑后会失效；索引不能减少全图可见的要素数量。Worker 路由用于数据操作，不会自动将 Canvas 绘制移出主线程。

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.MapshaperWorkerPool](/mapseekai/emap/api/classes/emap.MapshaperWorkerPool.html)

## 可运行示例

- [web-worker](/mapseekai/emap/examples/web-worker/)
- [simplify-control](/mapseekai/emap/examples/simplify-control/)
- [simplify](/mapseekai/emap/examples/simplify/)

## 最小片段

```ts
const map = new Emap({ container: "map", useWorker: "auto", workerThreshold: 50000 })
```

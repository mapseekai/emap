---
id: performance
slug: /recipes/performance
title: 性能
api: ["Emap", "MapOptions", "SimplifyOptions"]
examples: ["simplify", "simplify-control", "web-worker"]
stability: stable
verifiedVersion: 0.9.0
---

# 性能

性能工作集中在三处：将大型数据操作路由到 Worker、简化不需要的几何细节，以及减少视口外要素的渲染工作。

## 为大型数据操作启用 Worker

```ts
const map = new Emap({
  container: "map",
  useWorker: "auto",
  workerThreshold: 50_000,
})
```

`useWorker: "auto"` 会在数据集的弧顶点数达到 `workerThreshold` 时，把数据集替换操作路由到 Worker；较小的数据集保留在主线程以避免通信开销。`useWorker: true` 将所有这类操作路由到 Worker。Worker 路由处理数据操作，Canvas 绘制仍在主线程进行。

## 简化和视口裁剪

对线和面执行 `map.ops.simplifyLayer()` 可减少后续渲染和操作处理的顶点数量。选择满足可读性要求的最低细节，并在数据导入后或独立的用户操作中执行简化。

Emap 为大图层建立空间索引，并在局部视图中只遍历视口候选要素。为图层设置 `layout.visibility: "none"` 可跳过不需要显示的图层。全图范围内可见的要素仍须绘制；索引不能减少这些要素的数量。

## API

- `Emap`
- `MapOptions`
- `SimplifyOptions`

## 可运行示例

- [Web Worker](/mapseekai/emap/examples/web-worker/)
- [简化控件](/mapseekai/emap/examples/simplify-control/)
- [几何简化](/mapseekai/emap/examples/simplify/)
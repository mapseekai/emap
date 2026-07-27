---
slug: /recipes/performance
title: 性能
---

# 性能

保持渲染工作量小：使用图层可见性、简化、Worker 路由和稳定 paint 对象，不要在每次交互时重新加载数据。

## 行为说明

大型拓扑操作使用 `useWorker: "auto"` 和合适的 `workerThreshold`；小型指针编辑保留在主线程。

## API

- [src.MapOptions](https://zwishing.github.io/emap/api/interfaces/index.MapOptions.html)
- [src.MapshaperWorkerPool](https://zwishing.github.io/emap/api/classes/index.MapshaperWorkerPool.html)

## 可运行示例

- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)
- [simplify-control](https://zwishing.github.io/emap/examples/simplify-control/)
- [simplify](https://zwishing.github.io/emap/examples/simplify/)

## 最小片段

```ts
const map = new Emap({ container: "map", useWorker: "auto", workerThreshold: 50000 })
```

---
id: worker
slug: /guides/worker
title: Web Worker
api: ["Emap"]
examples: ["web-worker"]
stability: stable
verifiedVersion: 0.5.0
---

# Web Worker

Worker 路由把较重的数据集替换操作移出主线程。细小的选择编辑不会走 Worker，因为序列化开销大于工作本身。

## 行为说明

`useWorker: true` 路由所有符合条件的操作；`auto` 按顶点数和命令成本决定；`workerUrl` 默认 `emap-worker.js`。

## API

- [src.MapshaperWorkerPool](https://zwishing.github.io/emap/api/classes/index.MapshaperWorkerPool.html)
- [src.MapOptions](https://zwishing.github.io/emap/api/interfaces/index.MapOptions.html)

## 可运行示例

- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)

## 最小片段

```ts
const map = new Emap({ container: "map", useWorker: "auto", workerUrl: "/dist/emap-worker.js" })
```

---
id: worker
slug: /guides/worker
title: Web Worker
api: ["Emap", "MapOptions", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions"]
examples: ["web-worker"]
stability: stable
verifiedVersion: unreleased
---

# Web Worker

Emap 可将 dataset-replace 操作放到 Web Worker 执行，使主线程在长时间处理时保持可响应。Worker 需要序列化输入和输出数据，因此适合较重的操作和独立 source 的并发工作。

## 配置路由

在创建地图时设置 `useWorker`：

```ts
const map = await Emap.create({
  container: 'map',
  useWorker: 'auto',
  workerThreshold: 50_000,
  workerUrl: '/assets/emap-worker.js',
  workerPoolSize: 2,
});
```

| `useWorker` | 行为 |
|---|---|
| `false` | 在主线程执行操作 |
| `true` | 通过 Worker 执行 dataset-replace 操作 |
| `'auto'` | 根据 source 顶点数和 `workerThreshold` 路由 |

批量 dataset-replace 操作可在 Worker 中运行；选择级编辑（如顶点命令和移动所选要素）在主线程执行。

## 发布 Worker 资源

应用必须从已安装包发布以下文件，并让 `workerUrl` 指向第一个文件：

```text
node_modules/@mapseekai/emap/dist/emap-worker.js
node_modules/@mapseekai/emap/dist/mapshaper-vendor.js
```

将两个文件保留在同一公开目录，例如：

```text
public/assets/emap-worker.js
public/assets/mapshaper-vendor.js
```

Worker 会从自身目录加载 `mapshaper-vendor.js`。静态服务器必须以 JavaScript 响应这两个 URL，而不是应用 HTML 回退页。

## 使用自有 Worker 池

为多个独立 source 并发操作时，可传入一个池：

```ts
const workerPool = new MapshaperWorkerPool({
  workerUrl: '/assets/emap-worker.js',
  poolSize: 2,
});

const map = await Emap.create({ container: 'map', useWorker: true, workerPool });
```

地图独占管理传入的 `workerPool`，并在 Cordis 卸载过程中销毁它；使用 `await map.dispose()` 等待释放完成。不要把同一个池传给多个地图。

## 可运行示例

- [Web Worker](/mapseekai/emap/examples/web-worker/)

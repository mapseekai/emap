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

Web Worker 路由把较重的 dataset-replace operation 移出主线程。它可以降低长操作期间
界面卡顿，但需要序列化 dataset，并不是所有任务都更快。

## 选择模式

`useWorker` 有三种值：

| 值 | 行为 |
|---|---|
| `false` | 默认；所有 operation 在主线程执行 |
| `true` | 所有符合条件的 dataset-replace operation 进入 Worker |
| `'auto'` | 根据顶点数、命令成本和路由规则选择 |

推荐从 `'auto'` 开始：

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerThreshold: 50000,
  workerUrl: '/assets/emap-worker.js',
});
```

`workerThreshold` 默认 `50000`，表示 source dataset 的 arc vertex count 达到该值时
才进入自动路由判断。`useWorker` 是布尔值时忽略这个阈值。

## 哪些操作适合 Worker

适合的是可能整体替换 dataset 的操作，例如：

- buffer
- clean
- clip / erase
- dissolve / union / mosaic
- simplify
- project

选择、单要素平移、旋转、顶点编辑等交互命令始终留在主线程。它们的工作量通常低于
Worker pack、postMessage 和 unpack 的往返成本。

`useWorker: true` 也只影响符合路由条件的 operation，不会把渲染和浏览器指针事件
移入 Worker。

## 部署静态文件

从包内复制：

```text
node_modules/@mapseekai/emap/dist/emap-worker.js
node_modules/@mapseekai/emap/dist/mapshaper-vendor.js
```

到应用公开目录：

```text
public/
└─ assets/
   ├─ emap-worker.js
   └─ mapshaper-vendor.js
```

默认 Worker 会相对执行：

```js
importScripts('mapshaper-vendor.js');
```

因此两个文件应保持在同一目录。`workerUrl` 相对地址按 `document.baseURI` 解析，
部署在子路径时建议使用经过实际环境验证的公开 URL。

## Worker 池

默认 pool size 为 `1`。应用会同时处理多个独立 source 时可以增加：

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerPoolSize: Math.max(1, navigator.hardwareConcurrency - 1),
  workerUrl: '/assets/emap-worker.js',
});
```

每个 Worker 都加载一份 mapshaper，增加并行度也会增加内存。Worker 延迟创建，
但不要仅因为 CPU 核心多就无条件使用最大数量。

高级应用可以预先构造 `MapshaperWorkerPool` 并通过 `workerPool` 交给一个地图实例。
地图会独占该 pool，并在 `map.remove()` 时取消任务并销毁它；不要把同一个 pool 传给
多个地图。传入 pool 后，`workerUrl` 和 `workerPoolSize` 由该 pool 自己决定。
`useWorker: false` 时 `workerPool` 会被忽略，所有权仍属于调用方。

## 自定义自动路由

`workerRouting` 可以在 `'auto'` 模式覆盖单次决策：

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerRouting: ({ defaultDecision }) => defaultDecision,
});
```

回调可以读取命令集合、顶点数和默认结果。只有掌握业务数据分布并完成实际测量后才覆盖；
默认决策已经区分便宜和昂贵命令。

## 操作和错误状态

Worker operation 与主线程 operation 使用相同的 Promise 和 `OpResult`：

```ts
setBusy(true);

try {
  const result = await map.ops.simplifyLayer({
    source: 'main',
    percentage: 0.25,
  });

  if (!result.ok) {
    showError(result.error);
  }
} finally {
  setBusy(false);
}
```

Worker 池内部 `workerjob*` 信号不是公开 `map.on` 事件。应用加载状态应围绕 operation
Promise 管理。

取消仍在排队或执行的 Worker job：

```ts
map.cancelWorkerJobs();
```

页面离开、数据源被替换或用户显式取消长任务时可以调用。取消后仍要处理当前 Promise
的失败结果。

## 常见问题

### Worker 脚本 404

直接访问 `workerUrl`，确认资源服务器返回 JavaScript 而不是应用的 HTML fallback。

### `mapshaper-vendor.js` 404

Worker 已启动，但相对导入 vendor 失败。把 vendor 文件移动到 worker 同目录，或构建
自己的 Worker bundle。

### 开启后小数据更慢

序列化有固定开销。改用 `useWorker: 'auto'`，并根据真实数据调整 `workerThreshold`。

### Worker 内存过高

降低 `workerPoolSize`。每个池成员包含独立 mapshaper 实例，处理时还可能同时保留
打包输入和输出。

## API

- [MapOptions](/mapseekai/emap/api/interfaces/index.MapOptions.html)
- [MapshaperWorkerPool](/mapseekai/emap/api/classes/index.MapshaperWorkerPool.html)
- [MapshaperWorkerPoolOptions](/mapseekai/emap/api/interfaces/index.MapshaperWorkerPoolOptions.html)

## 可运行示例

- [Web Worker](/mapseekai/emap/examples/web-worker/)

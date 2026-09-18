---
id: worker
slug: /guides/worker
title: Web Worker
api: ["Emap", "MapOptions", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions"]
examples: ["web-worker"]
stability: stable
verifiedVersion: 0.13.0
---

# Web Worker

Emap 可将 dataset-replace 操作交给 Web Worker，使主线程保持响应；独立 source 可并发处理。

```ts
const map = await Emap.create({
  container: 'map', // 挂载地图
  useWorker: 'auto', // 按命令和数据规模路由
  workerThreshold: 50_000, // 达到此顶点数时选择 Worker
  workerUrl: '/assets/emap-worker.js', // 已发布的 Worker bundle
  workerPoolSize: 2, // 最多两个并行 Worker
});
```

## 核心参数

`Emap.create(options)` 的 Worker 相关 `MapOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `useWorker` | `boolean \| 'auto'` | `false` | `false` 主线程执行；`true` 全部路由 Worker；`'auto'` 按命令和数据规模路由。 |
| `workerThreshold` | `number` | `50_000` | `'auto'` 顶点数阈值；达到时选择 Worker。 |
| `workerUrl` | `string` | `'emap-worker.js'` | Worker bundle URL；相对 URL 按 `document.baseURI` 解析。 |
| `workerPoolSize` | `number` | `1` | Worker 槽位数和峰值并行度；按负载惰性创建。 |
| `workerPool` | `MapshaperWorkerPool` | — | 预构造池，优先于 `workerUrl` 和 `workerPoolSize`。 |
| `workerRouting` | `WorkerRoutingFn` | — | 每操作路由决策。 |

## 更多路由控制

Worker 覆盖 mapshaper dataset-replace 路径，包括 `clip`、`dissolve`、`union`、`mosaic`、`simplify` 和 `project`；选择级编辑保持主线程。`'auto'` 的轻量命令保持主线程，重命令阈值为 `floor(workerThreshold × 0.5)`，`classify` 按图层记录数比较该阈值。

`workerRouting` 可覆盖默认决定，`'auto'` 和 `true` 均调用它：

```ts
const map = await Emap.create({
  container: 'map',
  useWorker: 'auto',
  workerRouting: ({ heads, defaultDecision }) => {
    if (heads.includes('buffer')) return true;
    return defaultDecision;
  },
});
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cmd` | `string` | — | 原始命令文本。 |
| `heads` | `string[]` | — | 已解析命令名。 |
| `vertexCount` | `number` | — | source 弧段顶点数。 |
| `recordCount` | `number` | — | 图层记录总数；`classify` 用它衡量规模。 |
| `mode` | `boolean \| 'auto'` | — | 当前 `useWorker` 设置。 |
| `threshold` | `number` | — | 配置的 `workerThreshold`。 |
| `defaultDecision` | `boolean` | — | 引擎默认路由判断。 |

## 结果提交与版本检查

Worker 发送前导出 dataset，返回后还原；`workerjobstart` 和 `workerjobend` 提供 ID、命令、耗时和结果。提交前检查地图生命周期、source、原 dataset、`editVersion`、`attributeVersion` 和事务状态；任一变化时返回 `ok: false`、`error.kind: 'stale-operation'`，保护新状态。

Dataset 替换建立历史边界。`map.cancelWorkerJobs()` 取消进行中和排队任务，池随后按需创建 Worker。

## 发布 Worker 资源

从已安装包发布以下文件，`workerUrl` 指向第一个：

| 文件 | 用途 | 部署位置 |
| --- | --- | --- |
| `dist/emap-worker.js` | 固定文件名的 Worker bundle；启动时相对加载 vendor。 | 与 `mapshaper-vendor.js` 同一公开目录 |
| `dist/mapshaper-vendor.js` | Worker 的 classic-script mapshaper vendor。 | `emap-worker.js` 同级 |
| `dist/mapshaper-vendor.mjs` | ESM vendor。 | 应用 ESM 加载路径 |

```text
node_modules/@mapseekai/emap/dist/emap-worker.js
node_modules/@mapseekai/emap/dist/mapshaper-vendor.js
```

```text
public/assets/emap-worker.js
public/assets/mapshaper-vendor.js
```

`emap-worker.js` 通过 `importScripts('mapshaper-vendor.js')` 加载 vendor，两个 classic-script 文件必须同级，且均以 JavaScript 响应。

## 使用自有 Worker 池

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `workerUrl` | `string` | 必填 | 传给 `new Worker()` 的 bundle URL。 |
| `WorkerCtor` | `typeof Worker` | `globalThis.Worker` | Worker 构造函数覆盖。 |
| `poolSize` | `number` | `1` | Worker 槽位数，向下取整且至少为 `1`；按负载惰性创建。 |
| `jobTimeoutMs` | `number` | `120_000` | 请求超时（毫秒）；正值终止 Worker，`0` 无超时；有限非负。 |

```ts
const workerPool = new MapshaperWorkerPool({
  workerUrl: '/assets/emap-worker.js',
  poolSize: 2,
});

const map = await Emap.create({ container: 'map', useWorker: true, workerPool });
```

地图独占管理传入的 `workerPool`；`await map.dispose()` 取消任务、销毁 Worker 并释放资源。

## 可运行示例

- [Web Worker](/mapseekai/emap/examples/web-worker/)

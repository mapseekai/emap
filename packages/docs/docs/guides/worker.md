---
id: worker
slug: /guides/worker
title: Web Worker
api: ["Emap", "MapOptions", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions", "createEmapWorkerRuntime", "EmapWorkerRuntimeOptions", "EmapWorkerPool"]
examples: ["web-worker"]
stability: stable
verifiedVersion: 0.14.0
---

# Web Worker

Emap 支持将 dataset-replace 操作交给 Web Worker、按数据规模路由、取消作业和检查结果版本；独立 source 可并发处理，使主线程保持响应。

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
| `jobTimeoutMs` | `number` | `120_000` | 请求超时（毫秒）；超时终止 Worker；必须是 `1`–`2147483647` 的整数。 |

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

## 统一 tasklane 运行时

Emap 的 Mapshaper、几何、MSDF 字体、GeoTIFF 和 GeoPackage Worker 使用 `@mapseekai/tasklane`。DuckDB 保留官方 Worker 和通信协议。地图拥有默认运行时，并在销毁时释放；独立客户端在未传入运行时时自行创建并持有运行时。

通过 `createEmapWorkerRuntime(options: EmapWorkerRuntimeOptions)` 可以共享运行时。`EmapWorkerPool` 表示五个池名称；`urls` 指定对应 Worker 资源，`sizes` 设置池容量，`limits` 设置 tasklane 准入限制。资源按需创建。打包器改变资源位置时，应显式提供使用到的 Worker URL。

```ts
import { Emap, createEmapWorkerRuntime } from '@mapseekai/emap';

const runtime = createEmapWorkerRuntime({
  urls: {
    mapshaper: '/emap-worker.js',
    geometry: '/emap-geometry-worker.js',
    msdf: '/emap-msdf-worker.js',
    geotiff: '/emap-geotiff-worker.js',
    geopackage: '/emap-geopackage-worker.js',
  },
});
const map = await Emap.create({ container: 'map', workerRuntime: runtime });
// 最后先销毁所有消费者，再释放共享运行时。
await map.dispose();
await runtime.dispose();
```

传入的 `workerRuntime` 是借用资源：销毁地图或客户端会关闭其 Scope 和 Session，但不会销毁共享运行时。运行时拥有者需要调用 `runtime.dispose()`。自定义运行时应配置消费者使用的对应池。Worker 资源和主包必须来自同一次构建。GeoPackage 导入选项、GeoTIFF 打开选项也接受 `workerRuntime`。

共享运行时会为三个交互任务额外保留输入 192 MiB、输出 768 MiB 的准入额度，避免一个最大规模的 Mapshaper 任务占满全部额度。这些额度在任务准入时记账，内存按需分配；`limits.budgets` 的显式配置仍然优先，未覆盖的字段保留 Emap 默认值。运行中的任务不会因优先级变化而被抢占。

GeoTIFF 使用 tasklane 原生 `acquireSession` 管理常驻 reader：主 reader 优先，可重建副本显式标记为可回收，物理释放完成后才归还名额。默认共享 GeoTIFF 池最多八个 reader。容量全部由必需 Session 占用时，打开新源立即返回 `RASTER_WORKER_CAPACITY`；存在可回收副本或其他池的普通空闲 Worker 时，等待由运行时队列超时和五秒取消上限共同约束。外部 tasklane 运行时也使用相同准入 API。

几何和 MSDF 客户端在 Session 丢失后使用新一代 Session，不复用失效句柄。栅格 reader 丢失则使该源失败，需要重新打开文件，以重新建立有效读取会话。释放失败会保留清理记录，重复调用客户端销毁方法可重试；借用的运行时不会因此被销毁。

Worker 二进制封装保留日期（包括无效日期）、TypedArray 的元素类型、视图字节和特殊属性键；请传递可编码的数据对象；对于对象类型超出编码集合、访问器和循环引用，编码器明确报错。

### 连续任务与物理释放

当前固定使用 `@mapseekai/tasklane@0.2.0-beta.2`，协议为 v7，主包和所有 Worker 必须一起重新构建、部署。旧的本地调度补丁已被上游吸收并移除；预算保留不会阻挡物理上可执行的更高有效优先级任务，同优先级的防饥饿策略仍然保留。

GeoTIFF 解码块缓存通过 Scope 的 resident 租约计入运行时预算，默认每个运行时共用 256 MiB；独立运行时分别计费，需要跨地图或数据源统一限制时应共享 `workerRuntime`。被原生回收的副本会在下一次调度前移出读取路由，清理失败仍保留重试记录。reader 通过 `resourceCacheStats` 上报块缓存命中、未命中和驱逐，并支持 `runtime.trim()` 缩减解码缓存；目录和必要 reader 状态保留 128 MiB 保守额度，低于该额度的缩减会报告失败。完整 RSS 需另用进程工具测量。当内存压力恢复正常、池容量允许时，下次读取会按需恢复解码缓存，上限不超过数据源最初获批的额度。排队任务在实际派发时获取最新预算，Worker 先申请原生资源额度再提高 reader 限制；扩容未获批时仍可使用较小缓存读取。恢复不会预读或立即分配缓存块，无需重新打开数据源。

`await map.dispose()` 等待几何、字体与栅格的异步清理屏障。失败后再次调用 `map.dispose()` 可以重试保留的资源清理；借用运行时不由地图销毁。独立栅格源可在 `dispose()` 后等待可选的 `settled`。

### 二进制传输与预算

Mapshaper 的已知输入按数据计算保守上界，未知准备回调仍使用最大输入上限；任意命令的输出无法仅由输入大小可靠预测，因此保留 2 GiB 输出上限。这些额度控制任务准入，内存按需分配；浏览器堆占用需另行测量。

Mapshaper、GeoPackage 和 benchmark 使用混合封装：较大的二进制视图独立传输，默认保留调用方缓冲区；明确交出的完整缓冲区直接 transfer，部分视图按实际范围复制。大量小 BLOB 留在元数据封装中，避免超过底层 backing-store 数量限制。

GeoPackage 使用原生 `createSizedResultSource` / `iterateSizedResults`，每次先公布下一块的输出上界，主线程取得相应预算后再拉取并消费；不再对每个小块统一预留 2 GiB 输出。最终 arcs 仍作为数据块处理，之后才读取结束标记。主包、Worker 和 WASM 资源必须来自同一次构建。

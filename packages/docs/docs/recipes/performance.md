---
id: performance
slug: /recipes/performance
title: 性能
api: ["Emap", "MapOptions", "SimplifyOptions"]
examples: ["simplify", "simplify-control", "web-worker", "point-lod"]
stability: stable
verifiedVersion: 0.13.0
---

# 性能

性能调优分为四层：Worker 执行耗时数据集替换、共享弧简化、视口空间索引和密集点渲染 LOD。


```ts
const map = await Emap.create({
  container: 'map', // 挂载地图
  useWorker: 'auto', // 大数据替换移出主线程
  workerThreshold: 50_000, // 在此顶点数开始路由
});
```

## 核心参数

以下 `MapOptions` 控制 `clip`、`dissolve`、`simplify`、`project` 等数据集替换操作的执行位置：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `useWorker` | `boolean \| 'auto'` | `false` | `false` 在主线程执行；`true` 将全部数据集替换交给 Worker；`'auto'` 按命令和数据规模路由。选择级平移、旋转、顶点编辑和 Canvas 绘制仍在主线程。 |
| `workerThreshold` | `number` | `50000` | `'auto'` 顶点阈值，使用 `arcs.getPointCount()`；布尔 `useWorker` 忽略此值。`simplify`、`dissolve`、`buffer` 等重几何命令使用半阈值，轻量属性命令留在主线程。 |

## 更多 Worker 配置

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `workerUrl` | `string` | `'emap-worker.js'` | Worker bundle 地址，相对 `document.baseURI` 解析。 |
| `workerPoolSize` | `number` | `1` | Worker 池大小；独立 source 可并行，按需创建。`workerPool` 覆盖此配置。 |
| `workerPool` | `MapshaperWorkerPool` | — | 预构造池，优先于 `workerUrl` 和 `workerPoolSize`，由地图独占管理。 |
| `workerRouting` | `WorkerRoutingFn` | 内置决策 | 仅 `'auto'` 调用；接收 `cmd`、`heads`、`vertexCount`、`recordCount`、`mode`、`threshold`、`defaultDecision` 并返回 `boolean`。 |

## 更多优化

### `SimplifyOptions`

`map.ops.simplifyLayer()` 通过共享弧简化线和面。选择一个阈值模式，在导入后或用户确认时调用：

```ts
await map.ops.simplifyLayer({
  source: 'roads',
  target: 'primary-roads',
  percentage: 10,
  method: 'weighted',
  weighting: 0.7,
  keepShapes: true,
});
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | 必填 | 包含共享弧的 source ID。 |
| `target` | `string` | 整个 source | 要处理的图层；省略时处理全部图层。 |
| `percentage` | `number` | 三选一必填 | 保留可移除顶点的百分比（`0..100`）；与 `interval`、`resolution` 互斥。 |
| `interval` | `number` | 三选一必填 | 源 CRS 的正距离阈值；与其他阈值互斥。 |
| `resolution` | `string` | 三选一必填 | `WIDTHxHEIGHT` 网格，如 `'1000x500'`；与其他阈值互斥。 |
| `method` | `'dp' \| 'visvalingam' \| 'weighted'` | `'weighted'` | `'dp'`、`'visvalingam'` 或加权 Visvalingam（`'weighted'`）。 |
| `weighting` | `number` | `0.7` | 加权 Visvalingam 系数。 |
| `planar` | `boolean` | `false` | 为平面度数源 CRS 启用平面模式。 |
| `keepShapes` | `boolean` | `false` | 保留简化可能移除的小面。 |
| `lockBox` | `boolean` | `false` | 固定数据集包围盒上的顶点。 |
| `noRepair` | `boolean` | `false` | 拓扑已验证数据的直接输出；省略时修复拓扑。 |

简化将阈值写入共享弧的 `retainedInterval`，保留原始顶点阈值以便用新阈值重算。

### 显示弧 LOD

`DisplayArcs` 是 source 内部渲染 LOD，无额外参数。弧顶点超过 `500000` 时创建低细节副本：已有阈值保留约 `8%` 顶点，否则按平均线段长度四倍快速简化。`unitsPerPixel > 低细节平均线段长 × 1.5` 时绘制副本，放大时使用完整弧。

每帧将保留阈值设为 `max(retainedInterval, pixelSize × 0.5)`，保留用户简化下限。原地编辑标记显示弧为脏；需要低细节副本时重建。导出临时恢复完整精度。

### 视口裁剪参数

渲染器为至少 `10000` 个 shape 的图层建立 Flatbush 索引。视图覆盖范围和候选数均低于图层 `25%` 时使用索引；否则顺序绘制。加载后可在空闲时预热：

```ts
map.prebuildSpatialIndex('roads');
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `map.prebuildSpatialIndex(sourceId)` 的 `sourceId` | `string \| undefined` | `undefined`（所有 source） | 预建一个或全部 source 的空间索引。 |
| `map.clearSpatialIndex(sourceId)` 的 `sourceId` | `string \| undefined` | `undefined`（所有 source） | 清除缓存索引；直接修改几何后调用以按当前边界重建。 |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | 图层渲染开关；`'none'` 跳过图层。用 `map.setLayerVisibility(id, visibility)` 更新。 |

## 更多密集点 LOD

`circle` 图层默认按密度抽稀：每个二进制网格保留 feature/component ID 最小的真实点，坐标和属性仍可用于样式和拾取。支持 Point、MultiPoint，显示过滤先于代表点选择。

```ts
map.addLayer({
  id: 'points',
  type: 'circle',
  source: 'points',
  pointLod: { cellSize: 8 },
  paint: { 'circle-radius': 3 },
});
```

### `pointLod` 参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | `circle` 图层的自动密度抽稀；`false` 绘制全部原始点。 |
| `pointLod.cellSize` | `number` | `8` CSS 像素 | 目标网格边长（`1..64`）；越大每帧代表点越少。 |

网格锚定数据原点，使用二进制嵌套尺度；实际边长为请求 CSS 大小的一半到一倍。缩放逐步恢复细节，平移和 DPR 保持成员稳定。

### 渲染行为与预算

有效过滤点少于 `10000`，或抽稀保留至少 `90%` 时使用原始候选。每层最多缓存三个尺度，并为暖平移索引代表点。编辑/属性版本、数据/图层/shape 身份、数量、过滤掩码、CRS、`cellSize` 或视口预算变化时重建。

构建预算为 `min(两倍完整 CSS 视口网格数, 150000, floor(64 MiB / 80 字节))` 个代表点，与指针查询框无关。超限时使用更粗网格；单点图层的完整视口候选在预算内时直接绘制。点击和悬停跟随代表点及选中/高亮叠加；框选、套索、属性表、统计、分析、导出和 `.msx` 快照保留完整原始数据。

运行可重复的算法基准：

```bash
node --expose-gc --max-old-space-size=8192 scripts/benchmark-point-lod.mjs
```

固定种子覆盖 10 万、100 万、500 万点的均匀和聚集分布，报告三次冷构建中位数（含首次查询）、50 次暖平移中位数/P95 及输入输出点数。生成不计时；Node 仅测 LOD，浏览器帧还包括 Canvas 绘制、导入、样式解析和原始空间索引。

## API

- `Emap`
- `MapOptions`
- `SimplifyOptions`

## 可运行示例

- [Web Worker](/mapseekai/emap/examples/web-worker/)
- [简化控件](/mapseekai/emap/examples/simplify-control/)
- [几何简化](/mapseekai/emap/examples/simplify/)
- [密集点 LOD / Dense point LOD](/mapseekai/emap/examples/point-lod/)

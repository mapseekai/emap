---
id: performance
slug: /recipes/performance
title: 性能
api: ["Emap", "MapOptions", "SimplifyOptions"]
examples: ["simplify", "simplify-control", "web-worker", "point-lod", "luma-benchmark"]
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

## luma GPU 真实数据基准与可选点聚合

独立 `luma-benchmark` 等待用户选择本地文件，不生成性能数据。Canvas、WebGL2 和 WebGPU
共用原生 mapshaper dataset 与保守空间裁剪。点默认复用已有 PointLod，目标网格为 3 CSS 像素；线面不化简。
GeoJSON 在 Worker 中流式导入，完整几何按版本缓存；默认 viewer/editor 仍使用 Canvas。

入口 `/mapseekai/emap/examples/luma-benchmark/?gpu=webgl`，或 `?gpu=webgpu`。
点聚合可关闭，网格大小与圆点半径独立。每格保留原始代表点，不生成中心点或数量气泡。
圆点策略另提供覆盖优化与标准对照，默认半径 3 CSS px、透明度 1。
普通实心圆借鉴 GeoArrow/deck.gl 的四顶点实例化与解析抗锯齿；自动模式仅对连续同色不透明
圆点分离完全覆盖和边缘合成，不修改坐标、点数、半径或采样分辨率。半透明与其他符号使用标准路径。

页面 A/B 按 Canvas → GPU → GPU → Canvas 运行；CPU ms 是 JS 绘制/提交，rAF FPS 不是 GPU 执行时间。
点专项全精度脚本显式关闭 PointLod；不能把聚合帧率当作全量绘制帧率。
`benchmark-luma-point-lod.mjs` 测试默认 3 CSS px 聚合的 ABBA 导航；所有性能测试使用真实文件。

```bash
pnpm examples:luma
node scripts/benchmark-luma-points.mjs --data-dir /Users/zhang/Desktop/测试数据 --gpu webgl --frames 30
node scripts/benchmark-luma-points.mjs --data-dir /Users/zhang/Desktop/测试数据 --gpu webgpu --frames 30
node scripts/benchmark-luma-point-lod.mjs --data-dir /Users/zhang/Desktop/测试数据 --gpu webgl --frames 30
```

点专项仅完整加载 `points.geojson`、`pppp.geojson`；其他真实文件使用 `benchmark:luma:real`。
可通过 `--reference-dir` 提供本地 deck.gl-geoarrow 仓库，测试同一批原始点的真正 GeoArrow 图层。
参考依赖仅用于测试打包，不加入 emap 生产依赖。原文件哈希、像素、逐帧数据和资源释放均记录。

缓存软预算只用于淘汰非活跃分块，不会因为预算不足而自动化简可见数据。大文件仍受 emap
导入限制和实际浏览器内存约束。固定已解码栅格对照不表示 GeoTIFF I/O、解码或 overview 加速。

### 线数据全精度渲染

两个 luma 示例提供“MSAA 路径优化”“MSAA 同几何对照”“旧版解析描边”三种模式。
原始 mapshaper 路径和非零线段完整保留，点 LOD 独立工作。默认对不透明实线使用六顶点
索引模板、圆角连接、圆头与真实多重采样；仅剔除同色重复覆盖的采样位置。颜色变化和中间
图元会重置覆盖，不改变图层顺序。半透明、虚线或不支持 MSAA 的设备保留解析路径。
MSAA 和旧版解析抗锯齿并非逐像素等价；精确像素对照应使用同一 MSAA 几何模式。

```bash
pnpm benchmark:luma:lines --data-dir /Users/zhang/Desktop/测试数据 --gpu webgl --frames 20
pnpm benchmark:luma:lines --data-dir /Users/zhang/Desktop/测试数据 --gpu webgpu --frames 20
```

线专项完整加载 `big.geojson`、`lucc.geojson`、`building.geojson`，测固定视图的描边，
不要与页面完整场景的平移缩放 A/B 混算。可用 `--reference-dir` 指向本地 deck.gl-geoarrow
仓库进行真正的 GeoArrowPathLayer 对照；参考依赖不进入 emap 的生产依赖。

### 快照导航与保守路径过滤

两个 luma 示例默认打开“快照导航”与“视口路径过滤”。导航复用已完成画面，停止后等待原始几何新画面；
平移时新进入区域可能暂空白，缩放时清晰度和线宽暂随位图变化。选中要素或编辑顶点时暂停快照路径。
原始 mapshaper 坐标、共享拓扑和编辑历史不变；现有 PointLod 开关独立。

路径区间只做扩张视口包围盒剔除，包含邻接与描边余量，不过滤屏幕内短线或化简顶点。
GPU Buffer 不变，复用 WebGL 偏移 VAO 或 WebGPU firstInstance；全范围可见时不减少原始工作量。
`?nav=off`、`?cull=off` 可分别关闭；`&pointLod=off` 用于全量原始点。

页面 A/B 仍强制原始绘制，不使用快照；快照 rAF FPS 不能当作全量 GPU 重绘 FPS。
界面分别显示导航状态、提交时间、完整画面就绪时间、候选和实际提交的线段数。

### Canvas 屏幕过滤（luma 实验页）

默认开启的“Canvas 微小 arc 过滤”和“半设备像素重复点过滤”只作用于背景线/面描边。
它们复用 Canvas 的 0.35 CSS px 阈值及初始视图修正、DPR 后半像素截断、连续重复命令跳过和
塌缩路径 0.1 设备像素短线。原始 dataset、面填充/洞、选中轮廓和编辑顶点不受影响。
这是显示近似，不是严格全精度显示。两项可独立关闭；`screenFilter=off` 同时关闭。
屏幕几何由 Worker 按精确视图/DPR/版本生成，快照导航期间不重建；旧结果不会覆盖新视图。
页面提供“原始几何导航”和“过滤后暖重绘压测”两个按钮。后者测固定当前视图、同一过滤命令集，筛选准备耗时另列，不使用快照。两种帧率不可直接混算。


### 近景退远的缓存恢复

屏幕过滤描边不依赖原始 GPU 路径 Buffer 的驻留。退远时先准备最新视图的屏幕路径，
不再为了显示这些命令重建已淘汰的原始线。完整面三角网在同一 256 MiB 原始缓存预算内
优先于非活跃原始线保留；超过预算的面仍可能重建，不承诺所有数据常驻。选择/编辑与过滤规则不变。

```bash
pnpm benchmark:luma:zoom-out --data-dir /Users/zhang/Desktop/测试数据 --assert-refill
```

该命令以完整真实文件从 16× 近景执行滚轮退远，统计停止操作到完整当前画面替换快照的延迟，
不是固定视图暖 FPS。使用独立 4195 loopback 服务，结束后关闭；不操作已有 4187 服务。
`--assert-refill` 校验指定真实文件在这条已预载路线中未重复构建原始线/面，并非所有数据的通用承诺。

## API

- `Emap`
- `MapOptions`
- `SimplifyOptions`

## 可运行示例

- [Web Worker](/mapseekai/emap/examples/web-worker/)
- [简化控件](/mapseekai/emap/examples/simplify-control/)
- [几何简化](/mapseekai/emap/examples/simplify/)
- [密集点 LOD / Dense point LOD](/mapseekai/emap/examples/point-lod/)

- [luma WebGL2 Benchmark](/mapseekai/emap/examples/luma-benchmark/)


## 动态 UInt16 栅格对照

[luma 动态栅格示例](/mapseekai/emap/examples/luma-raster/) 保持 TIFF 源打开，放大后读取更精细
的 overview/原图，不再仅放大固定图片。可切换正式 Canvas、WebGL2、WebGPU；同一文件均采用
源 CRS 和同一层级选择策略。GPU 当前支持 UInt8/UInt16、1–4 波段、非调色板、正北向影像，跨 CRS
仍使用正式 Canvas 流程，不会静默用矩形包围盒代替重投影。

GPU 缓存数值纹理，shader 负责 NoData-aware 最近邻/双线性、源统计拉伸、波段和透明度。
样式变化复用已加载的数据，不重新生成 CPU RGBA。相同软缓存预算为 32 MiB，但 GPU/Canvas
存储形式不同；冷视图的 halo 读放大和 CPU 交错打包仍需计入，不能只报告暖缓存帧率。
共享 Reader 同时增加了合格未压缩 strip 的精确列窗口读取，正式 Canvas 也自动受益。

`pnpm benchmark:luma:raster:dynamic --data-dir <本地测试目录>` 运行两份授权 TIFF 的动态基准，
每个动作的稳定时间包含 8 帧确认；约 133–150 ms 的暖缓存结果不能解读为 GPU 执行时间。
旧 luma-benchmark 的栅格仍是固定纹理纯合成基准，两者应分别测量。


### 动态栅格放大补图

`luma-raster` 会合并相邻完整源窗口，复用 halo 读块，并在纹理就绪后按不重叠覆盖渐进补图。
交互中暂停新读和待上传打包；原始数值、源坐标系、overview 策略和软缓存预算保持不变。
主线程打包与 GPU 提交、Worker 累计解码、画面稳定时间分别观察；稳定压测含八帧确认窗口。
此优化不代表所有视图更快，压缩块边缘重复和条带小范围读取仍有开销。


## 动态栅格内存诊断

`luma-raster` 的地图下方显示解码缓存、GPU 数据纹理、待上传样本和打包暂存。
这些是已跟踪的资源字节，不包含完整 JS/Worker 临时内存、Canvas/交换缓冲和图形驱动；
不要将 32 MiB 缓存预算误读为浏览器总占用。原始数据读取继续使用完整数值和相同 overview 策略。

`openGeoTIFF(file, { blockCacheBytes: 32 * 1024 ** 2 })` 可以限制该数据源全部 Worker
的解码块缓存预算（允许 8–256 MiB）。省略该选项仍使用原来的存储布局自适应策略。
它不改变并发解码预算，缓存缩小时重复访问旧视图可能需要重新读块。

在 macOS 上可用 `pnpm profile:luma:raster:memory --data-dir "/你的测试数据目录"`
对授权的 FUS/GJ 文件复测；可用 `--backends webgl,webgpu --dprs 1,2 --cycles 4 --trace`
选择后端、DPR、次数及额外 GC 跟踪。该命令只清理自己创建的测试浏览器和预览服务。
强制 GC 仅用于非计时检查点核对存活对象，生产渲染路径不调用 GC。


### 原始源块、GPU halo 与文件夹读取

动态栅格页现在直接在 Worker 组织 UInt8/UInt16 原始数值的上传布局，不在主线程重新拆分和交错。
适合的分块 TIFF 按不重叠 core 读取，一像素 halo 从已驻留的邻块核心做整数 GPU 复制；仅加载
当前屏幕采样确实需要的邻块，不递归扩展整圈数据。边缘依赖未就绪时保留旧画面，对已就绪区域
继续按独占覆盖渐进更新。条带及不适用布局保留有界窗口回退，不通过选择更粗 overview 提速。

点击“选择文件夹”，会列出目录下的 TIFF，并按完整相对路径关联同目录 `.tif.ovr`。
一次加载下拉框选中的影像，不是自动镶嵌所有文件；同名但不同目录的文件不会关联到错误 OVR。
当前验证目录包含四个 UInt8 RGB 原图/外部 OVR 对和一个内部 COG。已有 GeoTIFF 坐标键作为
定位依据，本功能不承诺替没有坐标键的任意 TIFF 解析 TFW/XML。浮点、调色板与跨 CRS 显示仍可选正式 Canvas。

页面的 `haloCopies`、`haloCopyBytes` 和 `preparedUploads` 区分 GPU 边缘复制与 CPU 上传，
默认源路径 `packMs=0` 只表示没有主线程打包，并不表示 Worker 或浏览器内部完全零复制。
诊断参数 `?pipeline=legacy` 保留旧平面窗口读取用于对照；它不是旧版本所有行为的完整复刻。
`pnpm benchmark:luma:raster:dynamic --data-dir <测试目录> --include-cdf` 增加该目录五份原始 TIFF 的测试。

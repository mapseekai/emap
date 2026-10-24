---
id: performance
slug: /recipes/performance
title: 性能
api: ["Emap", "Emap.setGeometryLod", "Emap.setScreenPathFiltering", "MapOptions", "SimplifyOptions"]
examples: ["simplify", "simplify-control", "web-worker", "point-lod", "geometry-lod", "luma-benchmark"]
stability: stable
verifiedVersion: 0.14.0
---

# 性能

Emap 支持用数据操作 Worker、GPU 几何 Worker、共享弧简化、视口与三角形空间索引、密集点 LOD、有界缓存和渐进出图优化加载与导航。按实际数据分别测量准备、提交、画面稳定时间和内存，可选择适合应用的配置。


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
| `workerRouting` | `WorkerRoutingFn` | 内置决策 | `'auto'` 和 `true` 均可调用；接收 `cmd`、`heads`、`vertexCount`、`recordCount`、`mode`、`threshold`、`defaultDecision` 并返回 `boolean`。 |

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

`geometryLod` 控制当前地图的线、面自动显示简化，Canvas2D、WebGL2 和 WebGPU 共用设置。省略时使用 `{ pixelTolerance: 0.5 }`；`false` 关闭自动简化。运行时可直接调整，无需重新加载数据：

```ts
const map = await Emap.create({
  container: 'map',
  geometryLod: { pixelTolerance: 0.5 },
});
map.setGeometryLod({ pixelTolerance: 2 }); // 更倾向于简化
map.setGeometryLod(false); // 恢复源数据允许的细节
map.setGeometryLod(); // 恢复默认 0.5
```

`pixelTolerance` 是大于 `0`、不超过 `64` 的 CSS 像素简化强度。已有顶点阈值时，每帧使用 `max(用户手动简化下限, pixelSize × pixelTolerance)`；数值越大，显示细节越少。关闭后仍保留用户已应用的数据简化。绘制、拾取和高亮使用相同 LOD 设置，原始坐标、属性和要素数量不变。

弧顶点超过 `500000` 时，`DisplayArcs` 创建低细节副本：已有阈值保留约 `8%` 顶点，否则按平均线段长度四倍快速简化。副本切换条件为 `unitsPerPixel × (pixelTolerance / 0.5) > 低细节平均线段长 × 1.5`。它不是严格的最大误差保证；未含顶点阈值的小文件不会自动新增逐顶点简化预计算。

微小弧过滤阈值也按 `pixelTolerance / 0.5` 缩放。`geometryLod: false` 跳过低细节副本、自动顶点阈值和微小弧过滤，仍保留视口裁剪。它不改变独立的 `screenPathFiltering` 设置。原地编辑会标记副本为脏并按需重建；导出临时恢复完整精度。

### 屏幕同像素去重

`screenPathFiltering` 默认关闭，与几何简化独立，可通过 `screenPathFiltering: true` 或 `setScreenPathFiltering(true)` 按需开启。Canvas2D、WebGL2 和 WebGPU 对不透明实线及面描边使用相同的源锚定参考网格：半设备像素网格仅用于合并连续重复的内部顶点，保留折返、原坐标和弧的首尾端点，不把线位置吸附到网格。平移复用参考网格，放大时更新去重精度。小图层和大数据使用同一规则。

GPU 整层线缓存在缩小时可复用物理分辨率不超过请求两倍、且平均每条非空弧不超过两个线段的较细结果，减少逐级重新准备和上传；已有精确级别优先使用。线段数限制避免缩小时保留过多绘制工作。超出条件或放大到缓存精度不足时仍会更新，源坐标和端点保持不变。

```ts
const map = await Emap.create({
  container: 'map',
  geometryLod: false,
  screenPathFiltering: false,
});
map.setScreenPathFiltering(true); // 按需开启屏幕去重，几何简化设置不变
map.setScreenPathFiltering(); // 恢复默认关闭
map.setGeometryLod(false);
map.setScreenPathFiltering(false); // 两项均关闭：保留源数据允许的完整精度
```

去重不修改源坐标、要素、导出或几何 LOD 顶点数。虚线、箭头、半透明描边和面填充在两端均保留几何精度，避免改变虚线距离、透明叠加或孔洞。比较性能时，两项设置、数据、视口和 DPR 应保持一致；CPU 提交耗时不能直接当作 GPU 耗时或 FPS。

[线面自动简化示例](/mapseekai/emap/examples/geometry-lod/)提供两个独立开关、简化强度和顶点数对比。首次启用几何简化时，示例才为缺少阈值的数据执行保留 `100%` 顶点的阈值计算；关闭简化导入会直接显示完整精度。
也支持本地 GeoPackage：可先填写需要导入的表名（逗号分隔），再选择 `.gpkg` 文件；留空导入全部表。导入在 Worker 中完成，文件不会上传。

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
GeoJSON 在 Worker 中流式导入，完整几何按版本缓存；正式 viewer/editor 已默认使用 WebGL2，可显式选择 Canvas2D。

入口 `/mapseekai/emap/examples/luma-benchmark/?gpu=webgl`，或 `?gpu=webgpu`。
点聚合可关闭，网格大小与圆点半径独立。每格保留原始代表点，不生成中心点或数量气泡。
圆点策略另提供覆盖优化与标准对照，默认半径 3 CSS px、透明度 1。
普通实心圆借鉴 GeoArrow/deck.gl 的四顶点实例化与解析抗锯齿；自动模式仅对连续同色不透明
圆点分离完全覆盖和边缘合成，不修改坐标、点数、半径或采样分辨率。半透明与其他符号使用标准路径。

页面 A/B 按 Canvas → GPU → GPU → Canvas 运行；CPU ms 是 JS 绘制/提交，rAF FPS 衡量动画帧回调节奏，GPU 执行时间需单独采样。
点专项全精度脚本显式关闭 PointLod；聚合和全量绘制帧率按各自模式单独报告。
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
图元会重置覆盖，不改变图层顺序。半透明、虚线或仅支持解析抗锯齿的设备保留解析路径。
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

页面 A/B 仍强制原始绘制，不使用快照；快照 rAF FPS 衡量画面复用节奏，全量 GPU 重绘单独测量。
界面分别显示导航状态、提交时间、完整画面就绪时间、候选和实际提交的线段数。

### Canvas 屏幕过滤（luma 实验页）

“Canvas 微小 arc 过滤”默认开启，“半设备像素重复点过滤”默认关闭；两者只作用于背景线/面描边，可独立调整。
它们复用 Canvas 的 0.35 CSS px 阈值及初始视图修正、DPR 后半像素截断、连续重复命令跳过和
塌缩路径 0.1 设备像素短线。原始 dataset、面填充/洞、选中轮廓和编辑顶点不受影响。
这是有上述像素阈值的显示近似。两项可独立调整；`halfPixel=on` 开启半像素去重，`screenFilter=on` 同时开启，`screenFilter=off` 同时关闭。
屏幕几何由 Worker 按精确视图/DPR/版本生成，快照导航期间不重建；旧结果不会覆盖新视图。
页面提供“原始几何导航”和“过滤后暖重绘压测”两个按钮。后者测固定当前视图、同一过滤命令集，筛选准备耗时另列，不使用快照。两种帧率不可直接混算。


### 近景退远的缓存恢复

屏幕过滤描边不依赖原始 GPU 路径 Buffer 的驻留。退远时先准备最新视图的屏幕路径，
不再为了显示这些命令重建已淘汰的原始线。完整面三角网在同一 256 MiB 原始缓存预算内
优先于非活跃原始线保留；超过预算的面按需重建，常驻范围由缓存预算决定。选择/编辑与过滤规则不变。

```bash
pnpm benchmark:luma:zoom-out --data-dir /Users/zhang/Desktop/测试数据 --assert-refill
```

该命令以完整真实文件从 16× 近景执行滚轮退远，统计停止操作到完整当前画面替换快照的延迟，
固定视图暖 FPS 使用单独的计时指标。使用独立 4195 loopback 服务，结束后关闭；不操作已有 4187 服务。
`--assert-refill` 校验指定真实文件在这条已预载路线中未重复构建原始线/面，校验范围限定为指定文件和预载路线，其他数据需另行验证。

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
存储形式不同；冷视图的 halo 读放大和 CPU 交错打包仍需计入，与暖缓存帧率分别报告。
共享 Reader 同时增加了合格未压缩 strip 的精确列窗口读取，正式 Canvas 也自动受益。

`pnpm benchmark:luma:raster:dynamic --data-dir <本地测试目录>` 运行两份授权 TIFF 的动态基准，
每个动作的稳定时间包含 8 帧确认；约 133–150 ms 的暖缓存结果是含确认窗口的稳定延迟，GPU 执行时间需单独采样。
旧 luma-benchmark 的栅格仍是固定纹理纯合成基准，两者应分别测量。


### 动态栅格放大补图

`luma-raster` 会合并相邻完整源窗口，复用 halo 读块，并在纹理就绪后按不重叠覆盖渐进补图。
交互中暂停新读和待上传打包；原始数值、源坐标系、overview 策略和软缓存预算保持不变。
主线程打包与 GPU 提交、Worker 累计解码、画面稳定时间分别观察；稳定压测含八帧确认窗口。
压缩块边缘重复和条带小范围读取仍有开销；按视图比较这些成本与补图收益。


## 动态栅格内存诊断

`luma-raster` 的地图下方显示解码缓存、GPU 数据纹理、待上传样本和打包暂存。
这些指标记录已跟踪的资源字节；浏览器总占用还需加上 JS/Worker 临时内存、Canvas/交换缓冲和图形驱动。
32 MiB 预算仅适用于显示缓存。原始数据读取继续使用完整数值和相同 overview 策略。

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
一次加载下拉框选中的影像；按完整相对路径关联 OVR。多影像镶嵌需在应用流程中另外处理。
当前验证目录包含四个 UInt8 RGB 原图/外部 OVR 对和一个内部 COG。已有 GeoTIFF 坐标键作为
定位依据；只有 TFW/XML 地理参考的 TIFF 需先写入 GeoTIFF 坐标键。浮点、调色板与跨 CRS 显示仍可选正式 Canvas。

页面的 `haloCopies`、`haloCopyBytes` 和 `preparedUploads` 区分 GPU 边缘复制与 CPU 上传，
默认源路径 `packMs=0` 只表示没有主线程打包，并不表示 Worker 或浏览器内部完全零复制。
诊断参数 `?pipeline=legacy` 保留旧平面窗口读取用于对照；对照范围为该读取管线，其他行为以当前版本为准。
`pnpm benchmark:luma:raster:dynamic --data-dir <测试目录> --include-cdf` 增加该目录五份原始 TIFF 的测试。

## 正式 WebGL2 / WebGPU 的导航与缓存

正式地图选择 `renderer: 'webgl2'` 或 `'webgpu'` 后，这些优化默认启用，不依赖实验示例的私有开关。
轻量场景平移和缩放使用已驻留 GPU 缓冲按当前相机绘制，输入暂停约 80 ms 或手势结束后再规划新视口，连续操作期间不反复准备几何。
CPU 绘制或异步 GPU 完成延迟超过 33.3 ms 时，导航改为复用已绘制画面，停止后按当前视图重绘；
不会每个指针事件再次提交密集几何。完成延迟最多每 250 ms 采样一次，包含异步完成与调度延迟，GPU timestamp 单独记录。
快照期间后台几何、图标和标签完成通知合并到手势结束后的重绘，样式更新和设备恢复仍立即刷新。
首次加载尚未绘出内容的空帧不会用作导航快照，首批几何就绪后仍会补图。
快照期间新进入区域可能暂空白，背景线宽随画面缩放；编辑覆盖层继续实时绘制。Canvas2D 保留原有自适应快照。
样式、过滤和源变更使旧内容失效，成功提交的完整画面才可复用于导航。

普通示例也默认使用视口/路径范围裁剪、`Viewport` 的微小 arc 过滤，以及下述大数据半像素过滤。
不需要逐个示例安装基准页的开关；微小 arc 与半像素规则仅影响显示，不改写原始拓扑。

稳定视图复用弧段可见性和候选边界准备结果，不再每次命中 GPU mesh 前都重新展平/过滤。
线描边按整层缓存，用绘制范围索引和 GPU 视口裁剪；平移不会因可见道路变化而重新准备或上传已有几何。面填充的视口边缘仍保留完整空间块。
关闭屏幕过滤时，不透明实线的 MSAA 路径按空间邻近顺序排列每个准备批次内部的 GPU 数据，使范围裁剪更有效；原始坐标、拓扑、要素顺序和整层呈现保持不变。虚线、箭头、半透明及其他依赖绘制顺序的路径保留原顺序。
缓存仍检查输入 ID 内容和几何版本，保留原有虚线方向、点密度、图层顺序和选择/编辑语义；
新增选择缓存计入原有几何预算，不通过放大显存预算换取速度。

大数据使用独立几何 Worker，主线程按时间片复制有界 XY 批次，Worker 进行三角化和 GPU 数据布局，不复制整份 source 或属性表。
线描边不按空间网格分区加载，整层准备完成后统一呈现；精度更新期间复用完整旧层，新层全部就绪后统一替换。
面填充复用同一份缓存时，不再把无关的描边更新绑成一个大交接组；发生几何变更的填充与边界仍成对交接，避免临时显存不足阻塞后续更新。
内部仍按顶点数和缓冲大小分批准备、上传，避免一次巨额分配。面填充和点保留渐进呈现，按图层顺序重绘整个可用场景，不重复叠画半透明内容。
图标保留原始重叠顺序；源替换、编辑和取消会清理过期任务。

```ts
const map = await Emap.create({
  container: 'map',
  renderer: 'webgl2',
  geometryWorkerUrl: '/assets/emap-geometry-worker.js', // 默认主包同目录
  screenPathFiltering: false,
});
```

`screenPathFiltering` 在所有渲染器默认关闭，运行时可用 `setScreenPathFiltering(true)` 对不透明实线及面描边开启半设备像素显示过滤。
网格只用于去重判断，保留点及端点不发生网格位移。它与 `geometryLod` 独立，`setScreenPathFiltering()` 恢复默认关闭。
虚线、箭头、半透明描边和面填充保留几何精度；小图层、临时编辑高亮继续同步绘制。
几何 Worker 不受数据操作的 `useWorker` 控制。

软几何预算 256 MiB，保护当前可见块但总工作集不超过 512 MiB；超限通过 error 报告，不裁掉要素。
单个几何包最多两百万 XY 顶点，空间成员索引另有上限。源数据、JS/Worker 临时堆和驱动开销另计，
测量浏览器总内存时须合并这些开销。大数据 `render()` 可能先呈现局部场景，后续异步补齐。
Worker 的精确要素三角化缓存另限 64 MiB/20,000 条，以坐标和环偏移验证复用，源移除时释放。

分块增加调度与 draw call 成本；评估每个视图时分别比较冷构建响应、稳定时间、
缓存复用与内存。大面内部的三角形范围索引可剔除视口外的绘制范围，不上传新的坐标数据；
原始面、孔洞和全部三角形仍保留。过度碎片化时保守退回全部绘制。

在驻留 GPU 几何重绘路径中，已有注记按地面锚点与 CSS 偏移重投影，字形和 halo 不随地图倍率放大；异步布局在手势中
补充新候选。新屏幕描边就绪前复用旧 mesh 的正确仿射投影。图集代际校验避免回收页的旧 UV
变成错误字形。冷任务/新字形仍有非零延迟，首次文件解析和业务索引不在该 Worker 范围内。
CPU 提交时间不等于 GPU 耗时或 FPS；轻量路径会主动补图，重负载快照在内容未变化时避免重复 GPU 提交。

## 完整 GeoPackage 浏览器压测

使用 `pnpm benchmark:geopackage:browser --file /本地数据/data.gpkg --renderer webgl2 --cycles 3`
对当前本机示例预览测试，也支持 webgpu 和 canvas2d。脚本以只读 SQLite 行数、文件哈希、
导航完整就绪、缓存驻留和释放为检查项，分别记录导入、出图等待、主线程长任务和进程组 RSS。
测试保留拓扑、点 LOD、DisplayArcs、默认样式和预算；结果适用于测试文件、视口、DPR 和机器。
GPU 与 Canvas2D 的速度和可容纳规模需在各目标配置上比较。

冷近景的面数据在 Worker 内按保守视口覆盖压紧引用顶点后上传，保留完整三角形和孔洞，
已驻留的完整缓冲仍可复用。只裁剪派生 GPU 存储，不裁切源数据，256/512 MiB 预算保持不变。

### 二进制批次与稳定描边缓存

正式 GPU 几何 Worker 直接处理平坦 XY/offsets，复杂面保留精确环关系，简单单环批量生成索引。
空间子块使用紧包围盒；计算批次与小 GPU 缓冲独立，队列和淘汰候选增量维护，渐进刷新按提交成本合并。
不透明实线使用源坐标锚点和不低于请求分辨率的精度档位。已有覆盖内的平移只更新投影，
不重建这些屏幕缓冲；进入新区域、成员/版本/显示精度变化时继续准备。
网格只选择内部顶点，保留原坐标及首尾端点；缩放切换精度时，道路交点不会随网格相位移动。
`screenPathFiltering: false` 关闭这种显示近似；源拓扑、导出和编辑仍使用原始坐标。
同一几何的元数据注册复用 DisplayArcs，避免刚导入又重复构建低细节副本。


### 几何缓存和批次效率

正式 GPU 的 Worker 三角网缓存使用数值要素键和双向 LRU，仍精确验证坐标与环偏移。
三角形空间顺序使用稳定基数排序；符合范围的分块索引改用 uint16，不改变坐标精度或三角形。
独立索引上传的对齐填充计入 GPU 预算；共享页的完整零面积对齐三角形另外计数，不产生像素。
大弧集合在原细块裁剪后进行有界相邻批次合并，保留顺序、虚线距离和端点；点图标不重排。
已完成的 LOD 空间计划在有限元数据缓存内保留，源移除或几何版本变化会清理，返回旧级别可免于重复规划。
这些优化默认启用；几何驻留范围由预算与淘汰策略决定。GeoPackage 全量导入和主线程恢复仍有独立成本。

`benchmark:geopackage:browser` 的 `--warm-frames 8` 在完整视图就绪后记录八次 CPU 提交和 draw call；
默认 0 不增加暖帧采样。暖帧计时记录 CPU 提交；GPU 时长、FPS、文件读取和冷准备各自报告。

### 有效描边与直接上传缓冲页

正式二维 GPU 对适合的不透明实线使用有效线段实例和预计算连接系数，减少每帧重复的邻接运算。
长路径字节成本不合适、非等比/透视、透明、虚线和箭头保留原路径；不减少源坐标和有效线段。
预计算浮点顺序可能引起稀疏MSAA边缘差异，4倍抗锯齿与既有半像素显示精度没有降低。

紧凑描边及uint16面分块第一次上传就进入共享GPU页，仅按原顺序合并连续兼容区间；
不重复创建完整场景副本。页碎片计入原256/512 MiB预算，16 MiB新页余量是在原额度内预留，
该余量计入总显存占用。实际碎片可能在回收后超过预留值，仍按真实占用检查；空页立即释放。
面索引区间的对齐采用完整零面积三角形，不产生像素，填充计数另外提供padding指标。

`benchmark:geopackage:browser --warm-frames 8 --gpu-frames 12` 分别采样CPU提交和GPU通道时间。
GPU时间仅在后端支持timestamp查询时记录；缺失结果不作为零耗时。共享索引Buffer按物理对象去重统计。
CPU/GPU不可直接相加或换算为FPS；预计算和页分配有冷准备成本，收益按实际视图测量。

### 有序命令复用与空闲页回收

正式 GPU 地图缓存有序 mesh、精确可见范围和兼容页区间的绘制计划，避免每帧重复整理和解析样式。
WebGPU 对稳定的填充/不透明 MSAA 描边自动复用命令，保留四倍 MSAA；文字、图标、栅格和
其余路径仍实时绘制。命令复用保留源要素和实际三角形；CPU 提交和 GPU 时间分别测量。

共享页回收支持空闲区间拆分/合并，不移动活跃数据。几何预算没有提高。
只有完整驻留、请求及外部内存压力未变的帧，才跳过重复的归属和淘汰维护。
导入协议未改变；首次文件读取、解析、拓扑恢复成本仍需单独衡量。

### 无损描边格式与依赖失效

屏幕描边仅省略严格为零的坐标低位，使用 48 字节 XY 实例；非零低位继续使用 64 字节实例。
同一任务可分别保存两种格式，原始 Float64 坐标、端帽和已有 MSAA 不变，仍按总字节检查预算。
只有同一颜色/线宽/屏幕基准的不透明 MSAA 描边，才按物理缓冲页组织可见区间；半透明、
虚线、箭头、图标和父图层顺序不使用这种重排。缓存失效精确到引用被回收 mesh 的作用域，
未使用该 mesh 的已录制命令继续复用。此优化不改变文件导入，收益按实际视图分别测量。

### 有界几何微批次

正式 WebGL2/WebGPU 对小几何任务合并传输：最多 8 个、总 backing buffer 不超过 2 MiB，
大任务独立执行；仍只有一个几何 Worker。首个任务不等待凑批，每个块保留独立版本和资源身份，
取消会回退预留游标，迟到结果按版本丢弃，保留新源状态。单个任务错误不影响同批其他成功结果。
原生、未额外设置保留间隔的弧集合可用弧长进行容量估算，避免为计数重读坐标；
预测坐标存储超过 2 MiB 时仍精确计数，压紧缓冲的额外瞬时容量也有界。
`geometryChunks.messages` 与 `jobs` 分别记录消息和逻辑任务，`batchAdmissionMs` 单列准入成本。
这些优化针对渲染准备吞吐；GPU 着色和文件导入另行计时，MSAA 与显存预算保持原值。

### 已驻留描边范围与可见区间合批

正式 GPU 地图对适用的不透明屏幕描边保留连续实例的保守包络，导航只选择已有 Buffer 的可见范围。
极端连接不能证明安全时保留整段，非等比变换下不使用旧包络；不降低 MSAA、坐标或显示精度。
同一常量 RGBA 的面填充按物理页组织，同页相邻块即使部分可见也能合并连续区间。
过滤洞、已回收 slice 和未选择的三角形不能被跨越，真实候选/提交量与 padding 分开统计。
资源复用可降低部分提交成本；按数据、缩放级别分别测量提交和 GPU 帧耗时。

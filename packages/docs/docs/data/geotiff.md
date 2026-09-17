---
id: geotiff
slug: /data/geotiff
title: 本地 GeoTIFF 栅格
api: ["openGeoTIFF", "openGeoTIFFHandle", "geoTIFFPlugin", "rasterPlugin", "RasterSource", "RasterStyle", "RasterReference", "RasterContract", "RASTER_PYRAMID_THRESHOLD", "GeoTIFFAddOptions", "GeoTIFFContract", "GeoTIFFPluginOptions", "OpenGeoTIFFOptions", "RasterCacheStats", "RasterPerformanceTotals", "RasterPlanningDiagnostics", "RasterLayerPlanningDiagnostics", "RasterSelectedLevelDiagnostics", "RasterError", "RasterLayerInfo", "RasterLayerReference", "RasterLevel", "RasterMetadata", "RasterBandStatistics", "RasterRenderRequest", "RasterRenderResult", "RasterTaskDiagnostics", "RasterWarpMesh", "RasterProcessingStats", "RasterWorkerBlockStats", "RasterLevelProcessingStats", "RasterReadRequest", "RasterReadResult", "RasterRenderOptions", "RasterSamples", "RasterWindow", "RenderFrame", "RenderPass"]
examples: ["geotiff-viewer"]
stability: experimental
verifiedVersion: 0.12.0
---

# 本地 GeoTIFF 栅格

`@mapseekai/emap/geotiff` 使用固定的 `geotiff@3.0.5`，从用户选择的原始文件按字节范围读取。解码在独立 Worker 中进行，显示瓦片绘制到现有地图 Canvas，不创建额外地图覆盖层。

## 加载文件

```ts
import { Emap, Bounds } from '@mapseekai/emap';
import { rasterPlugin, geoTIFFPlugin } from '@mapseekai/emap/geotiff';

const map = await Emap.create({
  container: 'map',
  preset: 'viewer',
  plugins: [
    rasterPlugin({ cacheBytes: 64 * 1024 ** 2, concurrency: 2 }),
    geoTIFFPlugin({ workerUrl: '/assets/emap-geotiff-worker.js', workerCount: 2 }),
  ],
});

// file 来自文件选择器；不要提前执行 file.arrayBuffer()。
await map.ctx.geoTIFF.addFile('imagery', file, {
  overviewFile, // 可选：用户同时选择的 image.tif.ovr
  style: { bands: [0, 1, 2], resampling: 'bilinear' },
});
const bounds = await map.ctx.raster.getBounds('imagery');
map.fitBounds(new Bounds(...bounds), { padding: 32, duration: 0 });
```

将包内 `dist/emap-geotiff-worker.js` 复制到部署目录。该文件是独立 classic Worker，不需要 `mapshaper-vendor.js`，不要使用 `importScripts()` 加载 ESM。服务器需返回 JavaScript MIME，CSP 需允许同源 Worker。直接使用分发 ESM 且保留同目录 Worker 时，可以省略 `workerUrl`；经 Vite/Webpack 重打包时显式部署并传入 URL。

## 大文件必须具有金字塔

硬规则为 `file.size > 2 * 1024 ** 3`：**超过 2GiB 且没有有效概览层时，在首次像素解码前拒绝加载**，错误码 `PYRAMID_REQUIRED`。恰好 2GiB 不触发该规则，但仍受解码预算限制。没有允许绕过的配置。

支持内部 IFD、SubIFD 和显式关联的外置 `.ovr`。普通多页影像、掩膜、错误尺寸比例或不匹配的波段不计为有效金字塔。外置文件名必须为原文件名加 `.ovr`；存在地理参考时还校验坐标系和覆盖范围。没有地理参考的外置文件由用户负责关联正确源文件，文件名匹配不是内容身份的密码学证明。

三波段原图与概览的 `MINISBLACK` / `RGB` 标签可以不同：只要数值类型与波段匹配且没有 Alpha 语义变化，仍作为原始三波段金字塔读取。不会因此放宽调色板、WhiteIsZero 或其他颜色空间校验。显式选择的 `.ovr` 若没有任何兼容层级，会在像素解码前报 `OVERVIEW_MISMATCH`，不再静默忽略。

示例现在优先支持“目录授权”模式：用户只需授权影像所在目录，选择 `a.tif` 时会自动查找同目录的 `a.tif.ovr` 并关联加载；目录中只有一个 TIFF 时会直接选择并加载。浏览器安全模型不允许普通 `<input type="file">` 从单个 `File` 反查父目录，因此不支持目录句柄的浏览器仍保留手动选择原图和 `.ovr` 的降级方式。emap 核心仍只接收 `File`/句柄，不会绕过浏览器权限访问其他本地文件。

用 QGIS 构建金字塔，或在安装 GDAL 的终端执行：

```bash
gdaladdo -ro -r average "image.tif"
```

`-ro` 以只读方式打开原始 TIFF，创建外置 `image.tif.ovr`；不提供显式层级时，GDAL 自动创建逐级缩小的概览。分类数据改用 `-r nearest`。创建完成后重新选择原文件和 `.ovr`。emap 不会自动修改原始文件，也不在 OPFS 中偷偷生成金字塔。

即使已有一层金字塔，过大的源窗口或压缩条带仍可能超过预算，此时返回 `RASTER_READ_BUDGET`，需要更完整的金字塔或分块 TIFF。文件大小不是通用性能保证。

## 图层和样式

栅格使用独立的只读数据源，不进入矢量 `TopologySource` 或 `map.addLayer()`。当前栅格栈整体位于矢量图层下方；栅格内部可以排序，暂不提供矢量与栅格任意穿插的统一排序。

```ts
map.ctx.raster.setStyle('imagery', { opacity: 0.6 });
map.ctx.raster.setVisibility('imagery', false);
map.ctx.raster.moveLayer('imagery'); // 栅格栈顶层
const values = await map.ctx.raster.queryPixel('imagery', x, y); // 地图 CRS 坐标，原始分辨率数值
map.ctx.raster.remove('imagery'); // 关闭读取与缓存，不删除磁盘文件
```

默认选择前三个非 Alpha 数据波段组成 RGB；只有一个或两个可用数据波段时，默认使用第一个波段显示灰度。波段顺序不是光谱含义自动识别，遥感多光谱数据可自行指定 R/G/B 对应波段。调色板文件默认保留原始配色。

示例页面提供“RGB 多波段彩色”与“单波段灰度”模式，RGB 的 R/G/B 通道可分别选择，灰度模式可从任意可用波段取值；单波段文件会自动选择灰度，并禁用无效的 RGB 选项。界面编号从 1 开始，API 索引从 0 开始。

```ts
map.ctx.raster.setStyle('imagery', { bands: [0, 1, 2] }); // RGB：第 1/2/3 波段
map.ctx.raster.setStyle('imagery', { bands: [1], stretch: 'auto' }); // 第 2 波段灰度
map.ctx.raster.setStyle('imagery', { bands: undefined }); // 恢复自动模式/原生调色板
```

切换波段时会清除之前波段专属的手动拉伸范围，除非同次调用明确提供新的 `ranges`。单波段拉伸使用被选择波段的源级统计，不会误用第一个波段的范围。Alpha 仍用于透明度，不作为默认颜色通道；模式与波段配置可随工程引用保存。显式选择调色板文件的波段会显示原始类别数值灰度，不展开原始颜色表。

支持最近邻、双线性、NoData、非预乘 Alpha、调色板、透明度与固定范围拉伸。灰度输出将同一个显示值写入 R/G/B，原始数值不会因模式切换而修改。

默认 `stretch: 'auto'` 保持 UInt8 原有色彩；Int8、UInt16/Int16、UInt32/Int32 和 Float16/Float32/Float64 自动按有效数值的 2%–98% 百分位拉伸到 0–255。原始样本和像素查询值不变，Float16 解码为 Float32 缓冲区后显示。

统计在 Worker 内进行：优先选择合适概览层，将全幅划成 4×4 个区域，每个区域读取最多 64×64 像素，总采样位置不超过 65,536。每次源读取仍受压缩块与窗口预算约束；不整图解码，不随视口反复计算。统计忽略 NoData、NaN、无穷值和透明 Alpha 像素。`metadata.statistics` 提供每波段 `min/max/p02/p98/count/approximate`，抽样范围或概览层统计会标记为近似值。极小的有效区域可能未被采到，可通过显式范围调整显示。

所有瓦片共享固定统计范围，防止瓦片接缝、平移时亮度变化；常量栅格以中灰显示，全无效栅格保持透明。可选择 `minmax`、`percentile` 或 `none`；`none` 恢复类型范围（浮点 `[0, 1]`）。显式 `ranges` 优先级最高：

```ts
map.ctx.raster.setStyle('imagery', { bands: [0], ranges: [[0, 3000]] });
```

## 缩放和平移时的连续显示

滚轮、拖拽和相机动画进行中仅变换已完成影像，不为变化中的视口开启新瓦片读取，也不切换显示代次。滚轮仍使用地图原有 250ms 手势结束判定；一般视口变动还经过 `settleDelay`（默认 150ms，可配置 0–2000ms）去抖，已处于手势内时必须等到手势结束。

```ts
rasterPlugin({
  cacheBytes: 64 * 1024 ** 2,
  concurrency: 2,
  settleDelay: 150,
  presentationInterval: 60,
});
map.ctx.raster.setStyle('imagery', { stretch: 'minmax', ranges: undefined });
```

停止移动后按视口请求目标分辨率的瓦片。就绪瓦片按默认 **60ms 的短窗口成组呈现**，不是每完成一个块就单独刷新，也不是等待整个视口全部完成。当前批次全部就绪时立即提交，不额外等待计时器。尚未就绪的区域保留上一视图影像，缺失部分也可使用缓存中覆盖该区域的父级／旧分辨率瓦片。中途再次缩放，会保留当时已经呈现的新旧混合画面，而不是退回整个旧批次。

新旧影像使用互不重叠的地图区域裁剪：每个位置只绘制一次，避免半透明瓦片叠加变深。已完成但透明或 NoData 的新块同样拥有覆盖区域，会显示下层内容，不能把“透明像素”误当作“块未加载”而透出旧栅格。裁剪和瓦片边界统一对齐到设备像素，避免非整数 DPR 下的接缝。

单块失败只影响它自己的区域，其他块继续加载并呈现；失败区域保留可用旧缓存并报告错误。过期或取消的结果不能覆盖新视口。仅修改透明度不重新解码。瓦片就绪产生的刷新请求由地图合并到动画帧，不为每块强制同步重绘。

多次中断可能保留多个分辨率的碎片。缓存预算仍然生效：在占用或碎片数量过多时，把当前可见回退内容整理成有界的内存预览，再逐块替换；该预览可能降低临时回退画面的分辨率，但不写入 OPFS、不复制或修改原文件。首次加载或进入没有任何缓存覆盖的新区域，仍需等待首次块读取，不能凭空提供旧影像。

`getStats()` 的 `interacting` 标记交互／去抖状态，`pendingFrames` 统计仍有请求未结束的视口批次，`presentedTiles` 统计逐块呈现次数，`committedFrames` 仅统计全部成功完成的批次，`readRequests` 统计瓦片读取次数。块可以在 `pendingFrames > 0` 时持续呈现。示例提供 UInt8、UInt16、Int16、Float32、Float64 内置样本及拉伸模式选择。

## 连续出图与读取吞吐

数据分块与屏幕刷新是两个独立阶段。对照 [QGIS MapCanvas 源码](https://api.qgis.org/api/qgsmapcanvas_8cpp_source.html)，地图在后台任务运行时通过更新计时器读取合成图像（构造器默认 250ms，可配置），任务结束后提交最终结果；[栅格预览反馈](https://api.qgis.org/api/qgsrasterlayerrenderer_8cpp_source.html)也会限制预览刷新频率。因此不能简单把 QGIS 描述成“每解码一块就立刻上屏”。[GDAL 块缓存](https://gdal.org/en/stable/user/configoptions.html#config-GDAL_CACHEMAX)则减少重复数据块读取。这些是源码机制对照，不是对当前电脑上的 QGIS 进行性能实测。

emap 使用更短的有界更新窗口，并保留块级进度：优先减少读取和解码次数，然后合并短时间内就绪的画面更新，而不是靠长时间遮住加载过程或取消内存保护。

`presentationInterval` 控制就绪块的最长合并窗口，范围 0–250ms，默认 60ms；0 恢复单块即时呈现。它与“停止移动后再开始读取”的 `settleDelay` 不同。慢块不会阻塞已经完成的组，失败、取消或卸载会清理等待队列与计时器。相比即时单块提交，最早一块可能多等不超过一个合并窗口，换取更少的局部闪变；整批提前完成则立即提交。

原始文件读取使用 64KiB 对齐的压缩字节页，同一页的并发请求合并，减少大量小块的 Blob I/O。每个文件在并行 Worker 之间分摊最多 16 页（1MiB），另有最多 16 页在途；大请求仍直接按范围读取。实际物理读取量（含预读）仍计入原有 I/O 预算。

每个打开的数据源增加 **8MiB 的解码块 LRU 缓存**，原图、概览及并行 Worker 共同分摊该预算，每个 Worker 同时受 4096 个条目约束；相邻显示瓦片、重访和样式变化可复用原始数据块。缓存只保存已完成的解码缓冲，关闭源文件时清空，不保存长期 Promise 或输出像素数组。

数值窗口针对原生端序、均一位深的常见编码使用 TypedArray 行复制／解交错，并将块读取管线限制为最多 4 个；编码解压与 Predictor 处理仍由 geotiff.js 执行。Float16、不同端序、混合样本与特殊编码继续使用上游读取路径。最近邻和双线性显示均复用坐标、通道与插值状态，减少逐像素临时数组。没有修改源文件数值、金字塔选择或拉伸范围。

这些缓存是**显示缓存以外**的额外预算：单个 TIFF 最多约 1MiB 已保留压缩页，加上该栅格源共享的 8MiB 解码缓存；外置 `.ovr` 有自己的压缩页预算。在途读取、当前窗口及浏览器资源仍另有开销。多文件不会无限累积，移除图层／卸载插件时释放缓存和 Worker，不写 OPFS/IndexedDB。

可用 `test/browser/raster-performance.spec.mjs` 对同一台机器、同一个本地 TIFF/.ovr 进行三轮前后对比。设置 `EMAP_GEOTIFF_LOCAL_FILE` 后运行，`EMAP_RASTER_BENCH_OUT` 可选指定 JSON 输出。指标包含导航开始至完成的时间、首个新块呈现时间、不同动画帧上的块更新次数和显示缓存；所谓源冷启动只重建 emap 源和缓存，不清除操作系统磁盘缓存。该测试不是 QGIS/emap 原生运行速度的直接对比。

## 真正并行的解码与后台着色

GeoTIFF 采用**瓦片管线 Worker 池**：同一影像的不同窗口在独立 Worker 中执行读取、解码、窗口组装、重采样、拉伸和 RGBA 生成，而不是在一个 Worker 中增加 `Promise.all()`。这里没有直接套用 geotiff.js 的块级 `Pool`，也没有为每个 TIFF block 创建线程。

```ts
const loader = geoTIFFPlugin({
  workerUrl: '/assets/emap-geotiff-worker.js',
  workerCount: 2,
});
// 同时调到 4 个任务才可充分使用显式配置的 4 个 Worker：
const renderer = rasterPlugin({ concurrency: 4 });
// 诊断当前图层实际工作线程与资源预约：
console.log(map.ctx.raster.getProcessingStats('imagery'));
```

`workerCount` 范围为 1–4，默认 2；浏览器报告逻辑核数不超过 2 时默认 1。设置 1 仍在后台完成着色，只是不会同时解码多个窗口。模块级资源限制最多允许 4 个额外 Worker（不含每个源必需的首个 Worker），达到限额时使用已有线程排队，不创建无限线程。每个副本仍使用同一个 `emap-geotiff-worker.js`，没有新增 Worker 部署文件。

首个 Worker 完成必需的 TIFF/OVR 验证与抽样统计；第二个 Worker 可在初始视口等待期间预热元数据，其余按需建立。副本复用相同统计范围，不重复抽样扫描，不因不同线程产生颜色接缝。超过 2GiB 无有效金字塔的输入仍在首次像素读取之前被拒绝；副本不会绕过该规则。

主线程只做视口调度、LOD 选择、投影网格构建和 Canvas 合成。`RasterWarpMesh` 使用 Float64 可序列化网格；投影有效性边界保留精确像素中心回退，不降低投影精度。Worker 返回 `RasterRenderResult.rgba`，通过可转移 ArrayBuffer 回传；显示路径不再把 UInt16/Float32 全部波段发送到主线程后着色。`queryPixel()`/`readWindow()` 仍返回原始数值。

`RasterSource.renderTile(RasterRenderRequest, signal)` 是可选能力：GeoTIFF 默认实现并走后台路径；只有 `readWindow()` 的第三方数据源继续兼容原来的主线程着色路径。`getProcessingStats()` 返回实际 Worker 数、忙碌数、历史峰值、等待任务、预约字节数和已后台着色瓦片数。示例显示“后台 Workers / 已着色块”，用来核对实际生效的管线。

资源保护也按池汇总：同一源并行任务的**估算解码＋投影网格＋RGBA 在途预约合计不超过 64MiB**，超出并行余额的任务排队而非同时分配；待发送网格最多保留 32MiB。8MiB 解码缓存、每文件 1MiB 已保留压缩页按配置 Worker 数均分。TIFF 目录数组在副本间合计控制在 32MiB，必要时自动减少副本数。这些仍不是浏览器整个进程的硬内存上限，独立 Worker 的运行时开销也需计入实际观测。

取消任务时调用方立即结束等待，物理 Worker 槽在任务实际响应后才可重用，避免快速缩放把旧 CPU 工作无限排队；保留 60 秒超时保护。移除图层或卸载插件会终止所有源属 Worker，释放队列、计时器、监听器和全局附加线程名额。一个 Worker 崩溃会关闭同源池并显式报错，不留半损坏管线。

新主线程代码要求同版本 Worker；旧缓存 Worker 会报告 `RASTER_WORKER_VERSION`，请部署同一构建的 Worker 文件并刷新页面。能力不依赖 SharedArrayBuffer、跨源隔离、OffscreenCanvas 或 GPU；Canvas 最终写入与合成仍在主线程。Windows 上的实际收益需以同数据、同视口和同渲染参数复测。

## 工程引用与隐私

`map.ctx.raster.toReferences()` 仅生成 JSON 安全的源文件身份信息、样式、可见性和排序，**不包含 File、Blob、原始 TIFF 或像素缓存**。

```ts
const references = map.ctx.raster.toReferences();
// 宿主保存 references，并在独立的句柄表保存 FileSystemFileHandle。
await map.ctx.geoTIFF.addHandle(references[0].id, handle, {
  expected: references[0].source,
  style: references[0].style,
  overviewFile,
});
map.ctx.raster.setVisibility(references[0].id, references[0].visible);
```

权限检查、用户手势授权、IndexedDB 句柄表、工程迁移和重新关联界面属于宿主应用。emap 不写入 IndexedDB、OPFS 或 Cache Storage。`addHandle()` 重新获取当前 File；与 expected 的文件名、大小、修改时间不符时拒绝恢复，要求重新关联。句柄不能作为可移植 JSON 权限跨电脑使用。

现有矢量 MSX 快照不嵌入栅格；宿主必须另外保存上述引用，Loom 工程接入不包含在本次 emap 改动中。仅运行时内存保存显示瓦片，源文件保持原位。

## 资源预算与兼容范围

| 项目 | 当前值 |
| --- | --- |
| 显示缓存 | 默认 64MiB，可配置 8–256MiB |
| 全局瓦片读取并发 | 默认 2，可配置 1–4 |
| 单源读取 | 默认 2 个独立 Worker，单 Worker 串行；总队列最多 16 |
| 单次读取 | 最多 4,194,304 源像素，估算解码预算 64MiB |
| 同时打开栅格 | 最多 16 个图层 |
| 元数据防护 | 目录数量、字段数组、字节偏移和范围读取均校验 |

预算不是浏览器总进程内存上限；Worker、解码器、投影和 Canvas 仍有中间开销。视口变化取消过期任务，关闭图层/卸载插件释放 Worker 和缓存。

当前支持 north-up GeoTIFF/BigTIFF：8/16/32 位整数、16/32/64 位浮点、灰度/RGB/调色板。支持已知 EPSG GeoKey，未知 CRS 必须显式传入 `crs`，不默认当作 WGS84。显示重投影使用现有 CRS 转换和局部逆变换网格，而不是只变换影像四角。

暂不支持旋转/剪切网格、独立 TIFF 有效性掩膜、预乘 Alpha、YCbCr/CMYK 等其他颜色空间、1/4 位分类样本。遇到这些情况明确拒绝，不静默错误显示。请先转换为受支持的 north-up、分块、带金字塔且以 NoData 或非预乘 Alpha 表示无效区的 TIFF。

BigTIFF、小型金字塔和稀疏大文件阈值有自动化验证；尚未完成真实 10/20/50GB 影像的性能压测，不能据此宣称已保证这些容量下的交互速度。

## 公开类型与独立读取

`GeoTIFFPluginOptions` 配置 Worker URL；`GeoTIFFAddOptions` 增加源 CRS、外部概览文件、样式、取消信号和恢复校验。`RasterRenderOptions` 管理缓存与并发。`RasterContract` 管理图层，`GeoTIFFContract` 负责本地文件打开。

```ts
import { openGeoTIFF } from '@mapseekai/emap/geotiff';
const source = await openGeoTIFF(file, { workerUrl: '/assets/emap-geotiff-worker.js' });
try {
  const values = await source.readWindow({
    level: source.metadata.levels[0].id,
    window: [0, 0, 256, 256], // 必须位于源影像内部
    samples: [0],
  });
  console.log(values.data[0]);
} finally {
  source.dispose();
}
```

`RasterBandStatistics` 描述固定的源级显示统计。`RasterMetadata`/`RasterLevel` 是元数据和可读取分辨率层级；`RasterWindow` 为半开像素窗口 `[left, top, right, bottom]`，用于 bounds 时则表示 `[xmin, ymin, xmax, ymax]`。`RasterReadRequest`/`RasterReadResult` 保留原始 `RasterSamples` 类型。

`RasterLayerInfo` 是只读图层描述，`RasterLayerReference` 是可保存引用，`RasterCacheStats` 是运行时预算诊断。`RasterError.code` 可用于界面分支处理。高级渲染 Provider 的 `RenderPass` 接收 `RenderFrame`，仅同步绘制，异步解码必须在渲染回调之外调度；注册返回的注销函数需绑定插件生命周期。

## 内存生命周期检查

图层移除后，加载插件只保留弱所有权标记，不保留历史元数据列表。解码器关闭时清空 TIFF 目录和 File/Blob 引用；串行读取队列不会保留最后一次像素结果。地图或插件销毁会释放显示缓存、回退 Canvas、Worker、挂起请求、计时器和渲染监听。自定义数据源关闭失败时仍会清理其他数据源，最后聚合报告错误。

外部 `RasterSource` 应响应 `AbortSignal` 并在 `dispose()` 中关闭自己创建的资源。emap 会解除已取消任务的等待引用，即使外部 Promise 未完成；但无法代替外部插件终止其自行启动的网络、线程或其他资源。

`test/browser/raster-memory.spec.mjs` 使用 Chromium CDP 强制垃圾回收与 WeakRef 验证移除后的对象可回收，同时记录堆、DOM、监听器和 Worker 数量。它覆盖 3 轮预热后 30 轮加载/导航/移除、15 次 Provider 重启、销毁地图以及不响应取消的读取。JS 堆并不包括所有浏览器进程、Canvas/GPU 或操作系统文件缓存，短期回归不能构成所有数据规模下永不泄漏的证明。


## Performance Diagnostics

`geotiff-viewer` 内置 Performance Diagnostics。点击“开始记录”，执行一次缩放、平移或样式变化，待栅格稳定后面板会自动冻结本次数据；“复制 JSON”可直接把 Windows 与 macOS 的结果带回问题分析。

诊断包含总墙钟耗时、当前 LOD、视口/DPR/逻辑核心数、Worker 数量、瓦片与读取次数、主线程规划和 Canvas 上传、呈现等待、Worker 累计耗时、文件 range read、TIFF block load、窗口组装、颜色拉伸/重采样、Worker→主线程近似传输耗时，以及压缩页/解码块缓存命中率。 `planning.passes/plannedTiles/current` 区分一次操作累计经历的规划代次与**最终当前视口**的 tile grid；`grid/tiles/idealViewportTiles/amplification/pixelSize/span` 可判断“168 tiles”是单个异常网格，还是多个缩放代次累计。当前最终网格仍受每图层显示缓存预算约束。

Block Cache 同时报告 eviction 数量、淘汰/写入字节量、当前/峰值占用、容量、entry 数和超大块跳过次数。`evictionRate = evictions / misses` 接近 1 且峰值长期贴近容量时，是缓存抖动的重要信号；`evictedMiB` 是本次操作的缓存 churn，不等同于唯一 working-set 大小。

```ts
const before = map.ctx.raster.getStats();
// 执行一次缩放或平移
const after = map.ctx.raster.getStats();
console.log(after.performance.fileReadMs - before.performance.fileReadMs);
console.log(after.performance.colorizeMs - before.performance.colorizeMs);
```

`RasterCacheStats.performance` 是累计计数，宿主应取两次快照做差。Worker 可并行执行，因此 `workerMs`、`fileReadMs`、`blockLoadMs` 等是各任务累计时间，**不能相加当作墙钟总耗时**。示例中的 `decodeApprox` 以 `blockLoadMs - fileReadMs` 估算，适合定位方向，不是 profiler 的 CPU 精确采样；`transferMs` 也包含 Worker 消息调度开销，是近似值。

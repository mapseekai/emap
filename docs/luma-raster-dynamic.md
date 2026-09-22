# 动态 UInt16 栅格渲染与 FUS 条带窗口读取

## 后续版本说明（2026-09-22）

当前页面已支持 UInt8/UInt16、Worker 上传布局与 GPU halo 复用，并增加文件夹/同目录 OVR 配对。
详见 [源块复用实测](luma-raster-block-reuse.md)。下文首次实现及性能表保留原始时间与口径，
不作为新路径的当前性能结论。

## 入口和范围

分支 `luma集成`。Git 检查点为 `8384334e`；本轮工作区改动尚未提交。

打开 `/mapseekai/emap/examples/luma-raster/`，选择真实本地 TIFF（也可同时选同名 `.ovr`），点击加载。
后端选择 Canvas、WebGL2 或 WebGPU。放大后根据当前视图读取更精细的 overview 或原图，
直到达到源像元精度；超出原始分辨率不会创造新细节。源数据一直保留打开状态，移除/切换/关闭时释放。

已有 4187 preview 无需重启，构建后强制刷新即可。旧 `luma-benchmark` 的栅格依旧是固定解码
图片的纯合成对照，不会补高清；它现在明确链接到本动态示例，不能混用两个测试口径。

GPU 实验路径支持 UInt16、1–4 波段、非调色板、正北向 GeoTIFF，使用 **源 CRS**。本页的
Canvas 使用正式 `RasterRenderService`，也设为相同源 CRS，复用同一层级选择策略与源统计。
它不是任意 CRS 的 GPU 重投影实现，不支持的数值类型应显式选择 Canvas；正式 geotiff-viewer
的跨 CRS 能力没有删除。尚未测在线 HTTP COG、独立 mask、Windows/Safari/Firefox。

## FUS 未压缩条带

`readUncompressedStripWindow` 只接受本地 Blob、Compression=1、Predictor=1、PlanarConfiguration=1、
同质 8/16/32-bit 无符号整数、原生字节序的 strip。全宽窗口沿用原有缓存块读；不匹配条件则
保持原来的解码路径，尤其不修改压缩 TIFF 或其他布局的处理。

局部窗口先验证 StripOffsets/StripByteCounts，再按行计算实际列的字节区间。每批最多 256 行，
通过 file-backed Blob slices 合并一次有界读取；输出 TypedArray 不做数值变换，保留请求的波段顺序。
每个批次目标最多 4 MiB，总输入窗口最多 32 MiB；合法且特别宽的单行仍受源 I/O 预算约束。
范围地址、截断、预算和取消均校验，稀疏/隐式空块继续委托旧实现。范围描述按批构造，不随全部行数
积累数百万个对象。这里的 readOps 是 Blob 读取调用次数，不是磁盘系统调用次数。

这条优化位于共享 Reader，所以正式 Canvas GeoTIFF 示例也会受益，不需要启用 GPU。
不会重写 TIFF，不执行 gdaladdo，不创建新的 COG，也没有全文件读入内存。

## GPU 数据纹理

流程：原生窗口/overview → 现有 GeoTIFF Worker 解码 → 原始 UInt16 TypedArray → rgba16uint
纹理 → shader 采样、波段选择、NoData、拉伸与透明混合。

原生小瓦片按 512 像素窗口分组，FUS 原始条带使用 256 像素虚拟窗口；核心范围互不重叠，
额外 1 像素 halo 用于双线性采样，避免块边界缺少相邻样本。缓存身份为源实例内 level/x/y，
不含视口和样式。GPU 样式更新只改 uniform，不重读、重解码或上传整张 RGBA 图片。

rgba16uint 保留整数值，不将 UInt16 当 Float16。双线性用 textureLoad/texelFetch 显式取四点，
排除任一选中波段为 NoData 的 tap，再归一化权重。最近邻 alpha 和拉伸范围沿用现有规则；
rgba 输出按现有 8-bit 显示规则量化，但纹理中的原始数值保持 UInt16。不是全链路零复制：目前
需要把 Worker 的 planar arrays 打包为 RGBA16，记录 packMs 和 uploadSubmitMs。

在 CPU Float64 中用 AffineTransform 将屏幕外端点裁到视口，随后上传有界屏幕坐标/纹理坐标，
避免极近缩放时上传巨大的屏幕位置再相减。WebGPU 显式使用无深度附件的单采样 framebuffer；
栅格不复用矢量 MSAA/深度优化 pass。两后端没有自动静默回退。

## 调度、内存和可见性

最多两个待完成读任务；完成后继续有界读流水，GPU 上传每帧约 6 ms 预算，上传等待队列有背压。
交互期间暂停新读取，已有纹理继续随相机绘制。过期任务可取消，晚到的数据不能覆盖另一数据源。
切换 overview 时保留旧覆盖；已完成区域按不重叠矩形渐进替换，NoData 区域同样获得独占所有权，避免新旧半透明瓦片重复混合。
后续批量读取和交互优化、前后实测见 [放大延迟优化](luma-raster-zoom-performance.md)。
这不是矢量几何化简，也不把快照帧率作为 GPU 实际重绘性能。

本页 Canvas 显示缓存与 GPU 纹理缓存的软预算均为 32 MiB，但存储对象不同：Canvas 为 RGBA8
显示瓦片，GPU 为 RGBA16 原始窗口。GPU 可见工作集不能因预算静默降精度，上限 128 MiB，
过渡画面/当前纹理硬安全预算 256 MiB，超限报错。缓存淘汰明确释放纹理及绑定的 uniform buffer。
原生块与 halo 在冷视图下可能比 Canvas 的裁剪窗口读更多压缩块；本版不宣称所有阶段都更快或读取更少。

## 复现和口径

```bash
pnpm build
pnpm examples:build
pnpm benchmark:luma:raster:dynamic --data-dir "/Users/zhang/Desktop/测试数据" --trials 2 --out test-results/raster-dynamic-next
EMAP_BENCHMARK_DATA_DIR="/Users/zhang/Desktop/测试数据" pnpm exec playwright test --config playwright.luma.config.mjs luma-raster-dynamic.spec.mjs
```

benchmark 使用并清理自有 4196 服务；正式 Canvas 历史对照仍可用 `benchmark:luma:raster`（4195）。
用户已有 4187 服务不受操作。全部性能依据仅为授权的 FUS 和 GJ 完整文件；小型结构单测不作为性能数据。

新的端到端测试每动作等待 8 个安静 rAF 确认，所以暖缓存和纯样式动作约 133–150 ms 的结果主要是
确认窗口，不是 shader 执行了 133 ms。正式 Canvas 还保留其原有 settle/presentation 等待策略。
记录源设置、首次就绪、读字节、GPU 上传和缓存；CPU 提交时间不是 GPU 执行时间，Worker 阶段累计
可能并行，不能简单相加。source-cold 只指新应用数据源，未清空 OS 缓存。

数值图像回归对照原始文件的 CPU Float64 采样和现有 colorizeRasterTile，覆盖最近邻、双线性、
NoData、块缝和 DPR。最近邻的整像素边界具有不连续性：仅在距离边界不足 0.0001 源像素时，
允许相邻 tap 中与 GPU 实际颜色匹配的一项，单独计数；非边界颜色必须通过严格误差约束。
此测试不是声称 Canvas 二次缩放的最终 RGBA 与 GPU 直接采样逐像素相等。

尚未完成的扩展方向留在本地记录：减少 halo 造成的物理块重复解码；跨 CRS GPU 网格重投影；
更多数值/调色板/独立 mask；真实网络 COG 和其他平台性能。未向外部 issue 系统创建记录。


### 高 DPR 采样和测试同步

纹理坐标由 fragment 的真实像素中心和 uniform 变换计算，而不依赖硬件量化三角形边缘后的
varying 插值；DPR=2 的最近邻测试发现的跨像元偏移据此修复。WebGL/ WebGPU 分别处理 fragment
原点差异，使用实际 drawing-buffer 比例（包括非整数 DPR 的尺寸舍入）。

稳定测量还要求相机变换连续 8 帧不再改变，不能仅凭 I/O 队列空就认定滚轮动画结束。
浏览器用例先等待真实滚轮手势结束，再用快速 API 变更测试读取任务的取消/最终视口一致性。
已有共享交互引擎中，尚未结束的滚轮输入可能晚于程序化跳转继续调整相机；本轮不修改该共享
行为，也不把相机仍在运动造成的级别变化误判为栅格旧任务覆盖。这一扩展事项仅记在本地。


## 首版动态纹理实测（2026-09-21；后续优化见独立报告）

Apple M4 / 16 GiB / Chrome 153 headless；绘图区 1280×678 CSS px、DPR 1，两轮。
两类缓存软预算均32 MiB，两个数据 Worker（原图条带仍沿用原有调度亲和）。
下面是包含稳定确认窗口的墙钟毫秒，不是 GPU 执行时间。

| 文件 / 动作 | Canvas | WebGL2 | WebGPU |
|---|---:|---:|---:|
| fus / 新源完整范围 | 396–423 | 248–260 | 228–248 |
| fus / 4× | 450–450 | 267–282 | 283–450 |
| fus / 16× | 433–483 | 282–367 | 284–500 |
| fus / 128× | 500–583 | 517–600 | 500–916 |
| fus / 近景平移 | 433–467 | 267–283 | 250–267 |
| fus / 返回完整范围 | 283–284 | 168–183 | 167–185 |
| fus / minmax 拉伸 | 283–283 | 150–150 | 150–150 |
| fus / 双线性 | 300–317 | 150–151 | 150–151 |
| fus / 透明度与波段 | 300–316 | 150–150 | 150–150 |
| gj / 新源完整范围 | 419–425 | 252–252 | 216–228 |
| gj / 4× | 482–484 | 317–333 | 316–334 |
| gj / 16× | 466–500 | 267–282 | 266–267 |
| gj / 128× | 400–418 | 151–152 | 149–152 |
| gj / 近景平移 | 350–366 | 149–149 | 149–152 |
| gj / 返回完整范围 | 367–367 | 184–200 | 200–200 |
| gj / minmax 拉伸 | 266–267 | 150–151 | 150–151 |
| gj / 双线性 | 333–368 | 149–150 | 149–150 |
| gj / 透明度与波段 | 300–316 | 149–151 | 150–151 |

FUS 正式旧场景（目标4326、绘图区1280×852）的原图近景平移逻辑读量由215,684,928 bytes
降为367,308 bytes（约205.69 → 0.35 MiB，减少99.83%），稳定时间400–467 → 383–400 ms。
这不是速度提升同等倍率。该场景与新页面的源CRS基准分开，不能混合其耗时。

GPU三个样式动作（拉伸、双线性、透明度/波段）均新增读取0、新增纹理上传0。
缓存淘汰后再次返回某些视图仍需读取或上传，例如FUS返回全图重传4张纹理；不宣称所有暖导航0上传。
GJ 4× 冷视图的GPU原生窗口读取约28 MiB，而Canvas约11.5 MiB，halo/整块缓存仍有优化余地。
FUS 128× 的WebGPU本轮500–916 ms，有样本慢于Canvas500–583 ms，不能声称WebGPU始终更快。

233项相关单元/回归通过；12项动态浏览器用例覆盖2文件×2GPU×DPR1/1.25/2，另有6项已有栅格/
LUCC编辑回归通过。原始采样对照共516个局部区域（297,216像素），非边界最大3色阶误差，
无超出约束的像素；356个最近邻边界像素按前述严格相邻样本规则单独计数。
12个完整动态上下文、132个动作均无页面/GPU错误，关闭后Worker0、跟踪纹理字节0。
两源文件size/mtime测试前后不变；没有计算24.85GB源文件全量哈希、没有测硬件显存或进程峰值。

原始结果在 `test-results/raster-dynamic/verified-benchmark/dynamic.json`，正式前后对照在
`test-results/raster-dynamic/formal-after/baseline.json`，数值/功能日志在该目录的browser-final-numeric.log。
性能脚本只测试授权完整原文件，不替换成生成样例。统计辅助代码和截图未复制源数据进仓库。


## 内存诊断补充（2026-09-22）

新增显式的源级解码缓存上限：本页三后端统一传入 `blockCacheBytes: 32 * 1024 ** 2`。
它与显示缓存预算分别管理，不是总内存上限，其他调用方不传值时仍使用原有存储自适应策略。
GPU 纹理打包复用一份有界暂存，裸样本读取也上报 Worker 缓存占用。
地图下方显示已跟踪内存资源；浏览器真实进程占用和 GC 分析见 `luma-raster-memory.md`。
本文件上方的历史性能结果保留原测量口径，不冒充内存调整后的新结果。

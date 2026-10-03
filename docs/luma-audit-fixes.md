# luma 审查修复记录

本轮补齐资源回收、文字缓冲复用、可取消上传和栅格像素上传。基线：`d43b18f9`（保存审查时尚未提交的实现）。三批修复分别提交，不推送或发布。

## 第一批：资源生命周期

普通样式、dash 纹理按帧使用期回收；原生 bundle 重放先标记其 uniform，
未使用的命令计划退出后，在 pass 提交后才释放旧 uniform。图片的自动淘汰、尺寸变化、
显式 forget 和 clear 共享解绑入口；WebGL 不再比较不存在的 imageSampler 字段。
销毁不再尝试呈现待提交帧，单个资源清理失败不跳过其他独立资源和设备。

`painter.stats.memory` 分列 geometry、styles、dash、shared、text、image 与 attachment。
`nominalKnownGpuBytes` 不包括交换链、驱动开销和 CPU 缓存；depth24plus 按每采样四字节估算。
既有 `liveBufferBytes` 保持几何口径，避免破坏现有调用方。

移除旧 drawMeshBatch，测试迁往 drawMeshSequence；移除未消费的 shader uniformTypes
和 @luma.gl/engine 直接依赖；Painter 不再构造未比较的内容指纹；单 tile 复用批量路径的
uploadRasterTile / commitLoadedTile。保留真正参与失效判断的 owner.content。

第一批验证：类型检查、324 条相关单元测试、41 条既有正式地图浏览器回归通过；
新增双后端 300 次样式切换/删除源后的内存回归通过。构建、示例构建、布局/契约/架构检查通过。

## 第二批：交互分配和可取消上传

MSDF 与 bitmap 文字保留足够容量的实例 Buffer 和 VAO，并共用一个有界的 CPU staging 数组。
相机改变仍执行成员、顺序、碰撞与 atlas generation 检查；必要的位置数据仍上传，
不声称纯导航已经是 uniform-only，也不跳过标签裁剪。容量只在增长时扩大，未使用批次及时释放。
新增 bufferAllocations、reusedBatches、stagingBytes，分开记录分配、写入和 CPU 工作缓冲。

一个 GeometryResult 内按 mesh 检查 4 ms / 2 MiB 上传切片；先预留全部载荷预算，
部分缓冲归属 building entry，完成前只显示旧 fallback。取消/失败回滚已上传 mesh 与预算。
4 ms 是让步检查预算；单次原生 buffer.write 完成后才进行下一次检查。
新增 peakResultBytes、pendingUploadBytes、uploadCpuMs、maxMeshUploadMs、maxUploadSliceMs、uploadYields。

第二批验证：342 条相关单元测试通过；浏览器 67 条通过、1 条环境条件跳过。
Apple M4 / Chrome 153.0.8010.53，两后端同一 120 标签、370 字形、20 步平移：
新增 GPU Buffer/VAO 从审查时各 20 个降至 0；实例写入仍 20 次，atlas 上传仍 1 次。
CPU staging 为 32,560 字节，正常销毁后为 0。没有将此结果换算为整体 FPS 倍率。
构建、示例构建、类型、布局和架构检查通过。上传取消/失败、旧 fallback 与完整 entry 提交有回归覆盖。

## 第三批：中间副本、管线与栅格上传

非索引几何各 mesh 共享一个精确大小的 Worker 派生 backing buffer。transfer list 去重；
有大 backing 的小视图仍先收紧一次，源坐标与要素三角化 cache 从不随输出转移。
面按 mesh 产出并立即执行 storage clipping，不再同时保留 full[] 和裁剪后的完整数组。
一百万 path 实例测试：16 mesh、实例和邻居不变；输入与输出同时可达的顶点 backing
从 56,001,428 B / 17 块降到 28,000,084 B / 1 块。Worker heap 与显存峰值需分别采集。

默认初始化从 16 套管线减为 13 套，三套 *-reference 在明确使用诊断模式时才创建。
普通生产管线仍预热，避免把编译成本转移到首次正常手势。MSAA4 和两种 shader 语言保留。

正式 GPU painter 提供可选 drawRasterPixels。常规不透明/NoData RGBA 使用 ImageData 的
精确自有快照并以 Texture.writeData 上传；保留一份 CPU 显示缓存供缓存复用/设备恢复，
该流程包含显示像素快照与上传；原生整数纹理走独立实验路径。Canvas2D/自定义旧 painter 无需实现新能力。

像素对照发现任意原始 RGBA 直接替换 Canvas 会改变透明边缘。因此泛型输出会检查 alpha：
0 alpha 的隐藏 RGB 归零；连续 alpha 瓦片继续走原 Canvas 量化路径。
GeoTIFF Worker 在生成时标记 canonicalBinaryAlpha，UI 不重复扫描其已知规范的输出；
其他来源缺省没有该标记，仍走检查路径。这个可选标记是生产者契约，不猜测第三方行为。
压力下旧视图合成仍使用有界 Canvas，临时 pixel-to-Canvas 转换逐张释放，不保留双份缓存。

新增 raster performance.pixelPreclassifiedTiles / pixelPreparedTiles / pixelAlphaFallbackTiles /
canvasPreparedTiles / pixelPrepareMs，以及 pixelCacheBytes / canvasCacheBytes；GPU 新增
pixelTextureUploads / pixelTextureUploadedBytes。读取/解码/重投影/着色的原有计量口径不变。

合成像素对照：两后端 × 两种 alpha × 两种 resampling × 两种 opacity，16 组 RGBA 逐像素零差异。
固定 60 张 256×256 预分类瓦片的准备+上传+绘制 burst 对照，WebGL2 完成约 55–58 ms，
直传约 58 ms，主要收益体现在数据直传；WebGPU 控制约 22–24 ms，直传约 12–16 ms，
但其 CPU 提交约 5–6 ms→10–11 ms。两轮反向次序，非连续手势 FPS，目标设备需按相同方法复测。
初版泛型双扫描额外消耗主线程时间，已用生成端分类修正内置数据源热路径；未掩盖测量差异。

## 最终验收

- 全量 Vitest：293 个文件通过，4,195 项测试通过；56 项按环境/集成开关跳过，不计入通过。
- 最后补跑的 luma/几何/栅格/GeoTIFF 专项：55 个文件、492 项通过。
- 第三批浏览器：59 项正式地图/命令/描边/渐进/内存/合成像素通过；34 项真实文件及文字/2.5D
  通过；另 4 项正式地图真实 GJ/FUS 原图的直接像素缓存与 Canvas 回放对照通过，均有可见像素。
  共 97 项本批选定浏览器用例通过；动态数值栅格覆盖 DPR 1、1.25、2，使用原有数值容差。
- 新增合成像素 16 组与正式真实文件 4 组，在各自固定视图 RGBA 逐像素一致，覆盖范围为这些固定数据与视图。
- 构建、示例构建、bundle smoke、类型与公共契约、测试布局、API 导出、架构和 docs:verify 均通过。
- 浏览器是 Apple M4 / Chrome 153.0.8010.53，明确使用 WebGL2 和 WebGPU；未运行 Windows。
  正常销毁及上传取消/失败有回归；没有把已知载荷计数当作完整浏览器 heap 或驱动显存测量。

执行日志、对照 JSON 和截图保存在本机 `/tmp/emap-luma-fixes-z9lu2v32`；详细终端日志
使用 `/tmp/emap-luma-fix-*.log` 命名。没有推送、发布或修改测试原始数据。

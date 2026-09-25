# luma 集成现状

## 正式地图入口

Emap.create 支持 renderer: canvas2d / webgl2 / webgpu，默认 webgl2。
通过原生 Cordis painterFactory 接入正式图层与编辑服务，不再只能在独立 benchmark 中选择 GPU。
细节与验收范围见 [正式三后端](renderer-backends.md)。这里描述当前代码，不沿用旧报告的未提交状态。

## 已接入正式主链路

点、线、面直接 GPU 绘制；GPU 缓冲复用、原有 PointLod、源图层顺序、过滤和属性样式保持。
附属文字采用 [MSDF 与 HarfBuzz](luma-labels.md)，[点图片符号](luma-icons.md) 复用点坐标。
[Symbol 样式映射](luma-symbol-style.md) 仍为 symbol.layout / paint / labeling / images，不增加图层树节点。
既有 GeoTIFF 的读取、重投影、着色与渐进瓦片通过所选 Painter 合成；选择与编辑仍由正式地图服务管理。
编辑覆盖层继续使用独立 Canvas2D；不是把整幅矢量地图先栅格化再上传 GPU。

## 正式地图性能优化

正式 WebGL2/WebGPU 导航复用 GPU 几何按当前相机绘制，并在手势中补图/更新文字；Canvas2D 保留原自适应策略。
弧段和候选边界准备纳入两级缓存，避免 GPU 缓冲命中前仍重复遍历。详见
[正式地图性能优化](luma-formal-performance-optimization.md)。未更改点 LOD 密度或原始数据精度。

正式大数据另已接入 [稳定分块/几何 Worker/屏幕缓存](luma-formal-geometry-chunks.md)。
同一源版本下复用重叠可见块，长线/面以小 buffer 提交；已就绪块按原有顺序渐进显示。
[渐进渲染](luma-progressive-rendering.md) 另补齐超大面内部三角形裁剪、Worker 要素三角化缓存、
手势中的有界补图以及保持 CSS 字号的注记预览，不再只变换旧截图。
Brandenburg 的五百万要素已完成后续三后端专项测试，具体路线、修复及仍存在的延迟见
[真实大文件验收](brandenburg-stress-test.md)；不能外推为所有机器与数据均无资源限制。

[GeoPackage 4× 与回全图优化](geopackage-zoom-performance.md) 减少显示几何准备开销，
保留单 Worker、默认精度和既有预算。完整旧视图仍可能因淘汰而需要重建。

## 保留的实验链路

- [2.5D 相机](luma-25d.md) 与 [2.5D 性能](luma-25d-performance.md)：pitch/bearing 尚未进入正式 View API。
- [动态整数栅格](luma-raster-dynamic.md)、[源块与 halo 复用](luma-raster-block-reuse.md)：
  Native integer GPU 纹理仍在 luma-raster/luma-25d 专用链路，不等同于正式瓦片合成路径。
- [完整精度基线](luma-full-precision-performance.md)、[点优化](luma-point-optimization.md)、
  [点 LOD](luma-point-lod.md)、[线优化](luma-line-optimization.md)、[屏幕过滤](luma-canvas-screen-filter.md)、
  [快照导航](luma-fast-navigation.md)、[退远缓存](luma-zoom-out.md)：均为相应实验版本的证据，不能当作正式 Painter 的性能承诺。
- [顶点编辑实验](luma-vertex-editing.md)、[局部刷新](luma-editor-refresh.md)、[深缩放精度](luma-zoom-precision.md)：
  保留专用 Worker/patch 和三角网缓存验收，正式编辑使用原有命令与历史服务。

## 使用

`pnpm examples:luma` 启动示例。正式入口：mixed-data-viewer / geotiff-viewer；实验入口：
luma-benchmark / luma-vertex-editing / luma-raster / luma-25d。
GPU 创建失败不会静默降级；宿主需要兼容路径时应显式创建 Canvas2D 地图。

## 后续整合重点

大型矢量的有界分块 Worker 已进入正式 API；随后应按真实超大文件继续验收导入、业务索引和
极端单要素限制，再分别接入原生整数栅格及正式相机/交互。不能因为三后端选择已接入，就把全部实验性能与 2.5D 编辑能力视为已验收。

## 超大文件专项验证

[Brandenburg 完整导入与压测](brandenburg-stress-test.md) 已分别验证 Canvas2D、WebGL2、WebGPU。
补齐帧收集期间的几何驻留保护及冷近景上传存储裁剪，源文件与默认预算不变。
当前这份文件的 GPU 完整更新仍比 Canvas2D 慢；稳定性通过与性能达到目标分别报告。

## 二进制批次效率改进

[二进制几何与稳定描边缓存](luma-binary-batch-optimization.md) 补齐平坦数据处理、保守精度档位、
紧子块范围、调度/淘汰复用和元数据注册 LOD 复用。默认描边网格相位可能变化，源坐标不变；
具体性能以新一轮 Brandenburg 前后对照为准，不沿用此前稳定性验收当作新跑分。


## 几何缓存与批次效率

正式 GPU 新增数值键 LRU、稳定 Morton 基数排序、带对齐统计的 uint16 分块索引、
细粒度裁剪后的有界描边合批及跨 LOD 计划保留。精度、样式顺序和原 GPU 预算不变。
实现、验证及对应测量边界见 [几何效率改进](luma-geometry-efficiency.md)。

## 有效描边与共享缓冲页

正式二维不透明实线减少无效实例并预计算连接；适合的填充/描边首次上传即使用共享页，
仅合并相邻兼容区间。原MSAA、源数据和预算保留，稀疏浮点边缘差异及冷准备交换明确记录。
实现、CPU/GPU分别计时、共享页内存与资源回收见 [描边与缓冲页](luma-stroke-rendering.md)。

## 绘制命令与稳定帧复用

正式绘制增加有界的有序命令计划、作用域样式复用、WebGPU 原生 MSAA4 bundle 桥接，
并改进空闲区间拆合与已完成帧的缓存维护。逻辑绘制次数仍按实际 draw 统计；
CPU 提交减少不等于 GPU 着色量同比下降。见 [命令复用](luma-render-commands.md)。

## 描边驻留与物理页顺序

不透明实线使用无损 XY/高低位分组，严格保留非零低位；同一绘制作用域内按物理页组织，
其他透明/虚线/图层顺序不变。命令失效按实际 mesh 依赖缩小，不再连带清空无关图层。
实现、前后实测和剩余边界见 [描边格式与驻留](luma-stroke-residency.md)。

## 几何准备吞吐

正式 GPU 将小任务合并为有总量上限的 Worker 消息，并在原生弧长可安全估算时减少一次坐标扫描。
逻辑块仍独立，首批立即反馈，取消/资源预算保持；不是增加 Worker 或降低显示精度。
实现、同路线数据及输入/输出内存边界见 [几何微批次](luma-geometry-throughput.md)。

## 已驻留描边范围与部分区间合批

描边只选择安全包络内的已有实例，原始坐标与长线布局不变；同色面页和裁剪后的连续区间共享绘制计划。
非等比导航禁用不兼容的描边包络，过滤洞和回收区间不被跨越。实现、实测与边界见 [范围合批](luma-selected-range-batching.md)。

## 审查后三批修复

[审查修复记录](luma-audit-fixes.md) 记录资源回收、异常清理、文字缓冲复用、可取消上传切片、
Worker 输出副本和管线预热改进。正式 GPU 的规范二值 alpha RGBA 瓦片可绕过 Canvas；
连续 alpha 和缓存压力合成仍保留兼容路径，不等同于原生整数纹理实验全部接入。

# 正式地图的三后端接入

## 创建方式

```ts
const map = await Emap.create({
  container: 'map',
  renderer: 'webgl2', // 默认；canvas2d / webgl2 / webgpu
  // 构建工具重排资源时显式指定；同时部署该 Worker 同级的 msdf/ 目录。
  msdfWorkerUrl: '/assets/emap-msdf-worker.js',
  geometryWorkerUrl: '/assets/emap-geometry-worker.js',
  screenPathFiltering: true, // 大数据不透明实线的显示优化
});
map.getRenderer();
```

不提供运行时热切换。GPU 不可用或初始化失败会拒绝创建并清理资源；没有静默 fallback。
默认值改变属于行为变更。旧宿主保留 renderer: 'canvas2d' 即可继续使用旧绘制链路。
headless/empty 不创建 GPU；getRenderer() 返回 null。显式自定义 painterFactory 仍可覆盖默认 Provider。

## 所有权与调用链

Emap.create → 原生 Cordis viewer/editor preset → provider.renderer → painterFactory →
异步 CanvasRenderService.initialize → main Painter + 独立 overlay CanvasPainter。

GPU 主 Painter 直接使用已验证的 GpuRenderer：点和图标复用原始坐标缓冲，路径使用
pathGeometry/PathRangeIndex，填充使用保留各要素与孔洞的 polygonGeometry，文字使用 MSDF atlas。
CorePainter 新增可选 finishFrame/dispose/createLabelAtlas/clearGeometryCache 等接口；旧的同步 Painter
无需实现 GPU 生命周期。主帧总是在 finally 中结束并提交，编辑覆盖层维持原来的交互与历史逻辑。

初始化期间保持原生 Provider LOADING，依赖它的 Handler 在真实 Painter 就绪后激活。
根 Context 的释放取消尚未完成的创建；迟到的 Painter 必须销毁，不再挂回 DOM。

## 缓存与正确性

几何缓存按 source/layer、编辑版本、原始输入身份、可见要素/LOD 分量索引和弧段保留级别建立。
颜色、点半径、icon 大小/角度等 paint 不进入几何键；属性过滤或几何修改产生新选择/版本时重建。
小几何缓存预算为 256 MiB；分块缓存把小几何占用合并计入软预算，保护所需块并优先淘汰非可见数据。
当前工作集最多 512 MiB；超限明确报错，不通过无限缓存或省略要素继续绘制。源数据和 Worker 暂存另计。
图片资源由 source/icon 所有者与当前帧共同管理；稳定栅格瓦片标记 immutable 后不再逐帧上传。
源顺序、显示过滤、选择、编辑、undo/redo、附属 symbol 映射全部通过正式地图服务。

## 正式 GPU 导航与弧段准备优化

WebGL2/WebGPU 使用已驻留 GPU 缓冲按当前相机重绘，点、图标和文字不随快照放大。
导航时合并最新视口规划，Worker 持续处理有界任务，新区域可以在松开鼠标前补齐；
文字使用地面锚点与 CSS 偏移预览，异步布局补充新候选。结束后校准最终视图。
Canvas2D 和未实现原生导航的自定义 Painter 保留已有自适应快照。样式、过滤、显隐与源
变更仍使相关旧内容失效；GPU 失败不能复用失效命令。详见
[渐进场景与原生导航](luma-progressive-rendering.md)。

弧段缓存分为“准备条件”和“实际几何”两级。同一视口/几何版本/有序输入选择下，跳过重复
过滤与候选要素展平；视口改变后重新判断选择，但选择结果相同可继续使用原 mesh。
只对可验证的 Viewport 谓词缓存准备结果，外部有状态闭包仍逐次计算。
输入 ID 内容保留副本，支持原地修改检测；源、图层、编辑版本、弧段保留级别参与失效。
普通边界保持原来的正向 arc 方向，样式桶路径保留有符号方向，不改变虚线/箭头语义。
新增选择副本纳入同一 256 MiB 预算并随其 owner 释放，未增设无界缓存。

这些是正式共享渲染层的默认行为，无需在每个 example 设置私有开关。
详见 [性能优化与验收](luma-formal-performance-optimization.md)。

## 本次接入与实验功能的边界

- 正式主画布接入：点/线/面、图片符号、MSDF、既有栅格瓦片合成、过滤与样式、选择与编辑。
- 编辑手柄、绘制预览、测量文字继续使用独立 Canvas2D 覆盖层，未重写为 GPU。
- 正式 View 仍是二维 AffineTransform。luma-25d 的 pitch/bearing 和专用相机尚未成为正式 View API。
- 正式 RasterRenderService 继续使用既有 CPU/Worker 着色与重投影，结果通过所选后端显示；
  Native integer texture + halo 复用仍在 luma-raster / luma-25d 专用路径，不冒称本次已经替换。
- 大矢量的正式 Painter 已接入稳定分块和独立几何 Worker，以及不透明实线的屏幕缓存。
  主线程仍负责协作式成员规划/坐标包复制，导入和首次业务索引不属于几何 Worker。
  多彩图标保留原始重叠顺序；就绪块按图层顺序渐进重绘，保守三角形范围索引减少超大面绘制，
  Worker 精确要素缓存复用未变三角化。详见 [渐进渲染](luma-progressive-rendering.md)。
- 因此旧 benchmark 报告不等于新正式地图的性能数据；后续迁移优化应在同一真实数据上分别测量。

## 手工入口

`pnpm examples:luma`，然后打开 `/mapseekai/emap/examples/` 中任一示例。
全部示例页顶部都有 Canvas2D / WebGL2 / WebGPU 按钮，当前选择高亮，默认 WebGL2。
正式地图通过 `renderer: getExampleRenderer()` 将 URL 选择明确传给 `Emap.create()`，
包括共享 DuckDB 示例运行器、多实例 Cordis 检查器和重建地图的 Worker 示例；不修改库的全局构造器。

按钮修改当前页的 `?renderer=canvas2d|webgl2|webgpu` 后重新加载，保留其他查询参数和 URL 锚点。
不是运行时热切换：本地文件需要重新选择，未保存的编辑会丢失。点击已选中的按钮不重载。
工具栏先于设备创建挂载，GPU 初始化失败后仍能点击 Canvas2D 重新打开正式示例。
原来的 geotiff-viewer / mixed-data-viewer 侧栏下拉已经合并进统一顶部按钮，不再有两份设置。

专用实验继续使用现有渲染管线，不用它们代替正式 API 验证：
- luma-benchmark 支持三种画面，保留原 A/B 切换并同步顶部状态。
- luma-raster 支持三种栅格绘制路径；Canvas2D 是正式栅格流程，GPU 是原生数值纹理路径。
  用于相机/交互的辅助 Emap 固定为 Canvas2D，不把隐藏的 GPU 主画布冒充 Canvas2D 对照。
- luma-25d 与 luma-vertex-editing 专用管线只支持 WebGL2 / WebGPU，Canvas2D 按钮禁用并标注“仅 GPU”。
  正式 vertex-editing 示例不受此限制，支持三种后端。
实验旧的 `?gpu=webgl|webgpu|canvas` 和 benchmark `?renderer=canvas` 链接仍可用，
新的明确 `renderer` 参数优先；切换时同步旧 GPU 参数，避免两份设置冲突。

响应式工具栏可以换行，浮动页头按实际高度调整地图和侧栏位置。切换按钮支持键盘 Tab/Enter，
并使用 aria-pressed 报告选择状态，禁用项有明确说明。

## 验证

`test/browser/map-renderers.spec.mjs` 使用实际三后端、带孔面、父过滤、样式缓存、源顺序、
顶点编辑/撤销、异步失败与已发布 ESM/MSDF 资源。Node/jsdom 的 Canvas 专属测试显式选 canvas2d，
不把假的 Canvas 上下文冒充 GPU。旧浏览器像素测试通过 ImageBitmap 读回，避免在 GPU canvas 上申请第二种 context。

默认切换前的回归还覆盖撤销后再次拖动顶点：提交历史可能同步清除悬停状态，完成拖动使用已捕获的要素信息，避免读取空对象。

分数 DPR 下先按实际整数 backing 宽高计算设备比例，再共同对齐图片四边与 scissor，避免取名义 DPR 导致瓦片边界半覆盖。三后端均有混合分辨率、半透明渐进覆盖的无缝回归。

实时顶点拖动保留原有数据版本策略；仅在顶点预览状态改变时清除受影响源的 GPU 几何缓存，主图与编辑预览同时跟随移动，不使未编辑图层重复上传。

## 超大 GeoPackage 压测与存储边界

[Brandenburg 专项报告](brandenburg-stress-test.md) 用同一完整文件测试三后端，不改写源数据。
帧收集期间仍保护稍后才登记的图层请求，完成状态核对实际驻留，避免过预算淘汰后假完成或缺图。
冷近景面缓冲由 Worker 在保守覆盖内压紧后上传，已驻留完整缓冲可直接复用；几何预算未提高。
该文件当前仍有显著导入和 GPU 完整补图延迟，详细数值与 Canvas2D 对照见报告。

## 当前二进制几何路径

大数据的正式 Worker 已使用平坦 XY/offsets 路径与源锚点描边档位，旧的小几何同步绘制继续保留。
当前批次组织、半像素显示误差与前后对照见 [二进制批次优化](luma-binary-batch-optimization.md)。


## 几何缓存与批次效率

正式 GPU 新增数值键 LRU、稳定 Morton 基数排序、带对齐统计的 uint16 分块索引、
细粒度裁剪后的有界描边合批及跨 LOD 计划保留。精度、样式顺序和原 GPU 预算不变。
实现、验证及对应测量边界见 [几何效率改进](luma-geometry-efficiency.md)。

## 有效描边与共享缓冲页

正式二维不透明实线减少无效实例并预计算连接；适合的填充/描边首次上传即使用共享页，
仅合并相邻兼容区间。原MSAA、源数据和预算保留，稀疏浮点边缘差异及冷准备交换明确记录。
实现、CPU/GPU分别计时、共享页内存与资源回收见 [描边与缓冲页](luma-stroke-rendering.md)。

## 有序绘制计划与 WebGPU 命令复用

正式 WebGL2/WebGPU 复用相同有序 mesh 与可见范围的提交计划。WebGPU 对满足条件的
面和不透明 MSAA 描边自动录制命令 bundle，保留四倍采样；其他绘制仍走原管线。
无需创建参数。资源和范围变化正确失效，过滤/顺序/文字/栅格状态不由旧 bundle 覆盖。
统计口径、内存边界与同数据结果见 [绘制命令优化](luma-render-commands.md)。

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

## 资源与显示缓存诊断

GPU 的 `painter.stats.memory` 分项统计已知载荷，`nominalKnownGpuBytes` 不代表驱动实际总显存。
正式栅格可选像素上传保持旧 Painter 兼容，连续 alpha 保留 Canvas 语义。
具体范围、数值与测试见 [三批审查修复](luma-audit-fixes.md)。

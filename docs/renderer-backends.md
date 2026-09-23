# 正式地图的三后端接入

## 创建方式

```ts
const map = await Emap.create({
  container: 'map',
  renderer: 'webgl2', // 默认；canvas2d / webgl2 / webgpu
  // 构建工具重排资源时显式指定；同时部署该 Worker 同级的 msdf/ 目录。
  msdfWorkerUrl: '/assets/emap-msdf-worker.js',
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
默认几何预算为 256 MiB；帧提交后释放不再使用的 owner，超预算缓存也在提交后淘汰。
图片资源由 source/icon 所有者与当前帧共同管理；稳定栅格瓦片标记 immutable 后不再逐帧上传。
源顺序、显示过滤、选择、编辑、undo/redo、附属 symbol 映射全部通过正式地图服务。

## 本次接入与实验功能的边界

- 正式主画布接入：点/线/面、图片符号、MSDF、既有栅格瓦片合成、过滤与样式、选择与编辑。
- 编辑手柄、绘制预览、测量文字继续使用独立 Canvas2D 覆盖层，未重写为 GPU。
- 正式 View 仍是二维 AffineTransform。luma-25d 的 pitch/bearing 和专用相机尚未成为正式 View API。
- 正式 RasterRenderService 继续使用既有 CPU/Worker 着色与重投影，结果通过所选后端显示；
  Native integer texture + halo 复用仍在 luma-raster / luma-25d 专用路径，不冒称本次已经替换。
- 大矢量的正式 Painter 使用几何缓存和原有 PointLod，第一次几何构建仍在主线程；
  benchmark 的全套专用 Worker/屏幕过滤/快照策略尚未整体移动进正式主链路。
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

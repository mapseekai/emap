# 正式地图与 luma-benchmark 的性能接线检查

日期：2026-09-23。基线提交：`17fd94c2`，分支 `master`。
本次只诊断，没有修改正式渲染器、公开参数默认值、示例性能开关，也没有提交或推送。

## 结论

性能差异可以复现，但不是 WebGL2/WebGPU 未真正启用，也不是漏开同一套配置的全部开关。
正式 `Emap` 已使用 `LumaPainter → GpuRenderer`，实验页使用
`BenchmarkRenderers → 分块/Worker/屏幕缓存/手势快照 → GpuRenderer`。
三后端入口统一不等于这两条上层性能管线已经统一。

## 检查范围与测量口径

- 使用授权 Mac 上的本地代码和完整 points.geojson、building.geojson、lucc.geojson。
- Chrome headless，WebGL2/WebGPU 分别测量，地图 960 × 640 CSS px，DPR=1。
- 当前授权机器对用户提供的 3000 端口示例 GET 返回 404。实测使用正在运行的
  `http://127.0.0.1:4187/mapseekai/emap/examples/luma-benchmark/`，没有验证其他机器 3000 端口的构建。
- 先使用实际 benchmark 导入和准备数据，再把同一份已导入数据交给正式 `Emap.create()`。
  除正式注册时复制 dataset 元数据外，LUCC/building 的原始 arcs 和 shapes 引用保持相同；没有再次解析文件。
- 固定同一份颜色、线宽、点半径、填充透明度，以及逐项相等的 mx/my/bx/by 和画布尺寸。
- 保留各管线的既有显示策略：benchmark 默认点网格 3 px、屏幕描边过滤；正式地图默认点网格 8 px、DisplayArcs。
  因而这是相同输入/视图/基础样式下的管线检查，不是逐像素相同的图形质量比较。
- 各稳定视图采样 6 个真实重绘帧，报告主线程绘制/提交时间中位数。排除首次文件读取、解析和冷几何构建；
  不是 GPU 执行时间或 FPS，也不将小样本比值外推到所有 121 个示例。
- 另测同一段 20 次真实鼠标移动，统计手势过程中 GPU 帧和上传次数，结束帧单独统计。

## 参数和路径对照

| 项目 | 正式地图 | luma-benchmark |
| --- | --- | --- |
| 实际后端 | WebGL2/WebGPU，getRenderer 与真实设备匹配 | 相同 GpuRenderer |
| 圆点覆盖优化 | 默认启用 | 默认启用 |
| 线条 MSAA | auto；本机两后端均为 4 samples | 相同默认值及适用条件 |
| 点 LOD | 默认启用，8 CSS px | 默认启用，3 CSS px |
| 路径范围裁剪 | 已有 PathRangeIndex，另有原有视口 arc 过滤 | 分块可见性及路径范围裁剪 |
| 描边显示过滤 | DisplayArcs/原有微小 arc 过滤 | Worker 屏幕路径、半像素重复点过滤及按视图缓存 |
| 手势快照 | 上一完整帧 CPU 时间超过 1000/30 ms 才触发 | 默认开启，已有完整帧时直接进入预览 |
| 几何准备 | 正式 Painter 同步准备/筛选 | GeoJSON 专用 Worker 与异步分块准备 |
| 几何缓存 | 按 source/layer/绘制槽/版本/可见 ID 集合 | 按稳定空间 chunk，视图变化复用 mesh |
| 256 MiB 预算 | 每帧结束执行硬淘汰 | 保护当前可见工作集，非可见数据软预算；统计口径也不同 |

普通示例的 `renderer` URL 参数只决定后端，不会自动启用 benchmark 专用 `screenFilter/nav` 流程。
`useWorker: true` 是地图数据集操作的 Worker 路由，不会把 LumaPainter 的几何构建移到 Worker。

## 稳定帧实测

单位：ms，主线程绘制/提交中位数。

| 文件 | 视图 | WebGL2 benchmark | WebGL2 正式 | WebGPU benchmark | WebGPU 正式 |
| --- | --- | ---: | ---: | ---: | ---: |
| building.geojson | 完整范围 | 2.05 | 10.55 | 0.75 | 10.40 |
| building.geojson | 16× 近景 | 0.15 | 1.00 | 0.20 | 1.10 |
| lucc.geojson | 完整范围 | 3.40 | 11.05 | 1.45 | 11.05 |
| lucc.geojson | 16× 近景 | 0.25 | 8.45 | 0.55 | 8.90 |

六组文件/后端测试中的所有稳定重复帧都没有增加几何上传次数，也没有观察到缓存预算淘汰。
不能据此声称“每一帧都在重传全部数据”，也不能把 256 MiB 缓存抖动当成本次已复现的主因。
缓存溢出的结构性风险需要额外超预算输入验证。

点网格也不是没开：同一完整范围中，正式默认绘制 2,338 个代表点，benchmark 为 20,679 个。
在一次性诊断页面把正式图层 cellSize 明确设为 3 后，也得到 20,679 个代表点。
但正式点帧的中位 CPU 时间变为 WebGL2 0.90 ms、WebGPU 1.10 ms，benchmark 分别为 0.30/0.20 ms。
把网格改成 3 是密度对齐，不是提速开关，不能用它解释或解决线面性能差异。

## 已定位的主要成本

### 1. 几何缓存命中之前仍重复准备弧段 ID

正式 `LumaPainter.drawArcs()` 每次调用都执行 `Int32Array.from(...).filter(...)`，之后才查询几何缓存；
比较可见 ID 集合也需要遍历内容。即使最终 mesh 命中且上传次数不变，CPU 准备仍会发生。

对 WebGL2 追加方法计时：LUCC 完整范围 6 帧的 drawArcs 累计 66.4 ms，16× 近景累计 50.2 ms；
building 完整范围累计 63.2 ms。同期 fill 缓存命中，drawPolygonFill 分别仅累计约 0.5/0.1/0.4 ms。
这是方法级计时：确认成本集中在 drawArcs，未把其内部每个循环或驱动调用精确拆分。

### 2. 普通手势没有触发已有快照路径

原调度器使用上一帧 CPU 时间 > 33.3 ms 作为条件。上面约 8–11 ms 的正式帧达不到门槛，
即使真实 GPU 总工作较多，也会继续提交完整几何；CPU 提交时间本身不能代表 GPU 执行耗时。

16× 近景同一段 20 次鼠标移动：两个 GPU 后端均得到以下结果。

| 数据 | benchmark 手势中 GPU 重绘 | 正式手势中 GPU 重绘 | benchmark 手势中几何上传 | 正式手势中几何上传 |
| --- | ---: | ---: | ---: | ---: |
| points | 0 | 20 | 0 | 20 |
| building | 0 | 20 | 0 | 40 |
| LUCC | 0 | 20 | 0 | 20 |

benchmark 通过旧帧预览保持交互，结束后再更新。正式路径的可见 ID 集合变化后会重建对应绘制槽，
不等同于在稳定空间 chunk 上仅改变可见范围。次数不是“全部原始数据被复制多少次”。

另做了明确隔离的触发条件实验：仅在可销毁的测试地图中，将调度器的上次耗时记为 34 ms，
让原有快照分支生效；building/LUCC 均变为手势中 0 次 GPU 重绘、0 次上传，结束后 1 次重绘。
这只证明快照触发策略的因果影响，不是生产修复，也没有更改项目默认值。

### 3. 缺少完整分块与屏幕缓存管线

benchmark 对 LUCC 16× 视图选择 11 个可见 chunk，提交约 39,950 条过滤后描边线段。
正式路径沿用可见要素与 DisplayArcs；某个超大面与视口相交时，仍需提交该面的整个填充 mesh。
这和稳定空间分块、按当前视图准备屏幕描边的行为不是同一个参数层级。

### 4. 首次导入/几何准备的 Worker 责任不同

benchmark 的 GeoJSON 使用 `importBenchmarkFile()` / `import-worker.ts`，并继续复用其几何准备 Worker。
例如普通 mixed-data-viewer 使用 `file.arrayBuffer() → source.setData()`，正式 Painter 几何构建也在主线程。
本报告没有重测两条完整文件导入流程的时间，不能把稳定帧表当成加载加速比。

## 建议的迁移顺序

1. 优先统一 GPU 手势快照策略，并缓存弧段 ID/可见选择准备，消除 warm frame 的重复遍历；
   保留样式/过滤/编辑版本失效、手势结束完整更新、选择和编辑正确性。
2. 将分块几何与 Worker 接入正式主链路，使用稳定 chunk ID 作为 GPU 缓冲身份，
   避免每次可见 ID 变化就替换整段绘制槽。
3. 将屏幕描边缓存作为明确的显示优化接入正式 renderer；验证虚线、半透明、方向、图层顺序和缩放精度。
   统一配置应放在库/共享渲染层，不能让每个示例复制私有开关或令 engine 反向依赖 packages/examples。
4. 对缓存预算另做极端工作集测试；不能通过无限放大显存预算或悄悄改变精度来换取表面速度。

## 代码依据

- `src/engine/providers/workspace/renderer-plugin.ts`：正式三后端选择。
- `src/integrations/luma/gpu-renderer.ts:127,209`：圆点与线条默认策略。
- `src/integrations/luma/painter.ts:147,213`：范围选择与每帧弧段 ID 准备。
- `src/integrations/luma/painter-cache.ts:57,102`：绘制槽、可见集合缓存键与预算淘汰。
- `src/engine/rendering/point-lod.ts:164`：正式点网格默认 8。
- `src/engine/rendering/render-scheduler.ts:4,83`：33.3 ms 条件式快照。
- `packages/examples/src/luma-benchmark/main.ts:82,95`：实验快照/屏幕过滤默认开启。
- `packages/examples/src/luma-benchmark/renderers.ts`：分块准备、绘制和可见工作集保护。
- `packages/examples/src/luma-benchmark/import-file.ts:178`：专用 GeoJSON/几何 Worker。
- `packages/examples/examples/mixed-data-viewer/index.html:119`：普通示例文件导入。

原始 JSON、只在一次性浏览器页面添加计时包装的脚本和日志保存在
`test-results/formal-luma-performance-audit/`（git 忽略；未上传原始数据）。
两轮诊断均无 pageerror，释放后 Worker 数为 0。没有修改或重新执行整库回归，本次结论来自代码检查与专门实测。

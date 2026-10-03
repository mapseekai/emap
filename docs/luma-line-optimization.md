# luma 线渲染优化与真实数据验证

日期：2026-09-20。更新为本轮最终候选源码的复测结果；不混用之前 LOD 或点渲染测试。

## 本阶段的线绘制能力

范围为 `luma-benchmark`、`luma-vertex-editing` 两个实验示例。该阶段默认 emap viewer/editor 使用 Canvas。渲染权威数据继续使用原生 mapshaper dataset，不把 Arrow 加入生产数据链路。
参考本地 deck.gl-geoarrow 的 GeoArrowPathLayer 及其 deck.gl 9.3 PathLayer，使用连续二进制坐标、路径偏移和六顶点/十二索引的连接包络。GPU 缓存复用原始 Buffer，不因平移缩放重建。
默认对支持多重采样的不透明实线使用圆角连接、圆头和 MSAA；相邻同色绘制利用私有覆盖深度跳过重复写入，关闭这部分不必要的透明混合。不同颜色、半透明、点、面和栅格形成绘制顺序边界，不跨越边界合并。
半透明和虚线路径继续使用原有解析描边；无 MSAA 时回退。箭头仍属于既有 segment pipeline，由既有路径继续提供。
本轮继续修正顶点着色器：先对源坐标高低位求差，再计算方向；只投影当前顶点，避免对四个绝对位置反复投影后相减。提前跳过填充用的无效实例；原始短线段保留。
线、面不启用 LOD、不做半像素吸附、不省略小图斑/短边；点背景继续保留已完成的 3 CSS px PointLod。选择、编辑、撤销重做和导出使用原始坐标。

## 精度与模式

`auto` 为优化后的 MSAA 路径；界面中的 `reference` 使用同一 MSAA 几何但关闭覆盖优化；`legacy` 使用旧解析描边。
旧版与新版的原始几何、线宽、DPR 相同，但抗锯齿和连接计算不同，像素差异按下述对照方式测量。精确像素对照仅比较 auto 与同 MSAA 的 reference；半透明/虚线回退与 legacy 对照。
专项脚本的 `--modes reference` 指外部 GeoArrowPathLayer（需 --reference-dir）；`--modes standard` 才对应界面的 reference 模式。

## 实测条件

Apple M4、16 GiB、Headless Chrome 153；CSS 绘图区 1238×450，DPR 1.25，4×MSAA；四个 luma 包均为 10.0.0-alpha.1。浏览器串行运行，原有服务没有停止，同期运行其他服务。
完整加载 big.geojson、lucc.geojson、building.geojson。big 为 23,044,680 个原生顶点、22,550,788 条非零线段；LUCC 为 3,932,506 个顶点、3,724,779 条非零线段；building 为 1,263,385 条非零线段。
下表是固定视图、仅描边：预热 6 帧、采样 20 帧。big 线宽 1.2 CSS px，面边界 0.6 CSS px，透明度均为 1。远景为 fit×exp(-3.2)，近景为 fit×16。整场景 ABBA 导航帧率另行测量。
FPS 为 1000/平均 rAF 间隔，CPU 为 JS 绘制/提交，GPU 完成帧数与执行耗时需独立测量。像素回读和截图排除在计时外；SHA 校验预读文件，因此保留文件缓存。

| 文件 | API | 完整范围：旧解析 → 优化 | 远景：旧解析 → 优化 | 近景优化 |
|---|---|---:|---:|---:|
| big.geojson | WebGL2 | 3.83 → 9.84 | 0.87 → 7.06 | 60.01 |
| big.geojson | WebGPU | 3.28 → 7.50 | 0.88 → 7.69 | 60.01 |
| lucc.geojson | WebGL2 | 19.05 → 57.13 | 2.71 → 42.85 | 60.01 |
| lucc.geojson | WebGPU | 17.65 → 33.33 | 2.72 → 37.50 | 59.99 |
| building.geojson | WebGL2 | 50.00 → 59.99 | 5.71 → 59.99 | 59.99 |
| building.geojson | WebGPU | 34.29 → 60.01 | 5.74 → 60.01 | 60.01 |

**big 的完整范围和极远景仍只有约 7–10 FPS，没有达到流畅交互；这一视距仍需优化。** LUCC 边界改善明显，building 基本达到本次显示节奏上限。近景仅提交可见块，该帧率对应可见块，源数据中的 2,300 万顶点完整保留。

## 实际 GeoArrowPathLayer 对照

本地参考库 commit b3b93c3821d26a386a5ed44f74ec184ad1d14b0d，包版本 0.4.2、@deck.gl/layers 9.3.0。同一组唯一原始 arc、相同线宽/颜色/DPR/4×MSAA，不截取批次；强制每帧 redraw，检查原生实例化调用及非空像素。仅用于测试，不改变参考仓库或增加生产依赖。

| 文件 | GeoArrow 全范围 | emap 全范围 | GeoArrow 远景 | emap 远景 |
|---|---:|---:|---:|---:|
| big.geojson | 3.51 | 9.84 | 1.07 | 7.06 |
| lucc.geojson | 19.36 | 57.13 | 5.11 | 42.85 |
| building.geojson | 41.38 | 59.99 | 7.55 | 59.99 |

GeoArrow 近景仍提交整份数据，而 emap 做空间裁剪，不将近景用作同工作量加速比较。这是本机、本数据与本次样式下的结果，其他数据与样式需按同样方法复测。

## 后续诊断与方案对照

补充实验保持完整原始几何和实例提交：big 在固定完整范围约 10.3 FPS，临时关闭光栅化仍约 11.6 FPS；远景约 6.7–7.4 FPS，关闭光栅化约 10.4 FPS。该实验不显示地图，只用于定位，其计时作为瓶颈诊断数据。它支持后续继续分析顶点/图元前端开销，同时单独评估颜色混合。
另测试过四顶点紧凑胶囊方案。big 完整范围约 7.50 FPS、远景 2.38 FPS，LUCC 远景 21.82 FPS，反而比保留的连接包络慢；已撤掉，没有作为默认实现。
后续 big 的优化须继续保留几何完整性，考虑顶点/连接计算复用或更换图元组织算法；本轮没有恢复化简，也没有以缓存旧画面冒充全几何重绘。发现和复现只记录在本地，没有创建外部 issue。

## 验证

82 项单元/回归、类型、公共类型契约、示例类型、架构和测试布局检查通过。全套浏览器 19 项通过，包含五份真实文件的 WebGL2 原始编辑回归及两 API 的点、线像素和点 LOD 生命周期。
另跑 WebGPU 编辑 6 项通过；五份真实数据均完成原始选择、移动、Esc 取消、撤销/重做、Worker 补丁和释放验证。
线像素对照为 2 API×3 DPR×15 场景，共 90 组，逐通道差异为 0；包括反向路径、重叠、颜色顺序、点/面/半透明插入、虚线、0.2/0.6/1.2/8 px 线宽，以及近景、极远景、非等比/翻转视图。功能测试使用 LUCC 原始 48 条 arc 子集，不拿该子集做性能依据，也不声称与旧解析 AA 像素一致。
主性能 15 个文件/后端/模式组合、45 个视图全部完成；原文件 SHA-256 未变。完整范围和远景核对全部原始非零线段；emap 暖重绘新几何上传为 0，无缺失块或化简省略，实际出图且未捕获页面/GPU 错误。释放后跟踪的几何 Buffer 和数据 Worker 数均归零，不等于对浏览器/驱动总峰值内存的审计。
生产构建与 docs:verify 全部通过。

## 手动测试与复现

刷新 `/mapseekai/emap/examples/luma-benchmark/?gpu=webgl`，线绘制选择“MSAA 路径优化”。“旧版解析描边”可对照；“MSAA 同几何对照”用于验证覆盖优化。GPU API 可切 WebGPU。诊断选择“全部”看完整场景，选择“仅描边”与表格口径一致。顶点编辑示例有同一组线模式控件。

```bash
cd /Users/zhang/code/emap
pnpm examples:build
pnpm benchmark:luma:lines --data-dir "/Users/zhang/Desktop/测试数据" --gpu webgl --frames 20 --modes legacy,auto --output test-results/luma-lines-local/webgl
pnpm benchmark:luma:lines --data-dir "/Users/zhang/Desktop/测试数据" --gpu webgpu --frames 20 --modes legacy,auto --output test-results/luma-lines-local/webgpu
# 可选本地 GeoArrow 对照，仅测试打包
pnpm benchmark:luma:lines --data-dir "/Users/zhang/Desktop/测试数据" --gpu webgl --frames 20 --modes auto,reference --reference-dir /Users/zhang/code/emap-reference/deck.gl-geoarrow
```

命令应串行执行。脚本使用独立 loopback 4194 服务，结束后关闭，不停止或重启用户的 4187 服务。全套 Playwright 使用独立 4193。
本轮原始 JSON、截图及摘要位于 `test-results/luma-lines-continued/`；之前阶段的结果保留在 `test-results/luma-line-optimization/`。前者才对应本报告的最终候选。
当前路径着色器 SHA-256：`f26635bb7e65cee42f274dc0833dce676d88580b3f7158a870d0b107d83744e0`。

实现：`src/integrations/luma/path-shaders.ts`、`path-pipeline.ts`、`gpu-renderer.ts`；参考：本地 GeoArrow `layers/path-layer.ts` 和 deck.gl PathLayer 官方文档。
本轮保留在本地 luma集成 工作区，未提交、未推送、未发布；没有切换默认 emap 渲染器。

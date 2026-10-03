# GeoArrow 参考下的全精度点渲染优化

## 点绘制能力与参考来源

本阶段为独立 luma 示例提供全精度圆点绘制优化，沿用原始 mapshaper dataset、路径和面几何算法。该阶段的正式入口使用 Canvas preset。
参考本地 `deck.gl-geoarrow` 提交 `b3b93c3821d26a386a5ed44f74ec184ad1d14b0d`，其包源码版本 0.4.2，
底层安装的 deck.gl 9.3.0；emap 保持 luma 10.0.0-alpha.1。没有把参考库的旧 luma 加进生产依赖。

官方 README 展示 320 万点，但未给出该演示的完整硬件、样式、视口和 FPS 测量矩阵。
本轮没有把 README 演示当作等价基准，而是使用用户完整 `points.geojson` 与 `pppp.geojson`。

来源：
- https://github.com/geoarrow/deck.gl-geoarrow
- 本地 `packages/deck.gl-geoarrow/src/layers/scatterplot-layer.ts`
- 本地 deck.gl 9.3.0 的 `scatterplot-layer.ts`、`scatterplot-layer-vertex.glsl.ts`、`scatterplot-layer-fragment.glsl.ts`

## 实现

直接借鉴的是连续二进制实例数据、四顶点 triangle-strip、紧凑圆形包围区域与解析抗锯齿。
XY 高低位坐标 Buffer 保留，视图变化不重建原始点 Buffer。没有抽稀、合并点、坐标吸附、减小半径或降低 DPR。
普通实心圆不再走任意标记形状的通用片元计算；空心圆和其他符号保留原有路径。

emap 另外实现同色不透明覆盖优化：
连续同色、样式 alpha 恰好为 1 的圆点跨分块排成一个 run，先画所有完全覆盖样本，再画分数覆盖边缘。
两遍都保留全部实例。覆盖度不足 1 从不取整为 1；分数边缘仍按 source-over 混合。
不同颜色、半透明要素、线面图元、栅格、空心符号都打断 run，保持原有绘制顺序。
小圆点避免额外的 core pass。标准模式用同一圆形着色器，关闭覆盖优化。

以同色同不透明度 run 而言，任一样本只要被 alpha=1 覆盖，其他同色点就不能改变它的最终结果；
因此用私有深度附件跳过这些样本的后续混合，不需要改变几何。
WebGL2 与 WebGPU 共用该逻辑。深度重置不写颜色，且绕过 luma v10 WebGL 中
`depthCompare: always` 会关闭深度测试、不能实际写深度的行为。所有普通图元忽略该覆盖深度。

## 测量条件与结论边界

Apple M4、16 GiB、Headless Chrome 153，CSS 绘图区 1238×450、DPR 1.25。
固定视图各预热 6 帧、采样 30 帧；远景为完整范围视图的 exp(-3.2)，近景为 16 倍。
全部模式保持半径 3 CSS px、alpha=1 和 4×MSAA。机器上的其他用户服务没有关闭。
rAF FPS 记录浏览器回调节奏；GPU 完成和最终呈现需独立采样。截图、像素读回与文件 SHA-256 不计入帧率。
这些固定视图数值不可与此前 ABBA 导航轨迹结果直接计算倍率。

原始版来自本次修改前本地构建快照；标准模式为新解析圆形着色器但不做覆盖优化；
GeoArrow 参考实际导入该库的点层，用相同 native dataset 坐标构造测试用 Arrow 批次，
只作固定原点平移以保留投影精度，并校验投影像素及实际 draw 提交的总实例数。
参考近景仍提交完整点表，emap 近景使用可见空间分块；全范围/远景双方都提交全部点。
因此近景 draw-call/CPU 差异按各自实际空间裁剪工作量解读。

性能使用完整真实文件。像素回归用同一真实点文件的原始坐标子集构造重叠和颜色顺序场景，
不作为吞吐测试数据。标准/自动模式覆盖 12 种组合×3 个 DPR×2 后端；以逐通道差异检查，而非仅检查有像素。
该一致性结论是相对于同一解析圆形标准路径，不表示与旧导数抗锯齿或任意浏览器逐位相同。

最大的覆盖优化收益限于同色不透明圆点；半透明、不同颜色频繁交错与其他符号需分别测量。

## 本次固定视图复测

| 原始文件 | 视图 | 旧版 WebGL2 FPS | 优化 WebGL2 FPS | 旧版 WebGPU FPS | 优化 WebGPU FPS |
|---|---|---:|---:|---:|---:|
| points.geojson | 全范围 | 46.15 | 60.00 | 19.57 | 60.01 |
| points.geojson | 远景 | 5.79 | 60.00 | 3.21 | 31.04 |
| points.geojson | 近景 | 60.00 | 60.00 | 60.00 | 60.01 |
| pppp.geojson | 全范围 | 9.00 | 60.01 | 4.07 | 32.73 |
| pppp.geojson | 远景 | 1.15 | 17.65 | 0.61 | 6.34 |
| pppp.geojson | 近景 | 60.00 | 59.99 | 60.00 | 60.00 |

同一批原始坐标、同样 3 CSS px 半径／alpha=1／4×MSAA 的 WebGL2 参考：

| 原始文件 | 视图 | 新标准圆点 FPS | 真正 GeoArrow 点层 FPS | 自动优化 FPS |
|---|---|---:|---:|---:|
| points.geojson | 全范围 | 60.01 | 60.01 | 60.00 |
| points.geojson | 远景 | 6.29 | 5.63 | 60.00 |
| pppp.geojson | 全范围 | 11.61 | 11.77 | 60.01 |
| pppp.geojson | 远景 | 1.28 | 1.18 | 17.65 |

此表来自第二轮固定视图复测，14 个完整文件/模式组合，42 组测量；第一轮均值另保存在
`first-pass-means.json`，结论方向一致。全范围和远景提交全部 250,988 / 1,660,384 个原始点。
所有最终模式有实际绘制像素、无捕获的页面/GPU 错误；原文件哈希不变，释放后几何 Buffer/Worker 为零。
GeoArrow 原生 instanced draw 的实例累计数独立核对通过，不使用空白画布或跳过重绘的 FPS。

结论：WebGL2 下 25 万点极远景约 60 FPS、166 万点全范围约 60 FPS；但 166 万点极远景仍约 17.65 FPS。
WebGPU 有改善，但同一极远景仍约 6.34 FPS，该视距仍需继续优化。
这个密集重叠条件下，GeoArrow 标准渲染也会变慢；这不否定其 README 在演示条件下显示 320 万点的能力。
最大的远景收益来自额外的同色不透明覆盖优化，四顶点和 luma 版本的独立影响需隔离测量。

## 复现

```bash
pnpm examples:build
node scripts/benchmark-luma-points.mjs --data-dir '/Users/zhang/Desktop/测试数据' --gpu webgl --frames 30 --reference-dir /Users/zhang/code/emap-reference/deck.gl-geoarrow --output test-results/geoarrow-point-optimization/webgl
node scripts/benchmark-luma-points.mjs --data-dir '/Users/zhang/Desktop/测试数据' --gpu webgpu --frames 30 --output test-results/geoarrow-point-optimization/webgpu
EMAP_BENCHMARK_DATA_DIR='/Users/zhang/Desktop/测试数据' pnpm exec playwright test --config playwright.luma.config.mjs test/browser/luma-points.spec.mjs
```

两条性能命令串行执行；脚本只监听本机 4194，完成后关闭。参考仓库只读；原始数据不修改、不上传。
可选 `--baseline-dir` 指向旧版 examples dist 快照。测试目录由 Git 忽略，逐帧样本和截图保留本地。
未提交、未推送、未发布。

## 本轮验证

相关单元／回归 47 项；浏览器 13 项完整套件，加 WebGPU 两份原始点数据的编辑回归 2 项。
其中逐像素对照为 12 种叠加场景×3 个 DPR×2 后端，共 72 组，相同标准圆形着色器下逐通道差异均为 0。
五份完整真实文件均验证选择、拖动、取消、撤销／重做、Worker 坐标更新和资源释放。
修复了全精度改造中 Worker 返回分块 ID 而渲染缓存期待分块对象的契约不一致；接口现已显式声明。
新增圆点半径控制的裁剪扩张，避免中心在视口外但大半径符号可见时被错误剔除，默认 3px 仍沿用 8px 余量。
类型、架构、测试布局、构建和文档／示例验证通过。性能产物与浏览器回归使用独立输出目录，避免回归清理历史测量。

# luma 点 LOD（目标 3 CSS 像素）

## 当前行为

两个独立 luma 示例默认启用点背景聚合，`cellSize = 3` 控制目标网格大小；圆点半径单独配置。
聚合直接复用 `src/engine/rendering/point-lod.ts` 中的 `PointLod`。
网格锚定世界坐标；按缩放选择二次幂单元。正常未触发预算回退时，屏幕单元约在目标值的一半与目标值之间。
沿用小数据（少于 10,000 个有效点）、稀疏分布、150,000 个代表点预算和近景可见候选回退策略。
预算限制时可以使用更粗的点网格，3 px 是目标网格尺寸，实际尺寸随预算调整。

每格取原始顺序中第一个点，保留 feature/component ID 和原始坐标，不计算中心点，也不显示聚合数量。
线和面仍使用完整原始几何；本轮没有修改 `PointLod` 的算法，也没有改变普通 Canvas viewer/editor 的默认配置。
原始 dataset、属性、CRS、选择查询、顶点编辑、撤销重做和导出不聚合。

## 渲染接线

`LumaPointLodSource` 在现有数据 Worker 中调用 PointLod。只在代表集首次需要上传时返回打包位置及原始 ID 副本；
不会把内部索引的 ArrayBuffer 转移并分离。`PointLodRenderCache` 在主线程管理代表点 GPU 缓存。
Canvas 和 luma 使用同一组代表点；平移或 DPR 改变不需要重新打包相同代表集。近景可恢复全量可见分块。

代表点缓存是全局、有预算的级别集合，不在每次平移时裁出一个新数组；GPU 自动裁剪屏幕外点。
因此页面显示的点数是提交数量，可能包含视口外代表点，实际亮起的像素数需通过图像采样确定。
缩放请求在途最多保留当前任务和最新待处理视图；准备新级别时暂用同数据版本的已有显示缓存。
禁用、改网格大小、编辑、换文件、上下文恢复与释放均失效相关缓存；旧异步响应不得覆盖新状态。
主线程代表点缓存有 64 MiB 估算预算和 12 个非活跃集合的淘汰条件，当前活跃/预热集合暂时保留。
该预算用于代表点缓存；浏览器总内存还包括原始 dataset、Worker、完整几何缓存、帧缓冲和驱动资源。

## 页面

`/mapseekai/emap/examples/luma-benchmark/?gpu=webgl` 或 `?gpu=webgpu`。
勾选“点网格聚合”，目标大小默认 3 CSS px；取消勾选恢复完整点数据。
圆点策略、半径、透明度仍为独立控件。顶点编辑示例也有相同的点聚合开关和网格大小。
聚合属于显示策略，会减少点密集叠加和半透明累积；图像差异取决于聚合后的覆盖和透明度。

报告 schema v4 分别记录 `pointLod.enabled`、`pointLod.cellSize` 与实际 `geometryMode`。
在近景或小/稀疏图层，开关开启但实际 `geometryMode` 仍可能为 `full`。
既有全精度性能脚本通过 `pointLod=off` 和显式配置禁用聚合，历史全精度结果不被聚合结果替换。

## 复现

```bash
cd /Users/zhang/code/emap
pnpm examples:build
node scripts/benchmark-luma-point-lod.mjs --data-dir '/Users/zhang/Desktop/测试数据' --gpu webgl --frames 30
node scripts/benchmark-luma-point-lod.mjs --data-dir '/Users/zhang/Desktop/测试数据' --gpu webgpu --frames 30
```

串行运行两个 GPU 后端；脚本只读取完整的 points.geojson 和 pppp.geojson。
脚本使用自己的 4194 loopback 预览服务，结束时关闭，不重启/关闭用户的 4187 服务。
输出位于 `test-results/luma-point-lod/<backend>/`，包括输入哈希、逐帧 JSON、截图和释放检查。

## 2026-09-20 实测

Apple M4 / 16 GiB / Headless Chrome 153，CSS 绘图区 1238 × 450，DPR 1.25。
完整导入用户的两个真实点文件；每个视距按 Canvas → GPU → GPU → Canvas 导航，
每轮预热 12 帧、采样 30 帧；每个渲染器合计 60 帧。
远景为 fit 的 exp(-3.2)，近景为 fit 的 16 倍。表中点数为起始视图提交数，导航时随级别变化。

| 数据 | 原始点数 | 视图 | 起始提交点数 | WebGL2 FPS | WebGPU FPS |
|---|---:|---|---:|---:|---:|
| points.geojson | 250,988 | 全范围 | 7,007 | 60.00 | 59.99 |
| points.geojson | 250,988 | 极远景 | 103 | 60.00 | 60.00 |
| points.geojson | 250,988 | 近景 | 17,253 | 60.01 | 60.01 |
| pppp.geojson | 1,660,384 | 全范围 | 40,964 | 60.00 | 60.00 |
| pppp.geojson | 1,660,384 | 极远景 | 180 | 60.01 | 60.01 |
| pppp.geojson | 1,660,384 | 近景 | 26,076 | 60.00 | 60.01 |

近景两份文件均按现有策略恢复全量可见分块，帧率对应这些可见分块的实际提交量。
所有暖导航新增几何上传为 0。关闭聚合后，两份文件在全范围恢复全部原始点数，
聚合缓存释放；原始文件 SHA-256 未改变，场景释放后 GPU 几何 Buffer 和数据 Worker 数归零。

相关单元/回归 74 项通过；浏览器功能用例 19 项通过（17 项完整套件和两项 WebGPU 原始点编辑），
最后的快速滚轮、网格变更、禁用/启用和聚合未完成时释放额外复跑四项，通过。
类型/公共契约、生产构建、架构、测试布局和 docs:verify 通过。
数据测试不包含跨操作系统、其他浏览器或全部默认编辑器能力的验收。未提交、未推送、未发布。

---
id: performance
slug: /recipes/performance
title: 性能
api: ["Emap", "MapOptions", "SimplifyOptions"]
examples: ["simplify", "simplify-control", "web-worker", "point-lod"]
stability: stable
verifiedVersion: 0.9.1
---

# 性能

性能工作集中在三处：将大型数据操作路由到 Worker、简化不需要的几何细节，以及减少视口外要素的渲染工作。

## 为大型数据操作启用 Worker

```ts
const map = new Emap({
  container: "map",
  useWorker: "auto",
  workerThreshold: 50_000,
})
```

`useWorker: "auto"` 会在数据集的弧顶点数达到 `workerThreshold` 时，把数据集替换操作路由到 Worker；较小的数据集保留在主线程以避免通信开销。`useWorker: true` 将所有这类操作路由到 Worker。Worker 路由处理数据操作，Canvas 绘制仍在主线程进行。

## 简化和视口裁剪

对线和面执行 `map.ops.simplifyLayer()` 可减少后续渲染和操作处理的顶点数量。选择满足可读性要求的最低细节，并在数据导入后或独立的用户操作中执行简化。

Emap 为大图层建立空间索引，并在局部视图中只遍历视口候选要素。为图层设置 `layout.visibility: "none"` 可跳过不需要显示的图层。全图范围内，空间索引本身不能降量；密集点还可使用下面的自动 LOD。

## 密集点自动 LOD

大数据 `circle` 图层默认按密度抽稀。每个网格保留原始 feature/component ID 最小的真实点，坐标和属性不变；Point 和 MultiPoint 都支持。显示过滤先于代表点选择，样式继续按原始要素属性解析。

```ts
map.addLayer({
  id: 'points', type: 'circle', source: 'points',
  pointLod: { cellSize: 8 }, // 可省略；1–64 CSS 像素
  paint: { 'circle-radius': 3 },
});
// 在 addLayer 中设置 pointLod: false 可关闭抽稀。
```

网格锚定数据原点，使用二进制嵌套尺度，平移和 DPR 不改变分格。正常尺度下网格边长处于指定 CSS 大小的一半到一倍之间。放大逐步恢复细节；相邻格的点仍可能重叠，这不是严格避让，也不会生成聚合气泡。

过滤后的有效点不足 10,000 个，或降量不足 10% 时，保留原绘制路径。每个渲染图层缓存最多三个尺度；暖平移只查代表点的 Flatbush 索引，不重新扫描全部原始点。同一查询复用结果，全范围查询直接复用已排序 ID 数组。编辑版本、属性版本、数据/图层/形状身份、数量、过滤掩码、CRS、网格配置或视口预算变化后重建。

构建预算按完整 CSS 视口可容纳的网格数计算，与指针的小查询框无关，并以 64 MiB / 80 字节的代表点数量预算封顶。这个值是内存规划额度，不是 JavaScript 堆用量保证。超过预算时保留较粗的抽稀尺度；若单点图层完整视口的原始空间候选足够少，则使用原候选绘制路径。因此普通 1080p/4K 密集视图不会因越过固定十万点上限突然绘制全部点。超大数据范围或极小 cellSize 可能保持较粗细节；首次构建仍在主线程，超预算时可能尝试多个较粗尺度。

点击/悬停只拾取已绘制的代表点，并包含选中、高亮叠加点。CSS 快速导航期间继续拾取上一帧实际绘制的代表点，直到重绘。框选、套索、属性表、统计、分析、导出和 `.msx` 源数据快照仍使用原始数据（沿用已有显示过滤语义）；隐藏的 MultiPoint 分量不会仅因同要素的另一个分量可见就被点击命中。图层配置的读取快照独立克隆 `pointLod`；`.msx` 不保存渲染配置。

运行可重复的算法基准：

```bash
node --expose-gc --max-old-space-size=8192 scripts/benchmark-point-lod.mjs
```

基准使用固定种子，覆盖 10 万、100 万、500 万点的均匀和聚集分布，分别报告首次构建（含首次查询）的三次中位数、50 次暖平移查询的中位数/P95、输入及输出点数。数据生成不计时；Node 算法耗时不是浏览器 FPS，Canvas 绘制、导入、样式解析和原始空间索引的成本不在其中。

## API

- `Emap`
- `MapOptions`
- `SimplifyOptions`

## 可运行示例

- [Web Worker](/mapseekai/emap/examples/web-worker/)
- [简化控件](/mapseekai/emap/examples/simplify-control/)
- [几何简化](/mapseekai/emap/examples/simplify/)
- [密集点 LOD / Dense point LOD](/mapseekai/emap/examples/point-lod/)

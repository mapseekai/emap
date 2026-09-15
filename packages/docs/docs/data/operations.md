---
id: operations
slug: /data/operations
title: 数据操作
api: ["AffineLayerOptions", "ApplyExpressionOptions", "BufferOptions", "CheckGeometryOptions", "CleanOptions", "ClipEraseOptions", "DataFillOptions", "DissolveOptions", "DivideOptions", "DragSessionOptions", "DropLayerOptions", "Emap", "ExplodeOptions", "ExportSnapshotOptions", "ExpressionEvaluationPolicy", "FeatureAffineSession", "FeatureRef", "FeatureTranslateSession", "FilterFieldsOptions", "FilterGeomOptions", "FilterIslandsOptions", "FilterOptions", "FilterSliversOptions", "GeometryCheckReport", "HighlightStyle", "InnerlinesOptions", "IntersectionPointsLayerOptions", "JoinTableData", "JoinTableOptions", "LinesOptions", "LoadSnapshotOptions", "MapOptions", "MergeLayersOptions", "MosaicOptions", "PointsMode", "PointsOptions", "PolygonsOptions", "ProjectLayerExport", "ProjectLayerOutputOptions", "ProjectOptions", "QueriedFeature", "QueryFeaturesOptions", "RebuildTopologyOptions", "RenameFieldsOptions", "RenameLayerOptions", "SimplifyMethod", "SimplifyOptions", "SnapOptions", "SortFeaturesOptions", "SplitCutter", "SplitFeatureHandler", "SplitFeatureOptions", "SplitLayerOptions", "SplitSelectedOptions", "SplitSelectedResult", "UnionOptions", "UniqueFeaturesOptions", "OpResult", "OpError", "ClassifyFeaturesOptions"]
examples: ["buffer","clip-erase","dissolve","filter-features","merge-selected","simplify","split-features","union"]
stability: stable
verifiedVersion: unreleased
---

# 数据操作

`map.ops` 是 Emap 的 mapshaper 数据处理接口。每个方法解析 source 和 layer、运行操作、更新历史和选择，并返回 `Promise<OpResult>`。

## 调用和错误处理

操作使用类型化 options；`source` 是 source ID，`target` 是 source layer 名称或目标表达式。支持输出 layer 的操作还可接受 `name` 或 `noReplace`，具体以对应 options 类型为准。

```ts
const result = await map.ops.bufferLayer({
  source: 'main',
  target: 'roads',
  radius: 250,
});

if (!result.ok) {
  console.error(result.error);
}
```

`BufferOptions` 使用 `radius`，单位来自 dataset CRS。成功结果在 `result.value` 中；失败结果是按 `kind` 区分的 `OpError`。

```ts
const result = await map.ops.checkGeometry({ source: 'main' });
if (!result.ok && result.error.kind === 'validation') {
  console.error(result.error.field, result.error.reason);
}
```

需要取消长时间操作时，用 `withSignal` 把整组操作绑定到一个 `AbortSignal`。它返回同样的 `map.ops` 接口；信号中止后，新的调用被拒绝，进行中的执行和结果提交也会被取消：

```ts
const controller = new AbortController();
const ops = map.ops.withSignal(controller.signal);
cancelButton.addEventListener('click', () => controller.abort(), { once: true });
const result = await ops.simplifyLayer({ source: 'main', percentage: 0.25 });
```

## `map.ops` 方法目录

| 类别 | 方法 |
| --- | --- |
| Overlay、拓扑和几何 | `clipLayer`、`eraseLayer`、`dissolveLayer`、`bufferLayer`、`simplifyLayer`、`projectLayer`、`affineLayer`、`cleanLayer`、`snapLayer`、`mosaicLayer`、`unionLayers`、`divideLayer` |
| 要素几何 | `filterIslands`、`filterSlivers`、`filterGeom`、`explodeLayer`、`innerlinesLayer`、`pointsLayer`、`linesLayer`、`polygonsLayer`、`intersectionPointsLayer` |
| Layer 管理 | `renameLayer`、`mergeLayers`、`splitLayer`、`dropLayer` |
| 属性与筛选 | `applyExpression`、`filterFeatures`、`sortFeatures`、`uniqueFeatures`、`filterFields`、`renameFields`、`classifyFeatures`、`joinTable`、`dataFill` |
| 拓扑检查 | `rebuildTopology`、`checkGeometry` |
| 选择与编辑 | `mergeSelected`、`splitSelected`、`reshapeSelected`、`autoCompletePolygon`、`addRing`、`deleteRing`、`fillRing`、`addPart`、`deletePart` |

## 常用操作

```ts
await map.ops.simplifyLayer({
  source: 'main',
  target: 'districts',
  percentage: 0.25,
  keepShapes: true,
});

await map.ops.clipLayer({
  source: 'main',
  target: 'parcels',
  mask: 'boundary',
});

await map.ops.eraseLayer({
  source: 'main',
  target: 'parcels',
  mask: 'restricted',
});

await map.ops.dissolveLayer({
  source: 'main',
  target: 'districts',
  field: 'province',
});
```

`projectLayer()` 创建独立的导出文件，不修改 map。使用返回的 `blob` 和 `filename` 下载结果；使用 `map.reproject()` 改变整个地图的坐标系。

```ts
const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
  output: { format: 'geojson', filename: 'districts-3857.geojson' },
});
```

表达式、`where` 和 `calc` 受 map 的 `expressionPolicy` 控制。`joinTable()` 使用 `keys` 和 `data` 连接外部表；`classifyFeatures()` 返回分类结果。

## 选择操作和历史

`mergeSelected()`、`splitSelected()`、`reshapeSelected()` 和 ring/part 方法作用于 Emap 的选中要素。`splitSelected()` 的选择必须来自同一 source 和 layer：点切刀可切线，折线切刀可切线或面。一次成功操作写入一个历史项。

通过 `map.beginTransaction()` 将多个操作组合为一次撤销：

```ts
const tx = map.beginTransaction();
const simplified = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.4,
});

if (simplified.ok) {
  await tx.commit('Simplify data');
} else {
  tx.rollback();
}
```

改变要素数量的操作会清理或重映射选择；属性和坐标系操作在可能时保留要素身份。通过 `map.ops` 运行处理，避免绕过历史、缓存和选择同步。

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [OpResult](/mapseekai/emap/api/types/emap.OpResult.html)
- [OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [BufferOptions](/mapseekai/emap/api/interfaces/emap.BufferOptions.html)
- [SimplifyOptions](/mapseekai/emap/api/interfaces/emap.SimplifyOptions.html)
- [ProjectOptions](/mapseekai/emap/api/interfaces/emap.ProjectOptions.html)
- [ClassifyFeaturesOptions](/mapseekai/emap/api/interfaces/emap.ClassifyFeaturesOptions.html)

## 可运行示例

- [Buffer](/mapseekai/emap/examples/buffer/)
- [Clip / erase](/mapseekai/emap/examples/clip-erase/)
- [Dissolve](/mapseekai/emap/examples/dissolve/)
- [筛选要素](/mapseekai/emap/examples/filter-features/)
- [合并选中要素](/mapseekai/emap/examples/merge-selected/)
- [简化](/mapseekai/emap/examples/simplify/)
- [拆分要素](/mapseekai/emap/examples/split-features/)
- [Union](/mapseekai/emap/examples/union/)

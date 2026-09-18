---
id: operations
slug: /data/operations
title: 数据操作
api: ["AffineLayerOptions", "ApplyExpressionOptions", "BufferOptions", "CheckGeometryOptions", "CleanOptions", "ClipEraseOptions", "DataFillOptions", "DissolveOptions", "DivideOptions", "DragSessionOptions", "DropLayerOptions", "Emap", "ExplodeOptions", "ExportSnapshotOptions", "ExpressionEvaluationPolicy", "FeatureAffineSession", "FeatureRef", "FeatureTranslateSession", "FilterFieldsOptions", "FilterGeomOptions", "FilterIslandsOptions", "FilterOptions", "FilterSliversOptions", "GeometryCheckReport", "HighlightStyle", "InnerlinesOptions", "IntersectionPointsLayerOptions", "JoinTableData", "JoinTableOptions", "LinesOptions", "LoadSnapshotOptions", "MapOptions", "MergeLayersOptions", "MosaicOptions", "PointsMode", "PointsOptions", "PolygonsOptions", "ProjectLayerExport", "ProjectLayerOutputOptions", "ProjectOptions", "QueriedFeature", "QueryFeaturesOptions", "RebuildTopologyOptions", "RenameFieldsOptions", "RenameLayerOptions", "SimplifyMethod", "SimplifyOptions", "SnapOptions", "SortFeaturesOptions", "SplitCutter", "SplitFeatureHandler", "SplitFeatureOptions", "SplitLayerOptions", "SplitSelectedOptions", "SplitSelectedResult", "UnionOptions", "UniqueFeaturesOptions", "OpResult", "OpError", "ClassifyFeaturesOptions"]
examples: ["buffer","clip-erase","dissolve","filter-features","merge-selected","simplify","split-features","union"]
stability: stable
verifiedVersion: 0.13.0
---

# 数据操作

`map.ops` 是 Emap 的 mapshaper 数据处理接口，返回 `Promise<OpResult>`。

```ts
const result = await map.ops.bufferLayer({
  // 对 roads 图层创建 250 单位缓冲区
  source: 'main',
  target: 'roads',
  radius: 250,
});
if (!result.ok) console.error(result.error); // 处理操作错误
```

## 核心方法

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `bufferLayer(options)` | `BufferOptions` | 对要素创建缓冲区。 |
| `simplifyLayer(options)` | `SimplifyOptions` | 简化几何。 |
| `clipLayer(options)` / `eraseLayer(options)` | `ClipEraseOptions` | 裁剪或擦除图层。 |
| `dissolveLayer(options)` | `DissolveOptions` | 按字段合并几何。 |

## 更多调用和错误处理

操作成功为 `{ ok: true, value }`，失败为 `{ ok: false, error }`。`checkGeometry()`、`classifyFeatures()`、`projectLayer()` 返回产物；`error.kind` 为 `not-found`、`validation`、`expression-disabled`、`mapshaper`、`stale-operation` 或 `host-removed`。

表达式需要 `expressionPolicy: 'trusted'`。`withSignal(signal)` 创建可取消操作作用域。

```ts
const controller = new AbortController();
const ops = map.ops.withSignal(controller.signal);
cancelButton.addEventListener('click', () => controller.abort(), { once: true });
const result = await ops.simplifyLayer({ source: 'main', percentage: 25 });
```

## 更多操作

| 类别 | 方法 |
| --- | --- |
| Overlay、拓扑和几何 | `clipLayer`、`eraseLayer`、`dissolveLayer`、`bufferLayer`、`simplifyLayer`、`projectLayer`、`affineLayer`、`cleanLayer`、`snapLayer`、`mosaicLayer`、`unionLayers`、`divideLayer` |
| 要素几何 | `filterIslands`、`filterSlivers`、`filterGeom`、`explodeLayer`、`innerlinesLayer`、`pointsLayer`、`linesLayer`、`polygonsLayer`、`intersectionPointsLayer` |
| Layer 管理 | `renameLayer`、`mergeLayers`、`splitLayer`、`dropLayer` |
| 属性与筛选 | `applyExpression`、`filterFeatures`、`sortFeatures`、`uniqueFeatures`、`filterFields`、`renameFields`、`classifyFeatures`、`joinTable`、`dataFill` |
| 拓扑检查 | `rebuildTopology`、`checkGeometry` |
| 选择与编辑 | `mergeSelected`、`splitSelected`、`reshapeSelected`、`autoCompletePolygon`、`addRing`、`deleteRing`、`fillRing`、`addPart`、`deletePart` |

### 操作参数

#### Layer 定位和输出

除非另有说明，Layer 操作使用以下定位参数；`name`、`noReplace` 仅用于列出的方法。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | 必填 | 数据集 source ID。 |
| `target` | `string` | 必填 | 目标 Layer 名或 ID。 |
| `targets` | `string[]` | 必填 | `mergeLayers`、`unionLayers` 的输入 Layer。 |
| `name` | `string` | 未设置 | 输出 Layer 名。 |
| `noReplace` | `boolean` | `false` | 保留输入 Layer。 |

#### Overlay、拓扑和变换

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `clipLayer` / `eraseLayer`：`mask` | `string` | 二选一 | 同 source 多边形裁剪 Layer。 |
| `clipLayer` / `eraseLayer`：`bbox` | `[number, number, number, number]` | 二选一 | 源坐标矩形；与 `mask` 互斥。 |
| `clipLayer` / `eraseLayer`：`cleanup`、`removeSlivers` | `boolean` | `false` | 修复裁剪后的环和细碎面。 |
| `dissolveLayer`：`field` / `fields` | `string` / `string[]` | 未设置 | 分组键；未设置合并全层，二者互斥。 |
| `dissolveLayer`：`sumFields`、`copyFields` | `string[]` | 未设置 | 分组求和或复制字段。 |
| `dissolveLayer`：`calc`、`where` | `string` | 未设置 | 聚合计算或预筛选。 |
| `dissolveLayer`：`multipart` | `boolean` | `false` | 输出多部件要素。 |
| `bufferLayer`：`radius` | `number \| string` | 必填 | 正有限距离或逐要素表达式。 |
| `bufferLayer`：`capStyle`、`type` | `'flat' \| 'round'` / `'left' \| 'right' \| 'outer' \| 'inner'` | `'round'` / 未设置 | 线端样式和单侧方向。 |
| `bufferLayer`：`vertices`、`arcQuality`、`tolerance` | `number` | 未设置 | 圆顶点、圆角段数、曲线误差。 |
| `bufferLayer`：`planar`、`v2`、`sliceLength`、`backtrack` | `boolean` / `number` | `false` / 未设置 | 平面、v2、路径切片参数。 |
| `simplifyLayer`：`target` | `string` | 未设置 | 省略处理全部共享弧。 |
| `simplifyLayer`：`percentage` | `number` | 三选一 | 保留的可移除顶点百分比 `[0, 100]`。 |
| `simplifyLayer`：`interval` / `resolution` | `number` / `string` | 三选一 | CRS 距离阈值或网格；与 `percentage` 互斥。 |
| `simplifyLayer`：`method`、`weighting` | `'dp' \| 'visvalingam' \| 'weighted'` / `number` | `'weighted'` / `0.7` | 简化算法及系数。 |
| `simplifyLayer`：`planar`、`keepShapes`、`lockBox`、`noRepair` | `boolean` | `false` | 平面、小面、外框锁定、拓扑修复控制。 |
| `projectLayer`：`target`、`crs` | `string` | 必填 | 导出 Layer 和目标 CRS。 |
| `projectLayer`：`init`、`densify` | `string` / `boolean` | 未设置 / `false` | 源 CRS 覆盖和长线段加密。 |
| `projectLayer`：`output` | `{ format?: ExportFormat; filename?: string }` | 未设置（`format: 'geojson'`） | 导出格式和文件名。 |
| `affineLayer`：`target`、`shift`、`rotate` | `string` / `[number, number]` / `number` | 未设置 | Layer、平移、逆时针角度。 |
| `affineLayer`：`scale`、`anchor`、`where` | `number \| [number, number]` / `[number, number]` / `string` | 未设置 / bbox 中心 / 未设置 | 缩放、锚点、筛选。 |
| `cleanLayer`：`gapFillArea`、`sliverControl`、`snapInterval` | `number` | 未设置 | 填孔、细片、预吸附参数。 |
| `cleanLayer`：`noSnap`、`allowOverlaps`、`allowEmpty`、`rewind`、`onlyArcs`、`noArcDissolve` | `boolean` | `false` | 吸附、重叠、空几何、环和范围控制。 |
| `cleanLayer`：`overlapRule` | `'min-id' \| 'max-id' \| 'min-area' \| 'max-area'` | 未设置 | 重叠属性来源。 |
| `snapLayer`：`interval`、`precision`、`endpoints`、`fixGeometry` | `number` / `boolean` | 自动 / 未设置 / `false` / `false` | 吸附距离、精度、端点和修复。 |
| `mosaicLayer`：`snapInterval`、`noSnap`、`calc` | `number` / `boolean` / `string` | 未设置 / `false` / 未设置 | 吸附和聚合。 |
| `unionLayers`：`fields` | `string[]` | 未设置 | 输出属性字段。 |
| `divideLayer`：`divider`、`fields`、`force` | `string` / `string[]` / `boolean` | 必填 / 全部 / `false` | 多边形切分线并复制字段。 |

#### 要素几何

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `filterIslands`：`minArea`、`minVertices`、`removeEmpty` | `number` / `boolean` | 至少一项必填 / `false` | 移除小面或空要素。 |
| `filterSlivers`：`minArea`、`weighted` | `number` / `boolean` | 必填 / `false` | 细碎面阈值和加权度量。 |
| `filterGeom`：`bbox` | `[number, number, number, number]` | 必填 | 保留与矩形相交的要素。 |
| `explodeLayer` | — | — | 拆分多部件要素。 |
| `innerlinesLayer`：`where` | `string` | 未设置 | 相邻面上下文筛选。 |
| `pointsLayer`：`type`、`interval` | `'centroid' \| 'inner' \| 'vertices' \| 'endpoints' \| 'midpoints' \| 'interpolated'` / `number` | 必填 / 未设置 | 点提取模式和间隔。 |
| `linesLayer`：`fields` | `string[]` | 未设置 | 面边界分级字段。 |
| `polygonsLayer`：`gapTolerance`、`fromRings` | `number` / `boolean` | 自动 / `false` | 吸附容差和闭合环路径。 |
| `intersectionPointsLayer`：`tolerance` | `number` | 自动 | 正源单位交点容差。 |

#### Layer、属性和拓扑

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `renameLayer`：`name` | `string` | 必填 | 非空不冲突的 Layer 名。 |
| `mergeLayers`：`targets`、`name`、`force`、`flatten` | `string[]` / `string` / `boolean` | 至少两个 / 未设置 / `false` / `false` | 合并 Layer；可强制或马赛克。 |
| `splitLayer`：`expression`、`noReplace` | `string` / `boolean` | 必填 / `false` | 按字段或表达式分层。 |
| `dropLayer` | — | — | 删除目标 Layer。 |
| `applyExpression`：`expression`、`where` | `string` | 必填 / 未设置 | 属性更新和筛选。 |
| `filterFeatures`：`expression`、`invert`、`removeEmpty` | `string` / `boolean` | 未设置 / `false` / `false` | 谓词筛选、反转、移除空几何。 |
| `sortFeatures`：`expression`、`descending` | `string` / `boolean` | 必填 / `false` | 原地排序。 |
| `uniqueFeatures`：`expression`、`maxCount`、`invert` | `string` / `number` / `boolean` | 必填 / `1` / `false` | 去重和每键保留数。 |
| `filterFields`：`fields`、`invert` | `string[]` / `boolean` | 必填 / `false` | 保留字段；`['*']` 移除全部。 |
| `renameFields`：`mapping` | `Record<string, string>` | 必填 | `旧字段 -> 新字段` 映射。 |
| `classifyFeatures`：`field`、`method`、`classes`、`colors` | `string` / `'quantile' \| 'equal-interval' \| 'nice' \| 'categorical'` / `number` / `string[]` | 必填 / 必填 / `4` / 必填 | 字段分级颜色。 |
| `classifyFeatures`：`breaks`、`categories`、`saveAs`、`nullValue`、`otherColor`、`invert` | `number[]` / `(string \| number)[]` / `string` / `string` / `string` / `boolean` | 未设置 / 出现顺序的去重值 / `'fill'` / 主题 muted / `nullValue` / `false` | 断点、类别、输出、颜色和反转。 |
| `joinTable`：`data`、`keys` | `JoinTableData` / `[string, string]` | 必填 | 外部数据和键对。 |
| `joinTable`：`fields`、`prefix`、`where`、`calc`、`unjoined`、`unmatched` | `string[]` / `string` / `string` / `string` / `boolean` | 除 source key 外全部 / 未设置 / 未设置 / 未设置 / `false` / `false` | 字段、前缀、筛选、汇总和未匹配控制。 |
| `dataFill`：`field`、`weightField`、`contiguous` | `string` / `string` / `boolean` | 必填 / 未设置 / `false` | 以相邻面回填属性。 |
| `rebuildTopology`：`source`、`snapInterval`、`noSnap`、`rebuildTopology` | `string` / `number` / `boolean` | 必填 / 自动 / `false` / `false` | 重建共享弧。 |
| `checkGeometry`：`source`、`tolerance` | `string` / `number` | 必填 / 自动 | 只读几何检查。 |

#### 选择和编辑

选择与编辑方法使用当前选择或几何命中，无需 `source`、`target`；成功写入一条历史项。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `mergeSelected`：`attributeSource` | `FeatureRef` | 选择中首要素 | 输出属性来源。 |
| `splitSelected`：`cutter` | `{ type: 'point'; coordinates: [number, number] } \| { type: 'polyline'; coordinates: [number, number][] }` | 必填 | 点或折线切刀。 |
| `reshapeSelected` / `autoCompletePolygon`：`line` | `[number, number][]` | 必填 | 替换路径或围面草图。 |
| `addRing`：`ring` | `[number, number][]` | 必填 | 闭合内环坐标。 |
| `deleteRing` / `fillRing`：`point` | `[number, number]` | 必填 | 内环命中点。 |
| `addPart`：`coordinates` | `[number, number][]` | 必填 | 独立路径部件。 |
| `deletePart`：`point`、`tolerance` | `[number, number]` / `number` | 必填 / 未设置 | 命中点和容差。 |

### Worker 路由

`Emap.create()` 的 `useWorker` 选择数据集替换操作的位置：`false`（默认）主线程，`true` Worker，`'auto'` 在顶点数达到 `workerThreshold`（默认 `50000`）时路由 Worker。`workerUrl` 默认 `'emap-worker.js'`，`workerPoolSize` 默认 `1`；选择级编辑保持主线程。

## 更多常用操作

```ts
await map.ops.simplifyLayer({
  source: 'main',
  target: 'districts',
  percentage: 25,
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

`projectLayer()` 返回独立导出文件；`map.reproject()` 改变地图 CRS。

```ts
const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
  output: { format: 'geojson', filename: 'districts-3857.geojson' },
});
```

## 更多选择操作和历史

`map.beginTransaction()` 将操作组合为一次撤销：

```ts
const tx = map.beginTransaction();
const simplified = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 40,
});

if (simplified.ok) {
  await tx.commit('Simplify data');
} else {
  tx.rollback();
}
```

改变要素数的操作清理或重映射选择；属性和 CRS 操作尽量保留要素身份。

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

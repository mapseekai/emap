---
id: operations
slug: /data/operations
title: 数据操作
api: ["AffineLayerOptions","ApplyExpressionOptions","BufferOptions","CheckGeometryOptions","CleanOptions","ClipEraseOptions","DataFillOptions","DissolveOptions","DivideOptions","DragSessionOptions","DropLayerOptions","Emap","ExplodeOptions","ExportSnapshotOptions","ExpressionEvaluationPolicy","FeatureAffineSession","FeatureRef","FeatureTranslateSession","FilterFieldsOptions","FilterGeomOptions","FilterIslandsOptions","FilterOptions","FilterSliversOptions","GeometryCheckReport","HighlightFeatureRef","HighlightStyle","InnerlinesOptions","IntersectionPointsLayerOptions","JoinTableData","JoinTableOptions","LinesOptions","LoadSnapshotOptions","MapOptions","MergeLayersOptions","MosaicOptions","PointsMode","PointsOptions","PolygonsOptions","ProjectLayerExport","ProjectLayerOutputOptions","ProjectOptions","QueriedFeature","QueryFeaturesOptions","RebuildTopologyOptions","RenameFieldsOptions","RenameLayerOptions","SimplifyMethod","SimplifyOptions","SnapOptions","SortFeaturesOptions","SplitCutter","SplitFeatureHandler","SplitFeatureOptions","SplitLayerOptions","SplitSelectedOptions","SplitSelectedResult","UnionOptions","UniqueFeaturesOptions"]
examples: ["buffer","check-geometry","clip-erase","data-engineering","dissolve","divide","duckdb-overlay","duckdb-spatial-aggregate-join","explode","filter-features","innerlines","merge-layers","merge-selected","mosaic","project","rebuild-topology","rename-layer","simplify","simplify-control","snap-layer","split-features","split-layer","union"]
stability: stable
verifiedVersion: 0.5.0
---

# 数据操作

`map.ops` 把 mapshaper 数据处理封装成类型化 operation。它负责解析 source/layer、
执行命令、记录历史、更新选择和缓存，并把失败表示为 `OpResult`。

## 调用模型

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

`BufferOptions` 使用 `radius`，不是 `distance`。距离单位来自 dataset CRS。

多数 option 共享：

| 字段 | 含义 |
|---|---|
| `source` | 地图 source ID |
| `target` | source layer 名称或目标表达式 |
| `name` | 新输出 layer 名称，部分 operation 支持 |
| `noReplace` | 保留输入并创建输出，部分 operation 支持 |

以各接口的 API reference 为准；不同 operation 不会接受一套完全相同的字段。

## OpResult

```ts
const result = await map.ops.checkGeometry({
  source: 'main',
});

if (result.ok) {
  console.log(result.value);
} else {
  switch (result.error.kind) {
    case 'not-found':
      console.error(result.error.what, result.error.id);
      break;
    case 'validation':
      console.error(result.error.field, result.error.reason);
      break;
    default:
      console.error(result.error);
  }
}
```

`OpError` 是判别联合，不保证存在通用 `message` 字段。应先按 `kind` 收窄。

## 常用几何操作

### 简化

```ts
await map.ops.simplifyLayer({
  source: 'main',
  target: 'districts',
  percentage: 0.25,
  keepShapes: true,
});
```

### 裁剪与擦除

```ts
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
```

### 融合

```ts
await map.ops.dissolveLayer({
  source: 'main',
  target: 'districts',
  field: 'province',
});
```

### 投影并导出

```ts
const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
  output: { format: 'geojson', filename: 'districts-3857.geojson' },
});
```

`projectLayer` 返回 detached 文件 Blob，不修改或重新加载当前地图。应用负责用
`result.value.blob` 和 `result.value.filename` 触发下载；整图 CRS 变化使用
`map.reproject()`。

## 属性和 layer 操作

```ts
await map.ops.renameLayer({
  source: 'main',
  target: 'old_name',
  name: 'new_name',
});

await map.ops.filterFields({
  source: 'main',
  target: 'districts',
  fields: ['name', 'code'],
});
```

涉及 expression、`where` 或 `calc` 的 operation 受 expression policy 控制。

## 拆分选中要素

先用 `map.select()` 选择同一 source、同一 layer 中的线或面要素，再提供坐标切刀：

```ts
map.select([{ source: 'main', layer: 'roads', id: 4 }]);
const result = await map.ops.splitSelected({
  cutter: { type: 'point', coordinates: [121.5, 31.2] },
});

map.splitFeature.setOptions({ cutterType: 'polyline' });
map.splitFeature.enable();
```

线要素可使用落在内部的点切刀或折线切刀；面要素只能使用折线切刀。交互绘制折线切刀时，右键完成切线。
选择必须来自同一 source 和 layer。成功后，面积或长度最大的结果保留原 feature ID，
其余结果追加为新要素；每个结果都复制原有属性。结果选择会替换为最终拆分结果，
整次拆分作为一个原子历史步骤，可用一次撤销恢复。

## Operation effect

每个 operation 都有一类效果：

| 效果 | 示例影响 | 选择策略 |
|---|---|---|
| `shape-count` | 新增、删除或拆分 shape | feature ID 可能变化 |
| `topology-only` | 坐标或 arc 改变 | 可保留 shape 引用时保留 |
| `attribute-only` | record/field 改变 | 通常保留选择 |
| `crs-only` | 坐标系变化 | 保留 feature identity，重建空间索引 |

这个分类由 engine 维护。不要直接调用 mapshaper 或修改 dataset 来绕过 runner。

## 历史与事务

单个成功 operation 进入历史。多个步骤作为一次撤销：

```ts
const tx = map.beginTransaction();
const simplified = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.4,
});

if (!simplified.ok) {
  tx.rollback();
} else {
  const committed = await tx.commit('简化数据');
  if (!committed.ok) console.error(committed.error);
}
```

事务不支持嵌套。失败后立即回滚，不要提交部分结果。

## Worker 路由

dataset-replace operation 可以通过 `useWorker: 'auto'` 离开主线程。调用方式和
`OpResult` 不变。属性和小型选择编辑通常留在主线程。

## 常见问题

### option 名称来自 mapshaper CLI

Emap 暴露 TypeScript option，不接受任意 CLI 字符串。检查具体接口，例如 buffer
使用 `radius`，project 使用 `crs`。

### operation 返回成功但输出名称不同

检查 `name`、`target` 和 `noReplace` 语义；不同 operation 对原 layer 替换策略不同。

### 旧选择指向错误要素

只通过 `map.ops` 执行 shape-count 变化，让 engine 清理或重映射选择。

## API

- [OpResult](/mapseekai/emap/api/types/emap.OpResult.html)
- [OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [BufferOptions](/mapseekai/emap/api/interfaces/emap.BufferOptions.html)
- [SimplifyOptions](/mapseekai/emap/api/interfaces/emap.SimplifyOptions.html)
- [ProjectOptions](/mapseekai/emap/api/interfaces/emap.ProjectOptions.html)

## 可运行示例

- [Buffer](/mapseekai/emap/examples/buffer/)
- [Clip / erase](/mapseekai/emap/examples/clip-erase/)
- [Dissolve](/mapseekai/emap/examples/dissolve/)
- [Simplify](/mapseekai/emap/examples/simplify/)
- [Union](/mapseekai/emap/examples/union/)

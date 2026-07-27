---
id: operations
slug: /data/operations
title: 数据操作
api: ["AffineLayerOptions","ApplyExpressionOptions","BufferOptions","CheckGeometryOptions","CleanOptions","ClipEraseOptions","DataFillOptions","DissolveOptions","DivideOptions","DragSessionOptions","DropLayerOptions","Emap","ExplodeOptions","ExportSnapshotOptions","ExpressionEvaluationPolicy","FeatureAffineSession","FeatureRef","FeatureTranslateSession","FilterFieldsOptions","FilterGeomOptions","FilterIslandsOptions","FilterOptions","FilterSliversOptions","GeometryCheckReport","HighlightFeatureRef","HighlightStyle","InnerlinesOptions","IntersectionPointsLayerOptions","JoinTableData","JoinTableOptions","LinesOptions","LoadSnapshotOptions","MapOptions","MergeLayersOptions","MosaicOptions","PointsMode","PointsOptions","PolygonsOptions","ProjectOptions","QueriedFeature","QueryFeaturesOptions","RebuildTopologyOptions","RenameFieldsOptions","RenameLayerOptions","SimplifyMethod","SimplifyOptions","SnapOptions","SortFeaturesOptions","SplitLayerOptions","UnionOptions","UniqueFeaturesOptions"]
examples: ["buffer","check-geometry","clip-erase","data-engineering","dissolve","divide","duckdb-overlay","duckdb-spatial-ops","explode","filter-features","innerlines","merge-layers","merge-selected","mosaic","project","rebuild-topology","rename-layer","simplify","simplify-control","snap-layer","split-layer","union"]
stability: stable
verifiedVersion: 0.5.0
---

# 数据操作

`Emap.ops` 将 mapshaper 命令包装成带类型和历史的操作。shape-count、topology-only、attribute-only 与 crs-only 效果会以不同方式保留选择。

## 行为说明

操作返回 `OpResult`；读取结果前检查 `ok`，并把 `error` 显示到状态控件或应用错误 UI。

## API

- [src.OpResult](https://zwishing.github.io/emap/api/types/index.OpResult.html)
- [src.BufferOptions](https://zwishing.github.io/emap/api/interfaces/index.BufferOptions.html)
- [src.SimplifyOptions](https://zwishing.github.io/emap/api/interfaces/index.SimplifyOptions.html)

## 可运行示例

- [buffer](https://zwishing.github.io/emap/examples/buffer/)
- [clip-erase](https://zwishing.github.io/emap/examples/clip-erase/)
- [dissolve](https://zwishing.github.io/emap/examples/dissolve/)
- [simplify](https://zwishing.github.io/emap/examples/simplify/)
- [union](https://zwishing.github.io/emap/examples/union/)

## 最小片段

```ts
const result = await map.ops.bufferLayer({ source: "main", distance: 250 })
if (!result.ok) throw result.error
```

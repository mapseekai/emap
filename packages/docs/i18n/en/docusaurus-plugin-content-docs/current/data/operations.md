---
id: operations
slug: /data/operations
title: Data operations
api: ["AffineLayerOptions","ApplyExpressionOptions","BufferOptions","CheckGeometryOptions","CleanOptions","ClipEraseOptions","DataFillOptions","DissolveOptions","DivideOptions","DragSessionOptions","DropLayerOptions","Emap","ExplodeOptions","ExportSnapshotOptions","ExpressionEvaluationPolicy","FeatureAffineSession","FeatureRef","FeatureTranslateSession","FilterFieldsOptions","FilterGeomOptions","FilterIslandsOptions","FilterOptions","FilterSliversOptions","GeometryCheckReport","HighlightFeatureRef","HighlightStyle","InnerlinesOptions","IntersectionPointsLayerOptions","JoinTableData","JoinTableOptions","LinesOptions","LoadSnapshotOptions","MapOptions","MergeLayersOptions","MosaicOptions","PointsMode","PointsOptions","PolygonsOptions","ProjectOptions","QueriedFeature","QueryFeaturesOptions","RebuildTopologyOptions","RenameFieldsOptions","RenameLayerOptions","SimplifyMethod","SimplifyOptions","SnapOptions","SortFeaturesOptions","SplitLayerOptions","UnionOptions","UniqueFeaturesOptions"]
examples: ["buffer","check-geometry","clip-erase","data-engineering","dissolve","divide","duckdb-overlay","duckdb-spatial-ops","explode","filter-features","innerlines","merge-layers","merge-selected","mosaic","project","rebuild-topology","rename-layer","simplify","simplify-control","snap-layer","split-layer","union"]
stability: stable
verifiedVersion: 0.5.0
---

# Data operations

`Emap.ops` wraps mapshaper commands as typed, history-aware operations. Shape-count, topology-only, attribute-only, and CRS-only effects preserve selection differently.

## Behavior notes

Operations return `OpResult`; check `ok` before reading the result and surface `error` through a status control or app error UI.

## API

- [src.OpResult](/emap/api/types/index.OpResult.html)
- [src.BufferOptions](/emap/api/interfaces/index.BufferOptions.html)
- [src.SimplifyOptions](/emap/api/interfaces/index.SimplifyOptions.html)

## Runnable examples

- [buffer](/emap/examples/buffer/)
- [clip-erase](/emap/examples/clip-erase/)
- [dissolve](/emap/examples/dissolve/)
- [simplify](/emap/examples/simplify/)
- [union](/emap/examples/union/)

## Minimal snippet

```ts
const result = await map.ops.bufferLayer({ source: "main", distance: 250 })
if (!result.ok) throw result.error
```

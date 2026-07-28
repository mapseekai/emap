---
id: selection
slug: /guides/selection
title: 选择
api: ["BoxSelectHandler","BoxSelectHandlerOptions","BoxSelectStyle","ClickSelectHandler","DragPanHandler","DragPanOptions","DrawFeatureHandler","DrawFeatureOptions","DrawGeometryType","Emap","featureMatchesLasso","LassoSelectHandler","LassoSelectHandlerOptions","LassoSelectStyle","LassoStyle","ModifierCombo","pointInPolygon","resolveMode","ScrollZoomHandler","ScrollZoomOptions","SelectHandlerOptions","Selection","SelectionDiff","SelectionSnapshot","SelectMode","TransformFeatureHandler","TransformFeatureOptions","VertexEditHandler","VertexEditOptions"]
examples: ["box-select","feature-rotate-scale","feature-selection","feature-translate","lasso-select","merge-selected"]
stability: stable
verifiedVersion: 0.5.0
---

# 选择

选择以 source、layer 和 feature 为单位。通过地图选择 API 或拉框/套索控件操作，才能保持 `selectionchange` 和历史状态一致。

## 行为说明

拉框和套索是互斥交互模式。用户意图切换到破坏性命令前，应先清理不再需要的选择。

## API

- [src.Emap](/emap/api/classes/index.Emap.html)
- [src.BoxSelectControl](/emap/api/classes/index.BoxSelectControl.html)
- [src.LassoSelectControl](/emap/api/classes/index.LassoSelectControl.html)

## 可运行示例

- [feature-selection](/emap/examples/feature-selection/)
- [box-select](/emap/examples/box-select/)
- [lasso-select](/emap/examples/lasso-select/)

## 最小片段

```ts
map.select([{ source: "main", layer: "polygons", id: 3 }])
map.on("selectionchange", (event) => console.log(event.added, event.removed))
```

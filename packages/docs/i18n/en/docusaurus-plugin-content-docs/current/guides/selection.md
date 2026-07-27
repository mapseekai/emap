---
id: selection
slug: /guides/selection
title: Selection
api: ["BoxSelectHandler","BoxSelectHandlerOptions","BoxSelectStyle","ClickSelectHandler","DragPanHandler","DragPanOptions","DrawFeatureHandler","DrawFeatureOptions","DrawGeometryType","Emap","featureMatchesLasso","LassoSelectHandler","LassoSelectHandlerOptions","LassoSelectStyle","LassoStyle","ModifierCombo","pointInPolygon","resolveMode","ScrollZoomHandler","ScrollZoomOptions","SelectHandlerOptions","Selection","SelectionDiff","SelectionSnapshot","SelectMode","TransformFeatureHandler","TransformFeatureOptions","VertexEditHandler","VertexEditOptions"]
examples: ["box-select","feature-rotate-scale","feature-selection","feature-translate","lasso-select","merge-selected"]
stability: stable
verifiedVersion: 0.5.0
---

# Selection

Selection is source/layer/feature based. Use the map selection APIs or the box/lasso controls so `selectionchange` and history state remain consistent.

## Behavior notes

Box and lasso handlers are mutually exclusive interaction modes. Clear selection before destructive commands when the user intent changes.

## API

- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)
- [src.BoxSelectControl](https://zwishing.github.io/emap/api/classes/index.BoxSelectControl.html)
- [src.LassoSelectControl](https://zwishing.github.io/emap/api/classes/index.LassoSelectControl.html)

## Runnable examples

- [feature-selection](https://zwishing.github.io/emap/examples/feature-selection/)
- [box-select](https://zwishing.github.io/emap/examples/box-select/)
- [lasso-select](https://zwishing.github.io/emap/examples/lasso-select/)

## Minimal snippet

```ts
map.select([{ source: "main", layer: "polygons", id: 3 }])
map.on("selectionchange", (event) => console.log(event.added, event.removed))
```

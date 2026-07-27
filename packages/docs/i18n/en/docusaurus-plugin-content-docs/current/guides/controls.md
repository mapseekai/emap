---
id: controls
slug: /guides/controls
title: Controls
api: ["BasemapControl","BasemapOptions","BasemapStyle","BoxSelectControl","BoxSelectControlOptions","Control","ControlPosition","DrawFeatureControl","DrawFeatureControlOptions","EditToolbar","EditToolbarOptions","Emap","HistoryControl","HistoryControlOptions","LassoSelectControl","LassoSelectControlOptions","NavigationControl","NavigationOptions","SimplifyControl","SimplifyControlOptions","StatusControl","StatusOptions","VertexEditControl","VertexEditControlOptions"]
examples: ["box-select","china-editing","draw-snap-edge","interaction-handlers","lasso-select","simplify-control","vertex-editing"]
stability: stable
verifiedVersion: 0.5.0
---

# Controls

Controls mount DOM around the map and call public map APIs. Add them through `addControl` so lifecycle and positions are managed consistently.

## Behavior notes

Common positions are top-left, top-right, bottom-left, and bottom-right. A control may be disabled by removing it or by using its mode-specific API.

## API

- [src.NavigationControl](https://zwishing.github.io/emap/api/classes/index.NavigationControl.html)
- [src.HistoryControl](https://zwishing.github.io/emap/api/classes/index.HistoryControl.html)
- [src.StatusControl](https://zwishing.github.io/emap/api/classes/index.StatusControl.html)

## Runnable examples

- [simplify-control](https://zwishing.github.io/emap/examples/simplify-control/)
- [undo-redo](https://zwishing.github.io/emap/examples/undo-redo/)
- [interaction-handlers](https://zwishing.github.io/emap/examples/interaction-handlers/)

## Minimal snippet

```ts
map.addControl(new NavigationControl(), "top-left")
map.addControl(new HistoryControl(), "top-right")
```

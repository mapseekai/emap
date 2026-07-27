---
slug: /guides/controls
title: Controls
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

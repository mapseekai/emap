---
slug: /guides/selection
title: 选择
---

# 选择

选择以 source、layer 和 feature 为单位。通过地图选择 API 或拉框/套索控件操作，才能保持 `selectionchange` 和历史状态一致。

## 行为说明

拉框和套索是互斥交互模式。用户意图切换到破坏性命令前，应先清理不再需要的选择。

## API

- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)
- [src.BoxSelectControl](https://zwishing.github.io/emap/api/classes/index.BoxSelectControl.html)
- [src.LassoSelectControl](https://zwishing.github.io/emap/api/classes/index.LassoSelectControl.html)

## 可运行示例

- [feature-selection](https://zwishing.github.io/emap/examples/feature-selection/)
- [box-select](https://zwishing.github.io/emap/examples/box-select/)
- [lasso-select](https://zwishing.github.io/emap/examples/lasso-select/)

## 最小片段

```ts
map.select([{ source: "main", layer: "polygons", id: 3 }])
map.on("selectionchange", (event) => console.log(event.added, event.removed))
```

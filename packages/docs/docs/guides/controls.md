---
slug: /guides/controls
title: 控件
---

# 控件

控件在地图周围挂载 DOM，并调用公开地图 API。通过 `addControl` 添加控件，位置和生命周期才会一致。

## 行为说明

常用位置是 top-left、top-right、bottom-left、bottom-right。控件可通过移除或自身模式 API 禁用。

## API

- [src.NavigationControl](https://zwishing.github.io/emap/api/classes/index.NavigationControl.html)
- [src.HistoryControl](https://zwishing.github.io/emap/api/classes/index.HistoryControl.html)
- [src.StatusControl](https://zwishing.github.io/emap/api/classes/index.StatusControl.html)

## 可运行示例

- [simplify-control](https://zwishing.github.io/emap/examples/simplify-control/)
- [undo-redo](https://zwishing.github.io/emap/examples/undo-redo/)
- [interaction-handlers](https://zwishing.github.io/emap/examples/interaction-handlers/)

## 最小片段

```ts
map.addControl(new NavigationControl(), "top-left")
map.addControl(new HistoryControl(), "top-right")
```

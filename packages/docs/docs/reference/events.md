---
id: events
slug: /reference/events
title: 事件参考
api: []
examples: []
stability: stable
verifiedVersion: 0.8.1
---

# 事件参考

常用公开事件包括 `move`、`moveend`、`zoom`、`zoomend`、`selectionchange`、
`historychange`、`validationfailed`、`data` 和要素事件。

## 行为说明

已知事件名会推断 payload。未知事件名仍可用于应用级扩展。Worker 池内部的
`workerjob*` 信号不会通过 `map.on` 分发。

## API

- [src.EmapEventMap](/mapseekai/emap/api/interfaces/emap.EmapEventMap.html)
- [src.EventListener](/mapseekai/emap/api/types/emap.EventListener.html)

## 可运行示例

- [web-worker](/mapseekai/emap/examples/web-worker/)
- [feature-selection](/mapseekai/emap/examples/feature-selection/)

## 最小片段

```ts
map.once("moveend", (event) => console.log(event.center, event.zoom))
```

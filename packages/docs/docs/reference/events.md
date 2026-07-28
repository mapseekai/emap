---
id: events
slug: /reference/events
title: 事件参考
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# 事件参考

常用事件包括 `move`、`moveend`、`zoom`、`zoomend`、`selectionchange`、`historychange`、`validationfailed`、`workerjobstart` 和 `workerjobend`。

## 行为说明

已知事件名会推断 payload。未知事件名仍可用于应用级扩展。

## API

- [src.EmapEventMap](/emap/api/interfaces/index.EmapEventMap.html)
- [src.EventListener](/emap/api/types/index.EventListener.html)

## 可运行示例

- [web-worker](/emap/examples/web-worker/)
- [feature-selection](/emap/examples/feature-selection/)

## 最小片段

```ts
map.once("workerjobend", (event) => console.log(event.ok))
```

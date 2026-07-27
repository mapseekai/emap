---
slug: /guides/events
title: 事件
---

# 事件

emap 在引擎层使用 `EventDispatcher` 分发信号。相机、指针、要素、历史、验证和 Worker 事件在公开地图表面具有类型化 payload。

## 行为说明

使用 `on`、`off` 和 `once`。要素事件可以按图层过滤；应用也可以继续使用自定义事件名。

## API

- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)
- [src.EmapEventMap](https://zwishing.github.io/emap/api/interfaces/index.EmapEventMap.html)

## 可运行示例

- [feature-attributes](https://zwishing.github.io/emap/examples/feature-attributes/)
- [transaction](https://zwishing.github.io/emap/examples/transaction/)
- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)

## 最小片段

```ts
map.on("moveend", (event) => console.log(event.center, event.zoom))
map.on("feature:click", { layers: ["district-fill"] }, (event) => console.log(event.ref))
```

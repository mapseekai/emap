---
slug: /concepts/emap
title: Emap 地图实例
---

# Emap 地图实例

`Emap` 管理一个地图容器中的 Canvas、相机、数据源、图层顺序、控件、交互、历史和 Worker 路由。

## 行为说明

用 `{ container }` 创建实例。`interactive` 默认 `true`，`useWorker` 默认 `false`，`workerThreshold` 默认 `50000`，`expressionPolicy` 默认 `disabled`。

## API

- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)

## 可运行示例

- [getting-started/geojson-viewer](https://zwishing.github.io/emap/examples/getting-started/geojson-viewer/)
- [interaction-handlers](https://zwishing.github.io/emap/examples/interaction-handlers/)

## 最小片段

```ts
new Emap({ container: "map" })
map.addSource("main", source)
map.addLayer({ id: "fill", type: "fill", source: "main" })
```

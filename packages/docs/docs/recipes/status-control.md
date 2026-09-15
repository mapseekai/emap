---
id: status-control
slug: /recipes/status-control
title: 状态控件
api: ["Emap", "StatusControl", "StatusOptions"]
examples: ["duckdb-geoparquet-query", "duckdb-query", "web-worker"]
stability: stable
verifiedVersion: 0.12.0
---

# 状态控件

`StatusControl` 在地图上显示鼠标坐标和地图 CRS。它监听 `mousemove` 和 `crschange`，并在鼠标位置更新时按动画帧更新 DOM。

## 添加状态控件

```ts
await map.addControl(
  new StatusControl({
    showMousePos: true,
    showEPSG: true,
    alignment: "right",
  }),
  "bottom-left",
)
```

`showMousePos` 控制坐标读数，`showEPSG` 控制 CRS 读数，`alignment` 控制控件内容对齐。应用自己的加载、进度和错误消息应放在应用状态区域；`StatusControl` 专门呈现坐标和 CRS。

## API

- `Emap`
- `StatusControl`
- `StatusOptions`

## 可运行示例

- [DuckDB GeoParquet 查询](/mapseekai/emap/examples/duckdb-geoparquet-query/)
- [DuckDB 查询](/mapseekai/emap/examples/duckdb-query/)
- [Web Worker](/mapseekai/emap/examples/web-worker/)

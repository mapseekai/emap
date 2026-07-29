---
id: status-control
slug: /recipes/status-control
title: 状态控件
api: ["Emap"]
examples: ["duckdb-geoparquet-query","duckdb-query"]
stability: stable
verifiedVersion: 0.5.0
---

# 状态控件

异步加载、可选依赖不可用、Worker 进度和操作错误都适合进入状态区域。

## 行为说明

状态 UI 应区分 loading、success、warning 和 error；底层 operation error 应保留给日志或诊断。

## API

- [src.StatusControl](/mapseekai/emap/api/classes/index.StatusControl.html)
- [src.StatusOptions](/mapseekai/emap/api/interfaces/index.StatusOptions.html)

## 可运行示例

- [duckdb-query](/mapseekai/emap/examples/duckdb-query/)
- [web-worker](/mapseekai/emap/examples/web-worker/)
- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)

## 最小片段

```ts
map.addControl(new StatusControl({ showMousePos: true, showEPSG: true }), "bottom-left")
```

---
slug: /reference/compatibility
title: 兼容性
---

# 兼容性

emap 面向浏览器，需要有尺寸的 DOM 容器、Canvas 和现代模块工具链。可选 formats 与 DuckDB 功能需要对应 WASM 依赖。

## 行为说明

Worker 构建必须从页面可访问 URL 提供 `emap-worker.js` 和 mapshaper vendor assets。

## API

- [src.MapOptions](https://zwishing.github.io/emap/api/interfaces/index.MapOptions.html)
- [src.MapshaperWorkerPool](https://zwishing.github.io/emap/api/classes/index.MapshaperWorkerPool.html)

## 可运行示例

- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)
- [geoparquet-viewer](https://zwishing.github.io/emap/examples/geoparquet-viewer/)

## 最小片段

```ts
import "@zwishing/emap/style.css"
new Emap({ container: "map", workerUrl: "/dist/emap-worker.js" })
```

---
id: compatibility
slug: /reference/compatibility
title: 兼容性
api: ["ArcCollection","ArcCutPoint","ArcIterator","ArcVertexData","ArrowDotPathOptions","bumpEditVersion","CanvasPainter","Coord2","DataTable","DefaultMapshaperAdapter","EditOverlayRenderer","ExportedFile","FeatureShape","GeometryType","getDefaultMapshaperAdapter","Handler","HandlerManager","HandlerResult","isHandler","isPathLayer","isPointLayer","LegacyPointShape","MapshaperAdapter","MapshaperBBox","MapshaperDataset","MapshaperLayer","MapshaperWorkerPool","MapshaperWorkerPoolOptions","NormalizedPointerEvent","PackedSession","PathGeometryType","PathLayer","PathPart","PathShape","PointerModifiers","PointerMoveEvent","PointLayer","PointShape","PointStyle","RunnerInputFiles","SegmentIntersection","setDefaultMapshaperAdapter","SignedArcId","StrokeStyle","TopologySource.fromBytes","Transform","VertexDotStyle"]
examples: ["geoparquet-viewer"]
stability: stable
verifiedVersion: 0.5.0
---

# 兼容性

Emap 面向浏览器，需要有尺寸的 DOM 容器、Canvas 和现代模块工具链。可选 `duckdb` 子路径需要 DuckDB-Wasm；`arrow` 子路径的内存 Arrow 与 GeoArrow API 使用 `apache-arrow`，不需要 WASM，只有 GeoParquet 导入和导出会懒加载 `parquet-wasm`。

## TypeScript 模块解析

`@mapseekai/emap/arrow` 与 `@mapseekai/emap/duckdb` 通过 `package.json` 的 `exports` 提供：

- Vite 等浏览器打包器使用 `"module": "ESNext"` 与 `"moduleResolution": "bundler"`。
- 原生 Node ESM 对 `module` 和 `moduleResolution` 配对使用 `Node16` 或 `NodeNext`。

旧版 `node`/`node10` 解析不支持这些子路径，即使声明文件已经存在也无法解析。完整配置参见[安装与第一张地图](../getting-started/installation.md#typescript-模块解析)。

## 行为说明

Worker 构建必须从页面可访问 URL 提供 `emap-worker.js` 和 mapshaper vendor assets。

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.MapshaperWorkerPool](/mapseekai/emap/api/classes/emap.MapshaperWorkerPool.html)

## 可运行示例

- [web-worker](/mapseekai/emap/examples/web-worker/)
- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)

## 最小片段

```ts
import "@mapseekai/emap/style.css"
new Emap({ container: "map", workerUrl: "/dist/emap-worker.js" })
```

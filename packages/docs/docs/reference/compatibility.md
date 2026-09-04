---
id: compatibility
slug: /reference/compatibility
title: 兼容性
api: ["ArcCollection","ArcCutPoint","ArcIterator","ArcVertexData","ArrowDotPathOptions","bumpAttributeVersion","bumpEditVersion","CanvasPainter","Coord2","DataTable","DefaultMapshaperAdapter","EditOverlayRenderer","ExportedFile","FeatureShape","GeometryType","getDefaultMapshaperAdapter","Handler","HandlerManager","HandlerResult","isHandler","isPathLayer","isPointLayer","LegacyPointShape","MapshaperAdapter","MapshaperBBox","MapshaperDataset","MapshaperLayer","MapshaperWorkerPool","MapshaperWorkerPoolOptions","NormalizedPointerEvent","PackedSession","PathGeometryType","PathLayer","PathPart","PathShape","PointerModifiers","PointerMoveEvent","PointLayer","PointShape","PointStyle","RunnerInputFiles","SegmentIntersection","setDefaultMapshaperAdapter","SignedArcId","StrokeStyle","TopologySource.fromBytes","Transform","VertexDotStyle"]
examples: ["geoparquet-viewer"]
stability: stable
verifiedVersion: 0.8.1
---

# 兼容性

Emap 面向浏览器，需要有尺寸的 DOM 容器、Canvas 和现代模块工具链。可选 `duckdb` 子路径需要 DuckDB-Wasm；`arrow` 子路径的内存 Arrow 与 GeoArrow API 使用 `apache-arrow`，不需要 WASM，只有 GeoParquet 导入和导出会懒加载 `parquet-wasm`。

## 支持基线

| 环境 | 声明基线 | 自动验证 |
|---|---|---|
| Node.js 开发与发布工具 | `>=22.18 <25` | PR 使用 Node 22.18 和 Node 24；发布使用 Node 22.18 |
| JavaScript 输出语法 | ES2022 | 生产 Bundle 构建和自包含检查 |
| Chromium | Chrome / Edge 109+ | Playwright 使用稳定版 Chrome |
| Firefox | Firefox 115+ | Playwright Firefox |
| WebKit / Safari | Safari 16.4+ | Playwright WebKit |

浏览器基线表示项目声明并持续验证的最低目标，不代表旧浏览器会被主动阻止。依赖触摸、Worker、WASM、文件上传或 MapLibre 的应用，应同时在自己的部署环境中验证 CSP、跨域资源和设备性能。

## TypeScript 模块解析

`@mapseekai/emap/arrow` 与 `@mapseekai/emap/duckdb` 通过 `package.json` 的 `exports` 提供：

- Vite 等浏览器打包器使用 `"module": "ESNext"` 与 `"moduleResolution": "bundler"`。
- 原生 Node ESM 对 `module` 和 `moduleResolution` 配对使用 `Node16` 或 `NodeNext`。

旧版 `node`/`node10` 解析不支持这些子路径，即使声明文件已经存在也无法解析。完整配置参见[安装与第一张地图](../getting-started/installation.md#typescript-模块解析)。

## 行为说明

Worker 构建必须从页面可访问 URL 提供 `emap-worker.js` 和 mapshaper vendor assets。
自定义底层命令直接修改 dataset 时，几何变化应调用 `bumpEditVersion()`，纯属性变化应调用
`bumpAttributeVersion()`，以使空间索引和属性样式缓存按各自边界失效。

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

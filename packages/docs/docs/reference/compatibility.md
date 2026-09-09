---
id: compatibility
slug: /reference/compatibility
title: 兼容性
api: ["ArcCollection","ArcCutPoint","ArcIterator","ArcVertexData","ArrowDotPathOptions","bumpAttributeVersion","bumpEditVersion","CanvasPainter","Coord2","DataTable","DefaultMapshaperAdapter","EditOverlayRenderer","ExportedFile","FeatureShape","GeometryType","getDefaultMapshaperAdapter","Handler","HandlerManager","HandlerResult","isHandler","isPathLayer","isPointLayer","LegacyPointShape","MapshaperAdapter","MapshaperBBox","MapshaperDataset","MapshaperLayer","MapshaperWorkerPool","MapshaperWorkerPoolOptions","NormalizedPointerEvent","PackedSession","PathGeometryType","PathLayer","PathPart","PathShape","PointerModifiers","PointerMoveEvent","PointLayer","PointShape","PointStyle","RunnerInputFiles","SegmentIntersection","setDefaultMapshaperAdapter","SignedArcId","StrokeStyle","TopologySource.fromBytes","Transform","VertexDotStyle","Emap","MapOptions","initParquetWasm","setParquetWasm","createDuckDbRuntimeFromJsDelivr","setDuckDbRuntime"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.9.1
---

# 兼容性

Emap 在浏览器中运行，需要具备实际尺寸的 DOM 容器、Canvas 2D 和 ES module 支持。包的 JavaScript 目标为 ES2022。

## 浏览器和开发环境

| 环境 | 要求 |
| --- | --- |
| Chrome / Edge | 109 或更高版本 |
| Firefox | 115 或更高版本 |
| Safari | 16.4 或更高版本 |
| Node.js（开发和发布工具） | `>=22.18 <25` |
| TypeScript | `strict` 模式下使用 ES2022、DOM 和 ES module 类型库 |

使用 Worker、WASM、文件上传或 MapLibre 的应用需要在部署环境中提供相应的 CSP、跨域资源和设备性能条件。

## 打包器和 TypeScript

根入口、`@mapseekai/emap/arrow` 和 `@mapseekai/emap/duckdb` 通过 package `exports` 发布。Vite 等浏览器打包器使用以下 TypeScript 配置：

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

原生 Node ESM 使用配对的 `"module": "Node16"` 与 `"moduleResolution": "Node16"`，或配对的 `NodeNext` 值。解析器必须支持 package `exports` 才能解析可选子路径。

## 可选 peer 依赖

| 使用的入口或能力 | 安装的 peer 依赖 |
| --- | --- |
| 核心 `@mapseekai/emap` | 无 |
| `@mapseekai/emap/arrow` 的 Arrow 与 GeoArrow | `apache-arrow` `^21.1.0` |
| Arrow 入口的 GeoParquet 导入和导出 | `apache-arrow` `^21.1.0`、`parquet-wasm` `^0.7.1` |
| `@mapseekai/emap/duckdb` | `@duckdb/duckdb-wasm` `1.33.1-dev57.0`、`apache-arrow` `^21.1.0` |

这些 peer 依赖均为可选安装项；仅安装应用实际导入的入口所需依赖。GeoParquet 首次使用时加载 `parquet-wasm`。无法由打包器解析该模块的环境可以通过 `setParquetWasm` 注入已初始化模块。

## Worker 资源

启用 `workerUrl` 时，页面必须能访问 `emap-worker.js`，且同一目录必须包含 `mapshaper-vendor.js`。Worker 相对加载该 vendor 文件。

直接修改 dataset 的低层命令在几何改变后调用 `bumpEditVersion()`，在仅属性改变后调用 `bumpAttributeVersion()`，使空间索引和属性样式缓存按各自边界失效。

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.MapshaperWorkerPool](/mapseekai/emap/api/classes/emap.MapshaperWorkerPool.html)
- [src_arrow.initParquetWasm](/mapseekai/emap/api/functions/arrow.initParquetWasm.html)

## 可运行示例

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [web-worker](/mapseekai/emap/examples/web-worker/)

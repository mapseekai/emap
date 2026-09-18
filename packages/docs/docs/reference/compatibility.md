---
id: compatibility
slug: /reference/compatibility
title: 兼容性
api: ["ArcCollection", "ArcCutPoint", "ArcIterator", "ArcVertexData", "ArrowDotPathOptions", "bumpAttributeVersion", "bumpEditVersion", "CanvasPainter", "Coord2", "DataTable", "DefaultMapshaperAdapter", "EditOverlayRenderer", "ExportedFile", "FeatureShape", "GeometryType", "getDefaultMapshaperAdapter", "Handler", "HandlerManager", "HandlerResult", "isHandler", "isPathLayer", "isPointLayer", "LegacyPointShape", "MapshaperAdapter", "MapshaperBBox", "MapshaperDataset", "MapshaperLayer", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions", "NormalizedPointerEvent", "PackedSession", "PathGeometryType", "PathLayer", "PathPart", "PathShape", "PointerModifiers", "PointerMoveEvent", "PointLayer", "PointShape", "PointStyle", "RunnerInputFiles", "SegmentIntersection", "setDefaultMapshaperAdapter", "SignedArcId", "StrokeStyle", "TopologySource.fromBytes", "Transform", "VertexDotStyle", "Emap", "MapOptions", "initParquetWasm", "setParquetWasm", "createDuckDbRuntimeFromJsDelivr"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.13.0
---

# 兼容性

浏览器渲染需要实际尺寸的 DOM 容器、Canvas 2D 和 ES modules；发布代码和 TypeScript 目标为 ES2022。

## 核心环境要求

### 浏览器版本下限

版本下限来自根 `package.json` 的 `browserslist`：

| 环境 | 最低版本 | 依据与使用场景 |
| --- | --- | --- |
| Chrome | 109 | Canvas、ES modules 和可选 Worker。 |
| Edge | 109 | Canvas、ES modules 和可选 Worker。 |
| Firefox | 115 | Canvas、ES modules 和可选 Worker。 |
| Safari | 16.4 | Canvas、ES modules 和可选 Worker。 |
| Node.js | `>=22.18 <25` | 开发、构建和发布。 |
| TypeScript | ES2022 + DOM + DOM.Iterable，`strict: true` | 类型与 package exports。 |

### 核心浏览器 API

| API 或能力 | 范围 | Emap 使用方式与场景 |
| --- | --- | --- |
| `document`、`HTMLElement`、`HTMLCanvasElement` | 浏览器 preset 必需 | 创建画布、控件和覆盖层。 |
| Canvas 2D (`canvas.getContext('2d')`) | 浏览器 preset 必需 | `CanvasPainter` 绘制。 |
| `requestAnimationFrame` | 浏览器 preset 必需 | 合并帧内重绘。 |
| Pointer Events、鼠标与滚轮事件 | 交互 preset | 指针归一化和交互。 |
| `fetch`、`Blob`、`ArrayBuffer`、`Uint8Array` | 数据、导入导出与快照 | 获取数据和生成 `Blob`。 |
| `DOMParser` | KML 导入场景 | 解析 KML。 |
| `Worker` | `useWorker`、GeoPackage Worker 或 DuckDB 场景 | 移出 UI 线程。 |
| WebAssembly | GeoParquet、GeoPackage 或 DuckDB 场景 | 加载 WASM runtime。 |

核心地图在主线程 Canvas 2D 运行；`useWorker` 默认 `false`。启用 Worker 或 WASM 时部署对应资源。

## 打包器与 TypeScript

根入口及功能子路径通过 package `exports` 发布；浏览器打包器应解析 ESM 和子路径：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

Vite、webpack 5 等 ESM 打包器可从模块 URL 解析 `parquet-wasm` 二进制。Node ESM 为 `module` 和 `moduleResolution` 选择同一 `Node16` 或 `NodeNext`；浏览器渲染在客户端创建，`headless` 可省略 `container`。

## 可选 Peer 依赖

| 使用的入口或能力 | 安装的 peer 依赖 | 运行时资源 |
| --- | --- | --- |
| 核心 `@mapseekai/emap` | 无 | 浏览器 DOM、Canvas 2D |
| `@mapseekai/emap/arrow` 的 Arrow 与 GeoArrow | `apache-arrow` `^17.0.0` | ESM bundle |
| Arrow 入口的 GeoParquet 导入和导出 | `apache-arrow` `^17.0.0`、`parquet-wasm` `^0.7.1` | `parquet_wasm_bg.wasm` 或显式 `wasmInput` |
| `@mapseekai/emap/duckdb` | `@duckdb/duckdb-wasm` `1.33.1-dev64.0`、`apache-arrow` `^17.0.0` | DuckDB-Wasm 的 Worker、WASM bundle 和可选 spatial extension |
| `@mapseekai/emap/maplibre` | `maplibre-gl` `^6.4.1` | MapLibre 的应用资源配置 |

peer 依赖按导入入口安装。GeoParquet 首次动态加载 `parquet-wasm`；无 import map 时可通过 `setParquetWasm()` 或 `window.parquetWasm` 提供模块。

## Worker 与 WASM 资源

### `MapOptions` 的 Worker 参数

浏览器地图的兼容性参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | 必填 | 浏览器宿主，元素需有实际宽高。 |
| `interactive` | `boolean` | `true` | 启用内置平移和滚轮缩放。 |
| `useWorker` | `boolean \| 'auto'` | `false` | dataset-replace Worker 路由。 |
| `workerThreshold` | `number` | `50000` | `'auto'` 顶点阈值。 |
| `workerUrl` | `string` | `'emap-worker.js'` | Worker bundle URL。 |
| `workerPoolSize` | `number` | `1` | 最大 Worker 数。 |
| `workerPool` | `MapshaperWorkerPool` | `undefined` | 预建 Worker 池。 |
| `workerRouting` | `WorkerRoutingFn` | `undefined` | 自定义 `'auto'` 路由。 |

`'auto'` 以 `workerThreshold` 路由；Worker 池按负载惰性创建。

### `MapshaperWorkerPool` 参数

直接管理 mapshaper 线程：`new MapshaperWorkerPool(options)`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `workerUrl` | `string` | 必填 | `emap-worker.js` URL。 |
| `WorkerCtor` | `typeof Worker` | 全局 `Worker` | 自定义 Worker 构造器。 |
| `poolSize` | `number` | `1` | 最大线程数，至少一个。 |
| `jobTimeoutMs` | `number` | `120000` | 请求超时；`0` 不限时。 |

`emap-worker.js` 通过相对 `importScripts()` 加载同目录 `mapshaper-vendor.js`。

### `initParquetWasm` 与 `setParquetWasm` 参数

| API | 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `initParquetWasm` | `opts` | `InitParquetWasmOptions` | `{}` | 初始化或获取缓存模块。 |
| `initParquetWasm` | `opts.wasmInput` | `string \| URL \| Request \| Uint8Array \| ArrayBuffer \| WebAssembly.Module` | 模块相对的 `parquet_wasm_bg.wasm` | WASM 输入或预编译模块。 |
| `setParquetWasm` | `mod` | `ParquetWasmModule \| null` | 必填 | 注入模块；`null` 清除缓存。 |

## 部署边界

| 项目 | 对象 | 说明 |
| --- | --- | --- |
| 静态资源路径 | mapshaper Worker | 发布 `emap-worker.js` 和相邻 `mapshaper-vendor.js`。 |
| 静态资源路径与 MIME | GeoPackage | 发布 Worker、vendor 和 WASM；WASM 使用 `application/wasm`。 |
| CSP Worker 策略 | mapshaper、GeoPackage、DuckDB | 允许 Worker 脚本和 DuckDB `blob:` URL。 |
| CSP 网络策略 | URL 数据、WASM、DuckDB spatial extension | 允许资源来源。 |
| 资源来源 | 所有 Worker/WASM 路径 | 部署浏览器可加载 URL。 |
| 内存与线程 | 大数据、GeoPackage、DuckDB | Worker、WASM 和输入副本占用内存。 |

直接修改 dataset 后调用版本函数刷新缓存：

| API | 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `bumpEditVersion` | `dataset` | `MapshaperDataset \| null \| undefined` | 必填 | 更新几何版本和空间索引缓存。 |
| `bumpAttributeVersion` | `dataset` | `MapshaperDataset \| null \| undefined` | 必填 | 更新属性版本和样式缓存。 |

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.MapshaperWorkerPool](/mapseekai/emap/api/classes/emap.MapshaperWorkerPool.html)
- [src_arrow.initParquetWasm](/mapseekai/emap/api/functions/arrow.initParquetWasm.html)

## 可运行示例

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [web-worker](/mapseekai/emap/examples/web-worker/)

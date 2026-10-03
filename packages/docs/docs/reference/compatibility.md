---
id: compatibility
slug: /reference/compatibility
title: 兼容性
api: ["RendererBackend", "Emap.getRenderer", "ArcCollection", "ArcCutPoint", "ArcIterator", "ArcVertexData", "ArrowDotPathOptions", "bumpAttributeVersion", "bumpEditVersion", "CanvasPainter", "Coord2", "DataTable", "DefaultMapshaperAdapter", "EditOverlayRenderer", "ExportedFile", "FeatureShape", "GeometryType", "getDefaultMapshaperAdapter", "Handler", "HandlerManager", "HandlerResult", "isHandler", "isPathLayer", "isPointLayer", "LegacyPointShape", "MapshaperAdapter", "MapshaperBBox", "MapshaperDataset", "MapshaperLayer", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions", "NormalizedPointerEvent", "PackedSession", "PathGeometryType", "PathLayer", "PathPart", "PathShape", "PointerModifiers", "PointerMoveEvent", "PointLayer", "PointShape", "PointStyle", "RunnerInputFiles", "SegmentIntersection", "setDefaultMapshaperAdapter", "SignedArcId", "StrokeStyle", "TopologySource.fromBytes", "Transform", "VertexDotStyle", "Emap", "MapOptions", "initParquetWasm", "setParquetWasm", "createDuckDbRuntimeFromJsDelivr"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.14.0
---

# 兼容性

浏览器地图需要实际尺寸的 DOM 容器、Canvas 2D 覆盖层和 ES modules；主画布支持 Canvas2D、WebGL2 与 WebGPU，默认 WebGL2。发布代码和 TypeScript 目标为 ES2022。

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
| Canvas 2D (`canvas.getContext('2d')`) | 浏览器 preset 必需 | Canvas2D 后端、编辑手柄/测量提示及颜色解析。 |
| `requestAnimationFrame` | 浏览器 preset 必需 | 合并帧内重绘。 |
| Pointer Events、鼠标与滚轮事件 | 交互 preset | 指针归一化和交互。 |
| `fetch`、`Blob`、`ArrayBuffer`、`Uint8Array` | 数据、导入导出与快照 | 获取数据和生成 `Blob`。 |
| `DOMParser` | KML 导入场景 | 解析 KML。 |
| `Worker` | `useWorker`、GeoPackage Worker 或 DuckDB 场景 | 移出 UI 线程。 |
| WebAssembly | GeoParquet、GeoPackage 或 DuckDB 场景 | 加载 WASM runtime。 |

主地图默认使用 luma WebGL2。`renderer` 配置绘制后端，`useWorker` 配置数据操作路由，默认 `false`。GPU 渲染需要浏览器和设备支持：WebGL2 需处于启用状态，WebGPU 需要可用适配器与安全上下文。

## 地图创建时选择渲染后端

```ts
import { Emap, type RendererBackend } from '@mapseekai/emap';
const renderer: RendererBackend = 'webgl2';
const map = await Emap.create({ container: 'map', renderer });
console.log(map.getRenderer()); // 'webgl2'
```

示例页顶部提供 Canvas2D / WebGL2 / WebGPU 切换按钮。切换会重新加载示例并保留其他 URL 参数。
切换前保存编辑，重新加载后再次选择本地文件。正式地图示例支持三种后端；
luma-25d 与 luma-vertex-editing 实验提供 GPU 后端，三后端对比可使用正式 vertex-editing 示例。
GPU 创建失败时，顶部按钮可用于重新选择后端。

`renderer` 接受 `canvas2d`、`webgl2`、`webgpu`，默认 `webgl2`。
创建地图时设置后端；更换后端需要创建新地图实例。GPU 初始化失败时，
`Emap.create()` 会 reject 并释放资源。宿主管理回退策略：捕获失败后，
显式创建 `renderer: 'canvas2d'` 的地图。`getRenderer()` 返回实际主画布后端；
headless、empty、已销毁地图及未声明后端的自定义 Painter 返回 `null`。

点、线、面、图标和文字由所选 GPU 后端直接绘制；地图服务管理选择、编辑、过滤和历史。
手柄、绘制预览和测量提示共用地图上的独立 Canvas2D 覆盖层。
栅格服务负责读取、着色和重投影瓦片，由所选 Painter 合成。
原生整数纹理、专用分块 Worker 和 2.5D 相机可通过各自的实验路径使用。

启用 GPU 注记时按需加载 MSDF Worker。部署 `dist/emap-msdf-worker.js` 及同级 `dist/msdf/` 目录。
直接部署包时，Worker 默认从模块同目录解析；打包器重新组织资源时设置
`msdfWorkerUrl: '/assets/emap-msdf-worker.js'`，并将 `msdf/` 放在该 Worker 同目录。
字体错误的影响范围为注记，地图继续使用已选择的后端。

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

Vite、webpack 5 等 ESM 打包器可从模块 URL 解析 `parquet-wasm` 二进制。公开声明使用省略扩展名的相对导入，请采用上述已验证的浏览器配置。地图在客户端创建；`headless` 提供浏览器纯数据工作区，可省略 `container`。

## Peer 依赖配置

| 使用的入口或能力 | 安装的 peer 依赖 | 运行时资源 |
| --- | --- | --- |
| 核心 `@mapseekai/emap` | `maplibre-gl` `^6.4.1`，用于公开类型 | DOM、Canvas2D 覆盖层，及所选 GPU 后端 |
| `@mapseekai/emap/arrow` 的 Arrow 与 GeoArrow | `apache-arrow` `^17.0.0` | ESM bundle |
| Arrow 入口的 GeoParquet 导入和导出 | `apache-arrow` `^17.0.0`、`parquet-wasm` `^0.7.1` | `parquet_wasm_bg.wasm` 或显式 `wasmInput` |
| `@mapseekai/emap/duckdb` | `@duckdb/duckdb-wasm` `1.33.1-dev64.0`、`apache-arrow` `^17.0.0` | DuckDB-Wasm 的 Worker、WASM bundle 和可选 spatial extension |
| `@mapseekai/emap/maplibre` | `maplibre-gl` `^6.4.1` | MapLibre 的应用资源配置 |

核心 MapLibre peer 提供公开类型，启用底图需注册 MapLibre 插件；其他 peer 依赖按功能入口安装。GeoParquet 首次动态加载 `parquet-wasm`；应用可通过 import map、`setParquetWasm()` 或 `window.parquetWasm` 提供模块。

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
| `jobTimeoutMs` | `number` | `120000` | 请求超时毫秒数，取 `1`–`2147483647` 的整数。 |

`emap-worker.js` 通过相对 `importScripts()` 加载同目录 `mapshaper-vendor.js`。

### `initParquetWasm` 与 `setParquetWasm` 参数

| API | 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `initParquetWasm` | `opts` | `InitParquetWasmOptions` | `{}` | 初始化或获取缓存模块。 |
| `initParquetWasm` | `opts.wasmInput` | `string \| URL \| Request \| Uint8Array \| ArrayBuffer \| WebAssembly.Module` | 模块相对的 `parquet_wasm_bg.wasm` | WASM 输入或预编译模块。 |
| `setParquetWasm` | `mod` | `ParquetWasmModule \| null` | 必填 | 注入模块；`null` 清除缓存。 |

## 部署配置

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

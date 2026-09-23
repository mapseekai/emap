---
id: compatibility
slug: /reference/compatibility
title: 兼容性
api: ["RendererBackend", "Emap.getRenderer", "ArcCollection", "ArcCutPoint", "ArcIterator", "ArcVertexData", "ArrowDotPathOptions", "bumpAttributeVersion", "bumpEditVersion", "CanvasPainter", "Coord2", "DataTable", "DefaultMapshaperAdapter", "EditOverlayRenderer", "ExportedFile", "FeatureShape", "GeometryType", "getDefaultMapshaperAdapter", "Handler", "HandlerManager", "HandlerResult", "isHandler", "isPathLayer", "isPointLayer", "LegacyPointShape", "MapshaperAdapter", "MapshaperBBox", "MapshaperDataset", "MapshaperLayer", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions", "NormalizedPointerEvent", "PackedSession", "PathGeometryType", "PathLayer", "PathPart", "PathShape", "PointerModifiers", "PointerMoveEvent", "PointLayer", "PointShape", "PointStyle", "RunnerInputFiles", "SegmentIntersection", "setDefaultMapshaperAdapter", "SignedArcId", "StrokeStyle", "TopologySource.fromBytes", "Transform", "VertexDotStyle", "Emap", "MapOptions", "initParquetWasm", "setParquetWasm", "createDuckDbRuntimeFromJsDelivr"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.13.0
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

主地图默认使用 luma WebGL2；`useWorker` 仍只控制数据操作路由，默认 `false`，不是 GPU 开关。上面的 browserslist 下限不是设备 GPU 能力保证；WebGL2 可被浏览器或驱动禁用，WebGPU 还需要可用适配器与安全上下文。

## 地图创建时选择渲染后端

```ts
import { Emap, type RendererBackend } from '@mapseekai/emap';
const renderer: RendererBackend = 'webgl2';
const map = await Emap.create({ container: 'map', renderer });
console.log(map.getRenderer()); // 'webgl2'
```

所有示例页顶部均有 Canvas2D / WebGL2 / WebGPU 切换按钮。切换会重新加载当前示例，
保留其他 URL 参数；本地文件需重新选择，未保存的编辑不会保留。正式地图示例均支持三种后端。
专用 luma-25d 与 luma-vertex-editing 实验仅支持 GPU，Canvas2D 明确禁用；
可在正式 vertex-editing 示例中对比三后端。GPU 创建失败时顶部按钮仍然可用。


`renderer` 接受 `canvas2d`、`webgl2`、`webgpu`，省略时为 `webgl2`。它是创建时设置，
不是运行时热切换 API。GPU 不可用或初始化失败时 `Emap.create()` 会 reject 并清理资源，
不会静默改用 Canvas2D。需要兼容回退的宿主可捕获失败后显式重新创建 `renderer: 'canvas2d'` 的地图。
`getRenderer()` 返回实际主画布后端；headless、empty、已销毁地图或未声明后端的自定义 Painter 返回 null。

点、线、面、图标和文字在 GPU 后端直接绘制。选择、编辑、过滤、历史仍由原地图服务管理；
手柄、绘制预览、测量提示继续使用独立 Canvas2D 覆盖层，不额外创建地图或图层。
正式栅格服务当前继续使用已有读取/着色/重投影瓦片，然后由所选 Painter 合成；
原生整数纹理、专用分块 Worker 和 2.5D 相机的实验路径仍保留，不因后端切换就宣称已全部迁移。

GPU 注记按需加载 MSDF Worker。发布 `dist/emap-msdf-worker.js` 及其同级 `dist/msdf/` 目录；
直接部署包时默认从运行模块同目录解析 Worker。打包器重新组织文件时显式设置
`msdfWorkerUrl: '/assets/emap-msdf-worker.js'`，并把 `msdf/` 放在该 Worker 同目录。
不开启注记不启动字体 Worker；字体失败只影响注记，不改变已选择的地图后端。

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
| 核心 `@mapseekai/emap` | 无 | DOM、Canvas2D 覆盖层，及所选 GPU 后端 |
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

---
id: intro
slug: /
title: Emap 简介
api: ["Emap", "LayerSpecification", "TopologySource"]
examples: ["china-editing","export-formats","getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.12.0
---

# Emap

`@mapseekai/emap` 是浏览器端 TypeScript 地图引擎，用于加载、渲染、编辑和分析矢量数据；数据保存在可撤销的 mapshaper topology dataset 中。

```ts
import { Emap, TopologySource } from '@mapseekai/emap'; // 导入地图和数据源
import '@mapseekai/emap/style.css'; // 导入控件和编辑样式
const map = await Emap.create({ container: 'map' }); // 创建交互地图
const source = await TopologySource.fromUrl('main', '/data/roads.geojson'); // 加载 GeoJSON
await map.addSource('main', source); // 注册数据源
map.addLayer({ id: 'roads', type: 'line', source: 'main' }); // 绘制数据源
```

## 核心方法

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `Emap.create(options)` | `EmapOptions` | 创建地图和 preset 运行时。 |
| `TopologySource.fromUrl(id, url, options?)` / `fromBytes(id, bytes, options?)` | source ID、输入 | 导入数据。 |
| `map.addSource(id, source)` / `map.addLayer(spec)` | source ID、对象 | 注册数据并创建渲染图层。 |

应用管理自身 UI，Emap 提供地图、数据、交互和插件运行时。

## 更多数据格式与 source

`TopologySource` 负责数据导入和导出；详见[数据格式](./data/formats.md)。

| 入口/参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `TopologySource.fromUrl(id, url, options)` | `id: string`、`url: string` | 必填 | 从 URL 导入；`id` 供 source 和 render layer 引用。 |
| `TopologySource.fromBytes(id, bytes, options)` | `bytes: Uint8Array \| ArrayBuffer` | 必填 | 从内存字节导入；`filename` 扩展名选择导入器。 |
| `options.formats` | `FormatRegistryContract` | 空注册表 | 插件格式注册表。 |
| `options.resourceLimits` / `zipLimits` / `adapter` | `Partial<ImportResourceLimits>` / `ZipExtractionLimits` / `MapshaperAdapter` | 2 GiB 输入上限 / 见详情页 / 默认适配器 | 导入资源与 ZIP 限制、执行适配器。 |

核心包读写 GeoJSON、TopoJSON、Shapefile ZIP 和 mapshaper snapshot（`.msx`），导入 KML。`/arrow` 增加 GeoArrow、GeoParquet，`/geopackage` 导入 GeoPackage 矢量表，插件可提供 FlatGeobuf。`source.export(options)` 返回 `Blob`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `format` | `ExportFormat` | 必填 | `geojson`、`topojson`、`shapefile`、`msx`；可选格式由入口或插件提供。 |
| `layer` | `number \| string` | `0` | GeoParquet / GeoArrow 导出的图层索引或名称。 |
| `encoding` | `'wkb' \| 'native'` | GeoParquet 为 `'wkb'`；GeoArrow 为 `'native'` | 列式格式的几何编码。 |
| `quantization` | `boolean` | `false` | TopoJSON 坐标量化。 |

## 更多图层与样式

`map.addLayer(spec)` 添加 `LayerSpecification`；`setPaintProperty`、`setFilter` 和 `setLayerVisibility` 运行时更新。详见[样式](./guides/styling.md)。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` / `type` / `source` | `string` / `'fill' \| 'line' \| 'circle'` / `string` | 必填 | 唯一图层 ID、渲染器和 source ID。 |
| `'source-layer'` | `string` | source 的第一层 | source 内的 mapshaper layer。 |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | 绘制、拾取和属性视图开关。 |
| `filter` / `styleSource` | `StyleExpression` / `'mapshaper'` | 未设置 | 要素筛选或读取烘焙 `fill` / `stroke`。 |
| `pointLod`（仅 `circle`） | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | CSS 像素网格抽稀；`cellSize` 为 `1–64`。 |

| 图层 | `paint` 参数 | 类型 | 默认值 |
| --- | --- | --- | --- |
| `fill` | `fill-color`、`fill-opacity` | `string \| StyleExpression`、`number` | 主题 muted 色、`1`。 |
| `line` | `line-color`、`line-width`、`line-dasharray`、`line-dashstyle` | `string \| StyleExpression`、`number`、`readonly number[]`、`LineDashStyle \| StyleExpression` | 主题 primary 色、`0.8` CSS px、实线。 |
| `line` | `line-arrow-spacing`、`line-arrow-size` | `number`、`number` | `32`、`6` CSS px。 |
| `circle` | `circle-color`、`circle-radius`、`circle-fill`、`circle-shape` | `string \| StyleExpression`、`number`、`boolean`、`PointMarkerShape \| StyleExpression` | 主题 primary 色、`4` CSS px、`true`、`'circle'`。 |

## 更多编辑、历史与数据操作

`drawFeature`、`vertexEdit`、`splitFeature`、`reshapeFeature`、`autoCompletePolygon`、`ringEdit`、`partEdit` 和 `transformFeature` 是可启用 Handler。`setOptions()` 指定绘制目标和捕捉；选择驱动编辑见[编辑](./guides/editing.md)。

| 入口/参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | `() => boolean` | — | 撤销、重做和历史状态。 |
| `beginTransaction()` | `() => Transaction` | — | 合并命令或回滚数据和选择。 |
| `pushCommand(command)` | `EditCommand` | — | 接入可撤销历史。 |

`map.ops` 的 45 个方法返回 `Promise<OpResult>`，统一同步历史和选择。详见[数据操作](./data/operations.md)。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` / `target` | `string` / `string` | 通常必填 | source ID 与目标 source layer。 |
| `clipLayer` / `eraseLayer` 的 `mask` / `bbox` | `string` / `[number, number, number, number]` | 二选一 | 面 layer 或源坐标范围。 |
| `dissolveLayer` 的 `field` / `fields` | `string` / `string[]` | 未分组 | 单或多属性字段分组。 |
| `bufferLayer` 的 `radius` | `number \| string` | 必填 | 缓冲半径或 mapshaper 表达式。 |
| `simplifyLayer` 的 `percentage` / `interval` / `resolution` | `number` | 三选一 | 保留比例、阈值或目标分辨率。 |
| `map.ops.withSignal(signal)` | `AbortSignal` | — | 长操作取消范围。 |

## 更多运行时与扩展

`Emap.create(options)` 挂载 preset，`map.ready` 后返回公共门面；`map.ctx` 是 Cordis `Context`。插件、Agent capability 和 MapLibre 见[插件](./guides/plugins.md)。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | 浏览器 preset 必填 | Canvas 容器；`headless` 可省略。 |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | 编辑、浏览、无 DOM 处理或应用插件起点。 |
| `interactive` | `boolean` | `true` | 内置拖拽和滚轮交互。 |
| `expressionPolicy` | `'disabled' \| 'trusted'` | `'disabled'` | mapshaper JavaScript 表达式策略。 |
| `useWorker` / `workerThreshold` / `workerUrl` | `boolean \| 'auto'` / `number` / `string` | `false` / `50000` / `'emap-worker.js'` | 主线程、Worker 或阈值路由；URL 相对 `document.baseURI`。 |
| `workerPoolSize` / `workerPool` / `workerRouting` | `number` / `MapshaperWorkerPool` / `WorkerRoutingFn` | `1` / 未设置 / 引擎决策 | Worker 并发、专属池或逐调用路由。 |
| `plugins` / `excludePlugins` | `readonly Plugin[]` / `readonly string[]` | `[]` / `[]` | 替换或排除 preset 插件。 |
| `authorizeCapability` / `mapLibre` | `CapabilityAuthorizer` / `MapLibreIntegrationOptions` | 未设置 | Agent 授权和 MapLibre 配置。 |

## 从这里开始

1. [安装](./getting-started/installation.md)。
2. [第一张地图](./getting-started/quick-start.md)。
3. [核心概念](./concepts/overview.md)。
4. 按任务查阅[样式](./guides/styling.md)、[选择](./guides/selection.md)、[编辑](./guides/editing.md)和[数据操作](./data/operations.md)。
5. [技术架构](./concepts/architecture.md)。
6. 给 AI 编程助手使用的站点索引：[llms.txt](pathname:///llms.txt)（[在线查看](pathname:///llms.html)）。

## 可运行示例

- [示例集](/mapseekai/emap/examples/)

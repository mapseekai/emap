---
id: faq
slug: /reference/faq
title: FAQ
api: ["Emap", "MapOptions", "TopologySource", "SourceLoadError"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.14.0
---

# FAQ

配置地图显示、加载本地与远程数据，并启用格式插件和后台处理的常用方法。

```ts
const source = await TopologySource.fromUrl('roads', '/data/roads.geojson'); // 从 URL 加载数据
await map.addSource('roads', source); // 以同一 ID 注册数据源
map.setExtent(source.getExtent()); // 适配数据范围
```

## 核心问题

### 如何设置地图显示？

`MapOptions.container` 定位画布挂载点。为它及父级设置非零尺寸并导入 `@mapseekai/emap/style.css`；静态展示设 `interactive: false`。

使用 `TopologySource.fromUrl()` 或 `source.setData()` 加载，以同一 `id` 注册，调用 `map.setExtent(source.getExtent())`，并令 `LayerSpecification.source` 匹配该 `id`；多数据层 source 使用 `'source-layer'`。

### 如何加载自己的文件？

`TopologySource.fromUrl(id, url, options?)` 的 `id` 用于 `map.addSource` 和图层 `source`；跨域 URL 需要 CORS。内存数据使用 `source.setData({ filename, content })`，按扩展名选导入器；文件数组每项为一个 dataset layer。`TopologySource.fromBytes(id, bytes, { filename })` 接受 `ArrayBuffer`，默认文件名为 `${id}.geojson`。

### 如何显示指定图层？

`spec.id` 是唯一图层键，`spec.source` 指定已注册 source，`'source-layer'` 选择数据 layer。点用 `'circle'`，线和边界用 `'line'`，面填充用 `'fill'`；`'visible'` 渲染图层，`before` 控制顺序。

## 更多数据格式

`arrowFormatsPlugin` 向 `map.formats` 注册 Arrow 和 GeoParquet 扩展名。`setData()` 按文件名导入，`export()` 支持 `'geoparquet'` 和 `'geoarrow'`。Arrow 入口需要 `apache-arrow`，GeoParquet 还需要 `parquet-wasm`。

用 `createDuckDbRuntimeFromJsDelivr(options?)` 创建 DuckDB；`spatialExtensionUrls` 提供自托管扩展 WASM。`queryGeoParquetWithDuckDb()` 接收数据、必填 SQL 和 runtime；`geometryColumn` 选几何列，`layerName` 默认 `'layer'`，`noTopology` 用于仅展示。需要 `@duckdb/duckdb-wasm` 和 `apache-arrow`；见[兼容性](./compatibility.md)。

## 更多后台处理

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `useWorker` | `boolean \| 'auto'` | `false` | dataset 替换的 Worker 路由。 |
| `workerThreshold` | `number` | `50000` | `'auto'` Worker 阈值。 |
| `workerUrl` | `string` | `'emap-worker.js'` | 相对 `document.baseURI` 的 bundle URL。 |
| `workerPoolSize` | `number` | `1` | 维护的 Worker 数。 |
| `workerRouting` | `WorkerRoutingFn` | 引擎路由 | 自定义 `'auto'` 路由。 |

发布 `emap-worker.js` 和同目录 `mapshaper-vendor.js`。

## 更多错误处理

`MapshaperOps` 返回 `OpResult<T>`：成功读取 `value`，失败按 `error.kind` 分支。错误包含目标 ID、校验字段、DuckDB 详情或 mapshaper 原因；`SourceLoadError` 包含诊断代码、级别、消息和可选 CRS 恢复值。

## API

- [src.Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [src.TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [src.SourceLoadError](/mapseekai/emap/api/classes/emap.SourceLoadError.html)

## 可运行示例

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [web-worker](/mapseekai/emap/examples/web-worker/)

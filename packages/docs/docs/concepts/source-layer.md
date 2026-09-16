---
id: source-layer
slug: /concepts/source-layer
title: 数据源与图层
api: ["CirclePaint", "DatasetFormatPlugin", "Emap", "ExportedFormatFile", "ExportFormat", "ExportOptions", "FillPaint", "ITopologySource", "LayerLayout", "LayerPaint", "LayerSpecification", "LayerType", "LinePaint", "ReadySourceLoadPlan", "registerFormat", "ReplaceableTopologySource", "resolvePointStyle", "resolveStrokeStyle", "SourceLoadAnswers", "SourceLoadDiagnostic", "SourceLoadDiagnosticCode", "SourceLoadDraft", "SourceLoadError", "SourceLoadRequest", "SourceLoadRequirement", "SourceLoadSummary", "SourcePreflightResult", "TopologySource", "TopologySource.fromBytes", "TopologySource.fromUrl", "TopologySourceData", "TopologySourceFromBytesOptions", "TopologySourceInput", "TopologySourceOptions", "ImportResourceLimits", "ZipExtractionLimits"]
examples: ["getting-started/geojson-viewer","getting-started/lines","getting-started/points","merge-layers"]
stability: stable
verifiedVersion: 0.12.0
---

# 数据源与图层

Emap 分离地理数据与显示配置：`TopologySource` 保存 mapshaper dataset，source layer 保存几何和属性，`LayerSpecification` 声明绘制。

```ts
const source = await TopologySource.fromUrl('roads', '/data/roads.geojson'); // 从 URL 导入数据
await map.addSource('roads', source); // 以地图 source ID 登记数据
map.addLayer({ // 为数据声明绘制层
  id: 'roads-line', // 使用唯一 render layer ID
  type: 'line', // 选择线绘制器
  source: 'roads', // 引用登记后的 map source ID
  paint: { 'line-color': '#166534', 'line-width': 1 }, // 设置线样式
});
```

## 核心方法

| API | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `TopologySource.fromUrl(id, url, options?)` | `id: string`、`url: string`、`options: Omit<TopologySourceOptions, 'data'>` | `{}` | 导入 URL；按扩展名或 `Content-Type` 识别格式。 |
| `TopologySource.fromBytes(id, bytes, options?)` | `id: string`、`bytes: Uint8Array \| ArrayBuffer`、`options.filename: string` | `` `${id}.geojson` `` | 从原始字节导入；文件名扩展名选择解析器。 |
| `map.addSource(id, source, answers?)` | `id: string`、`source: TopologySource`、`answers.sourceCrs?: string` | 未设置 | 异步登记 source，必要时归一到地图 CRS。 |
| `map.addLayer(layer, before?)` | `layer: LayerSpecification`、`before?: string` | `before` 未设置 | 同步登记渲染层；后添加层在上方。 |
| `source.setData(data)` | `data: TopologySourceInput` | 必填 | 重新导入；并发调用采用最后发起的加载。 |

`new TopologySource(id, { data })` 以 source 对象 ID 创建并导入数据。`{ filename, content }` 导入单文件；数组将多个文件组成一个 dataset。

### `LayerSpecification`

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 唯一 render layer ID。 |
| `type` | `'fill' \| 'line' \| 'circle'` | 必填 | 绘制器与 `paint` 集合。 |
| `source` / `source-layer` | `string` | `source` 必填；`source-layer` 为首个 source layer | 地图 source 与目标 dataset layer。 |
| `paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | 类型默认样式 | 颜色、宽度、透明度和点标记。 |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | 渲染与拾取开关。 |
| `filter` | `StyleExpression` | 未设置 | 逐要素 boolean MapLibre 子集表达式。 |
| `styleSource` | `'mapshaper'` | 未设置 | 使用烘焙 `fill` / `stroke` 颜色字段。 |
| `pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | `circle` 点密度抽稀。 |

## 更多 source 选项

构造函数、`fromUrl` 和 `fromBytes` 共享 `TopologySourceOptions`；`setData` 复用构造时的导入策略。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `formats` | `FormatRegistryContract` | 独立空注册表 | 插件格式注册表。 |
| `resourceLimits.maxInputBytes` | `number` | 2 GiB | 单次逻辑导入的原始字节上限。 |
| `zipLimits.maxCompressedBytes` / `zipLimits.maxBytes` | `number` | 2 GiB | ZIP 压缩 / 解压累计字节上限。 |
| `zipLimits.maxEntries` / `zipLimits.maxRatio` | `number` | `5000` / `100` | ZIP 条目 / 解压比上限。 |
| `adapter` | `MapshaperAdapter` | 默认 mapshaper 适配器 | 导入、导出、变换和范围计算。 |

## 更多 source 与图层 ID

```ts
await map.addSource('main', source); // 以地图 source ID 登记 source
map.addLayer({ // 引用 dataset 内的指定 source layer
  id: 'district-fill', // 指定 render layer ID
  type: 'fill', // 选择面绘制器
  source: 'main', // 引用 map source ID
  'source-layer': 'districts', // 选择 dataset layer
});
```

| ID | 示例 | 作用域 |
| --- | --- | --- |
| source 对象 ID | `source.id` | `TopologySource`。 |
| 地图 source ID | `main` | `Emap` source 注册表；render layer 与 `map.ops` 的 `source` 必须匹配。 |
| source-layer 名称 | `districts` | dataset 内 layer。 |
| render layer ID | `district-fill` | `Emap` 绘制顺序、事件和可见性。 |

省略 `source-layer` 选择首个 layer；规范 ID 依次匹配 `layer.name`、`layer.id`、位置 ID `layer-N`，也可直接使用精确的 `layer.name` 或 `layer.id`。

## 更多图层样式

```ts
map.addLayer({ // 先绘制面
  id: 'parcel-fill', // 指定面层 ID
  type: 'fill', // 选择面绘制器
  source: 'parcels', // 引用地图 source
  'source-layer': 'parcels', // 选择数据 layer
  paint: { 'fill-color': '#bbf7d0', 'fill-opacity': 0.6 }, // 设置填充
});

map.addLayer({ // 后绘制边线
  id: 'parcel-outline', // 指定线层 ID
  type: 'line', // 选择线绘制器
  source: 'parcels', // 引用同一地图 source
  'source-layer': 'parcels', // 选择同一数据 layer
  paint: { 'line-color': '#166534', 'line-width': 1 }, // 设置边线
});
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `fill-color` / `fill-opacity` | `string \| StyleExpression` / `number` | 主题 muted 色 / `1` | 面填充颜色 / 不透明度。 |
| `line-color` / `line-width` | `string \| StyleExpression` / `number` | 主题 primary 色 / `0.8` | 线或面边界颜色 / 宽度。 |
| `line-dasharray` / `line-dashstyle` | `readonly number[]` / `'solid' \| 'dash' \| 'dot' \| 'dash-dot' \| 'arrow-dot' \| StyleExpression` | 实线 / 空数组时 `'solid'` | 虚线节奏 / 命名线型；`'arrow-dot'` 使用箭头。 |
| `line-arrow-spacing` / `line-arrow-size` | `number` | `32` / `6` | `'arrow-dot'` 箭头间距 / 箭翼长度（CSS 像素）。 |
| `circle-color` / `circle-radius` | `string \| StyleExpression` / `number` | 主题 primary 色 / `4` | 点标记颜色 / 半径。 |
| `circle-fill` / `circle-shape` | `boolean` / `PointMarkerShape \| StyleExpression` | `true` / `'circle'` | 实心或描边 / 点标记形状。 |

缩放范围由 MapLibre service layer 的 `minzoom` / `maxzoom` 配置。

## 加载时确认 CRS

```ts
let result = await map.preflightSource({ id: 'main', source }); // 预检 source
if (result.status === 'needs-input') { // 在 CRS 信息不足时补充答案
  result = await map.preflightSource(result.draft, { sourceCrs: 'EPSG:3857' }); // 以 draft 重试
}
if (result.status === 'ready') await map.confirmSource(result.plan); // 确认一次性 ready 计划
```

| API | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `preflightSource` | `request.id: string`、`request.source?: TopologySource`、`request.input?: TopologySourceInput` | `id` 必填；`source` 与 `input` 二选一 | 预检待登记的 source。 |
| `preflightSource` | `request.sourceOptions`、`request.sourceCrs`、`draft`、`answers.sourceCrs` | `{}`、dataset CRS、重试必填、请求时必填 | 导入选项、显式 CRS、重试草稿和 CRS 答案。 |
| `confirmSource` | `plan: ReadySourceLoadPlan` | 必填 | 确认单次使用的 ready 计划。 |

`ready` 提供 plan、summary 和诊断；`needs-input` 提供 draft 和要求；`rejected` 提供错误诊断。首个 source 建立地图 CRS，后续 source 转换到该 CRS。

## 导出与格式插件

`source.export({ format: 'geojson' })` 返回浏览器 `Blob`。支持 GeoJSON、TopoJSON、Shapefile、MSX、GeoParquet、GeoArrow 和 FlatGeobuf；后两类格式需要对应插件。GeoPackage 仅通过 `@mapseekai/emap/geopackage` 导入，见 [GeoPackage](../data/geopackage.md)。

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [LayerSpecification](/mapseekai/emap/api/types/emap.LayerSpecification.html)
- [ExportOptions](/mapseekai/emap/api/interfaces/emap.ExportOptions.html)

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [线图层](/mapseekai/emap/examples/getting-started/lines/)
- [点图层](/mapseekai/emap/examples/getting-started/points/)
- [合并图层](/mapseekai/emap/examples/merge-layers/)

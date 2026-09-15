---
id: source-layer
slug: /concepts/source-layer
title: 数据源与图层
api: ["CirclePaint", "DatasetFormatPlugin", "Emap", "ExportedFormatFile", "ExportFormat", "ExportOptions", "FillPaint", "ITopologySource", "LayerLayout", "LayerPaint", "LayerSpecification", "LayerType", "LinePaint", "ReadySourceLoadPlan", "registerFormat", "ReplaceableTopologySource", "resolvePointStyle", "resolveStrokeStyle", "SourceLoadAnswers", "SourceLoadDiagnostic", "SourceLoadDiagnosticCode", "SourceLoadDraft", "SourceLoadError", "SourceLoadRequest", "SourceLoadRequirement", "SourceLoadSummary", "SourcePreflightResult", "TopologySource", "TopologySource.fromBytes", "TopologySource.fromUrl", "TopologySourceData", "TopologySourceFromBytesOptions", "TopologySourceInput", "TopologySourceOptions", "ImportResourceLimits", "ZipExtractionLimits"]
examples: ["getting-started/geojson-viewer","getting-started/lines","getting-started/points","merge-layers"]
stability: stable
verifiedVersion: unreleased
---

# 数据源与图层

Emap 将地理数据与显示配置分开。`TopologySource` 保存导入的 mapshaper dataset；dataset 的 source layer 保存几何和属性；render layer 是传给 `map.addLayer` 的 `LayerSpecification`，它声明如何绘制某个 source layer。

## 导入 source

URL、内存字节和文件选择器数据都可导入为 `TopologySource`：

```ts
import { TopologySource } from '@mapseekai/emap';

const roads = await TopologySource.fromUrl('roads', '/data/roads.geojson');

const bytes = await file.arrayBuffer();
const upload = await TopologySource.fromBytes('upload', bytes, {
  filename: file.name,
});
```

`fromBytes` 的 `filename` 决定导入器识别的格式，上传时应保留原始文件名。也可创建 source 后调用 `await source.setData(...)`。source 必须完成首次导入后才能传给 `map.addSource(...)`。

对于不可信或超大输入，可通过 `TopologySourceOptions` 配置 `resourceLimits.maxInputBytes`。`ImportResourceLimits` 默认限制每个逻辑导入请求最多 2 GiB；ZIP 解压相关的独立限制仍由 `ZipExtractionLimits` 控制。

## 四个 ID

```ts
await map.addSource('main', source);
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'main',
  'source-layer': 'districts',
});
```

| ID | 示例 | 作用域 |
| --- | --- | --- |
| source 对象 ID | `source.id` | `TopologySource` |
| 地图 source ID | `main` | `Emap` 的 source 注册表 |
| source-layer 名称 | `districts` | dataset 内的 layer |
| render layer ID | `district-fill` | `Emap` 的绘制顺序、事件和可见性 |

地图 source ID 必须与 render layer 和 `map.ops` 使用的 `source` 一致。单 source-layer dataset 可以省略 `source-layer`；多 layer dataset 应显式指定它。

## 声明如何绘制

`LayerSpecification.type` 支持 `fill`、`line` 和 `circle`。它们分别绘制面、线或面边界、点。

```ts
map.addLayer({
  id: 'parcel-fill',
  type: 'fill',
  source: 'parcels',
  'source-layer': 'parcels',
  paint: { 'fill-color': '#bbf7d0', 'fill-opacity': 0.6 },
});

map.addLayer({
  id: 'parcel-outline',
  type: 'line',
  source: 'parcels',
  'source-layer': 'parcels',
  paint: { 'line-color': '#166534', 'line-width': 1 },
});
```

同一 source layer 可以被多个 render layer 引用。后添加的图层绘制在上方，因此示例中的边界显示在填充之上。点数据使用 `circle`，线和面边界使用 `line`，面填充使用 `fill`。

## 加载时确认 CRS

`map.addSource` 会预检 source。需要向用户询问 CRS 时，使用 `preflightSource` 获取 draft 和要求，再以答案重试；只有 ready plan 可以交给 `confirmSource`。

```ts
let result = await map.preflightSource({ id: 'main', source });
if (result.status === 'needs-input') {
  result = await map.preflightSource(result.draft, { sourceCrs: 'EPSG:3857' });
}
if (result.status === 'ready') await map.confirmSource(result.plan);
```

显式 `sourceCrs` 用于确定导入坐标的 CRS。注册 source 后，数据会与地图的活动 CRS 保持一致。

## 导出与格式插件

`source.export({ format: 'geojson' })` 返回浏览器 `Blob`。支持 GeoJSON、TopoJSON、Shapefile、MSX、GeoParquet、GeoArrow 和 FlatGeobuf；GeoParquet 与 GeoArrow 需要导入 `@mapseekai/emap/arrow`，FlatGeobuf 需要先通过 `registerFormat` 注册格式插件。

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [LayerSpecification](/mapseekai/emap/api/types/emap.LayerSpecification.html)
- [ExportOptions](/mapseekai/emap/api/interfaces/emap.ExportOptions.html)

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [线图层](/mapseekai/emap/examples/getting-started/lines/)
- [点图层](/mapseekai/emap/examples/getting-started/points/)
- [合并图层](/mapseekai/emap/examples/merge-layers/)

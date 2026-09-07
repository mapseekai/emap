---
id: source-layer
slug: /concepts/source-layer
title: 数据源与图层
api: ["CirclePaint","DatasetFormatPlugin","Emap","ExportedFormatFile","ExportFormat","ExportOptions","FillPaint","ITopologySource","LayerLayout","LayerPaint","LayerSpecification","LayerType","LinePaint","ReadySourceLoadPlan","registerFormat","ReplaceableTopologySource","resolvePointStyle","resolveStrokeStyle","SourceLoadAnswers","SourceLoadDiagnostic","SourceLoadDiagnosticCode","SourceLoadDraft","SourceLoadError","SourceLoadRequest","SourceLoadRequirement","SourceLoadSummary","SourcePreflightResult","TopologySource","TopologySource.fromBytes","TopologySource.fromUrl","TopologySourceData","TopologySourceFromBytesOptions","TopologySourceInput","TopologySourceOptions","ZipExtractionLimits"]
examples: ["getting-started/geojson-viewer","getting-started/lines","getting-started/points","merge-layers","rename-layer","split-layer"]
stability: stable
verifiedVersion: 0.8.1
---

# 数据源与图层

Emap 把“保存数据”和“如何绘制数据”分开：

- `TopologySource` 保存导入后的 mapshaper dataset。
- dataset 中的 source layer 保存几何和属性。
- `LayerSpecification` 引用一个 source layer，并声明 Canvas 绘制方式。

这种分离允许同一份几何以多种样式显示，也允许数据操作独立于界面样式执行。

## 创建数据源

### 从 URL 创建

```ts
const source = await TopologySource.fromUrl(
  'roads',
  '/data/roads.geojson',
);
```

### 从字节创建

```ts
const bytes = await file.arrayBuffer();
const source = await TopologySource.fromBytes('upload', bytes, {
  filename: file.name,
});
```

### 预检并确认

```ts
const source = new TopologySource('live');
await source.setData({
  filename: 'districts.geojson',
  content,
});

let result = await map.preflightSource({ id: 'live', source });
if (result.status === 'needs-input') {
  result = await map.preflightSource(result.draft, {
    sourceCrs: selectedCrs,
  });
}
if (result.status === 'ready') {
  await map.confirmSource(result.plan);
}
```

`preflightSource()` 在地图外解析和检查数据，不注册 source，也不改变地图 CRS。
显式 `sourceCrs` 优先于 dataset CRS 元数据；两者都缺失或显式值无效时，结果为
`needs-input`，应用根据 `requirements` 收集 CRS，再用原 `draft` 重跑预检。
`rejected` 表示输入无法加载，只有 `ready` plan 可以交给 `confirmSource()`。

不需要交互时可以直接使用
`await map.addSource('live', source, { sourceCrs: 'EPSG:3857' })`；它复用同一套
预检和确认流程。空 source 不能先注册，必须先完成 `setData()`。注册后的动态
`setData()` 仍会归一到地图 CRS；`TopologySource.reproject()` 不能独立切换
已注册 source 的 CRS，应使用 `map.reproject()`。

## 三种 ID 不要混用

假设一个上传文件包含名为 `districts` 的 source layer：

```ts
await map.addSource('main', source);

map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'main',
  'source-layer': 'districts',
});
```

这里有三个不同标识：

| 标识 | 值 | 作用域 |
|---|---|---|
| `TopologySource` 自身名称 | 创建 source 时传入 | 数据源对象 |
| 地图 source ID | `main` | `Emap` 内，用于图层和操作 |
| source layer 名称 | `districts` | mapshaper dataset 内 |
| 渲染图层 ID | `district-fill` | `Emap` 内，用于顺序、事件和过滤 |

应用可以让前两个名称相同以减少认知负担，但仍应理解它们来自不同层级。

## 选择 source layer

单图层数据通常可以省略 `source-layer`，Emap 会使用第一个与渲染类型兼容的 layer：

```ts
map.addLayer({
  id: 'road-line',
  type: 'line',
  source: 'roads',
});
```

多图层数据应显式指定：

```ts
map.addLayer({
  id: 'primary-roads',
  type: 'line',
  source: 'transport',
  'source-layer': 'primary',
});
```

显式名称也能避免数据文件调整 layer 顺序后渲染到错误内容。

## 渲染类型

`LayerSpecification.type` 有三种：

| 类型 | 典型几何 | 主要 paint |
|---|---|---|
| `fill` | polygon | `fill-color`、`fill-opacity` |
| `line` | polyline 或 polygon 边界 | `line-color`、`line-width` |
| `circle` | point | `circle-color`、`circle-radius` |

示例：

```ts
map.addLayer({
  id: 'cities',
  type: 'circle',
  source: 'main',
  'source-layer': 'cities',
  paint: {
    'circle-color': '#ef4444',
    'circle-radius': 5,
  },
});
```

渲染类型必须与 source layer 几何兼容。点数据不能用 `fill` 显示，面数据的轮廓应使用
`line` 图层。

## 一个 source layer，多种显示方式

```ts
map.addLayer({
  id: 'parcel-fill',
  type: 'fill',
  source: 'parcels',
  paint: {
    'fill-color': '#bbf7d0',
    'fill-opacity': 0.6,
  },
});

map.addLayer({
  id: 'parcel-outline',
  type: 'line',
  source: 'parcels',
  paint: {
    'line-color': '#166534',
    'line-width': 1,
  },
});
```

后添加的图层绘制在更上方，因此这里的边界不会被填充覆盖。选择与要素事件可以按
`parcel-fill` 或 `parcel-outline` 过滤，但二者引用的是同一份 source 几何。

## 数据操作作用于 source

`map.ops` 使用地图 source ID 和可选 layer 名称定位数据，而不是使用渲染图层 ID：

```ts
const result = await map.ops.simplifyLayer({
  source: 'parcels',
  percentage: 0.25,
});

if (!result.ok) {
  console.error(result.error);
}
```

操作成功后，引用该 source 的渲染图层会使用更新后的 dataset 重绘。

## 常见问题

### source 已加载但没有显示

- 确认地图已经调用 `addSource`。
- 确认渲染图层的 `source` 与地图 source ID 一致。
- 多 layer 文件确认 `source-layer` 拼写和大小写。
- 确认 `type` 与几何类型兼容。
- 使用 source extent 设置相机。

### 文件扩展名丢失

从 bytes 或上传文件加载时始终传入原始 `filename`。解析器需要扩展名选择正确导入器。

### 直接修改 dataset 后显示没有同步

`getDataset()`、`getLayers()` 和 `getArcs()` 返回零复制的 TypeScript 深只读视图。
数据变化应通过编辑命令、编辑会话或 `map.ops`，让渲染缓存、选择和历史一起更新。
只读约束位于类型层；JavaScript、`any` 或显式类型断言仍可绕过，因此返回值不是可变入口。

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [ITopologySource](/mapseekai/emap/api/interfaces/emap.ITopologySource.html)
- [LayerSpecification](/mapseekai/emap/api/types/emap.LayerSpecification.html)
- [ExportOptions](/mapseekai/emap/api/interfaces/emap.ExportOptions.html)

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [点图层](/mapseekai/emap/examples/getting-started/points/)
- [合并图层](/mapseekai/emap/examples/merge-layers/)
- [重命名图层](/mapseekai/emap/examples/rename-layer/)
- [拆分图层](/mapseekai/emap/examples/split-layer/)

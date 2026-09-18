---
id: quick-start
slug: /getting-started/quick-start
title: 第一张地图
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.13.0
---

# 第一张地图

完成[安装](./installation.md)后，用一个 GeoJSON source 和两层 render layer 创建交互地图。

```ts
import { Emap, TopologySource } from '@mapseekai/emap'; // 导入地图和数据源
import '@mapseekai/emap/style.css'; // 导入地图样式
const map = await Emap.create({ container: 'map', expressionPolicy: 'disabled' }); // 创建安全的交互地图
const source = await TopologySource.fromUrl('districts', '/data/districts.geojson'); // 加载 GeoJSON
await map.addSource('districts', source); // 注册数据源
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.45 },
}); // 绘制填充
map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: { 'line-color': '#1e3a8a', 'line-width': 1.5 },
}); // 绘制边界
map.setExtent(source.getExtent()); // 适配数据范围
```

## 核心方法

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `Emap.create(options)` | `container`、`expressionPolicy` | 创建地图。 |
| `TopologySource.fromUrl(id, url)` | source ID、数据 URL | 加载 GeoJSON。 |
| `map.addSource(id, source)` / `map.addLayer(layer)` | source ID、图层定义 | 注册和渲染数据。 |
| `map.setExtent(bounds)` | `Bounds` | 适配视图范围。 |

## 更多准备与加载参数

地图容器须已有非零尺寸：

```html
<div id="map" style="width: 100%; height: 480px"></div>
```

`Emap.create` 在 preset 插件就绪后返回地图。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | 浏览器 preset 必填 | 容器元素或 `id`；`headless` 可省略。 |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | 编辑、浏览、纯数据处理或空插件集。 |
| `interactive` | `boolean` | `true` | 拖拽平移和滚轮缩放。 |
| `expressionPolicy` | `'disabled' \| 'trusted'` | `'disabled'` | mapshaper JavaScript 表达式策略。 |
| `plugins` / `excludePlugins` | `readonly Plugin[]` / `readonly string[]` | `[]` / `[]` | 追加/替换或排除 preset 插件。 |
| `authorizeCapability` | `CapabilityAuthorizer` | 未设置 | Agent 能力的宿主授权策略。 |

`fromUrl` 在首次 `data` 事件后完成，可立即注册。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | source 标识。 |
| `url` | `string` | 必填 | 数据 URL；扩展名或 `Content-Type` 选择格式。 |
| `options.formats` | `FormatRegistryContract` | 新建空注册表 | 格式插件注册表。 |
| `options.resourceLimits.maxInputBytes` | `number` | `2 GiB` | 单次导入原始字节上限。 |
| `options.zipLimits.maxCompressedBytes` | `number` | `2 GiB` | Shapefile ZIP 压缩输入上限。 |
| `options.zipLimits.maxBytes` | `number` | `2 GiB` | ZIP 解压总大小上限。 |
| `options.zipLimits.maxEntries` | `number` | `5000` | ZIP 条目数上限。 |
| `options.zipLimits.maxRatio` | `number` | `100` | ZIP 最大解压比。 |
| `options.adapter` | `MapshaperAdapter` | 默认适配器 | mapshaper 执行适配器。 |

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 地图内唯一的 source ID。 |
| `source` | `TopologySource` | 必填 | 已加载 source；注册时预检并按需投影 CRS。 |
| `answers.sourceCrs` | `string` | 未设置 | 缺失 CRS 元数据的坐标系。 |

## 更多图层与视图参数

后添加图层绘制在上方；`source` 引用已注册 source ID。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `layer.id` / `layer.type` / `layer.source` | `string` / `'fill' \| 'line' \| 'circle'` / `string` | 必填 | 唯一图层 ID、渲染器和已注册 source ID。 |
| `layer['source-layer']` | `string` | 未设置 | dataset 内的 source layer。 |
| `layer.paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | 未设置 | 图层样式。 |
| `layer.layout.visibility` | `'visible' \| 'none'` | `'visible'` | 图层显示开关。 |
| `layer.filter` | `StyleExpression` | 未设置 | 要素渲染、拾取和属性视图筛选。 |
| `layer.styleSource` | `'mapshaper'` | 未设置 | 读取烘焙 `fill` 或 `stroke`。 |
| `layer.pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | `circle` 的 CSS 像素网格抽稀。 |
| `before` | `string` | 未设置 | 插入之前的图层 ID。 |

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `'fill-color'` | `string \| StyleExpression` | 主题 muted 色 | 填充色或表达式。 |
| `'fill-opacity'` | `number` | 保留颜色 alpha | 填充不透明度。 |
| `'line-color'` | `string \| StyleExpression` | 主题 primary 色 | 线颜色或表达式。 |
| `'line-width'` | `number` | `0.8` | 线宽。 |
| `'line-dasharray'` | `readonly number[]` | 实线 | 虚线段和间隔（CSS 像素）。 |
| `'line-dashstyle'` | `LineDashStyle \| StyleExpression` | `'solid'` | 命名线型；`arrow-dot` 支持箭头。 |
| `'line-arrow-spacing'` | `number` | `32` | `arrow-dot` 箭头间距（CSS 像素）。 |
| `'line-arrow-size'` | `number` | `6` | `arrow-dot` 箭头翼长（CSS 像素）。 |
| `'circle-color'` | `string \| StyleExpression` | 主题 primary 色 | 点标记颜色或表达式。 |
| `'circle-radius'` | `number` | `4` | 点标记半径（CSS 像素）。 |
| `'circle-fill'` | `boolean` | `true` | 点标记填充开关。 |
| `'circle-shape'` | `PointMarkerShape \| StyleExpression` | `'circle'` | 点标记形状或表达式。 |

| 方法/参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `map.setExtent(bounds).bounds` | `Bounds` | 必填 | 视图数据范围。 |
| `map.fitBounds(bounds, options).bounds` | `Bounds` | 必填 | 居中并缩放的范围。 |
| `options.padding` | `number` | `0` | 四边 CSS 像素留白。 |
| `options.maxScale` | `number` | 未设置 | 拟合最大比例尺。 |
| `options.duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` ms / `Tween.sineInOut` / `true` | 拟合动画时长、缓动和开关。 |

## 更多本地数据与卸载

用户文件通过 `fromBytes` 按文件名识别格式：

```ts
const file = input.files?.[0];
if (!file) throw new Error('Choose a file first');

const source = await TopologySource.fromBytes('upload', await file.arrayBuffer(), {
  filename: file.name,
});
await map.addSource('upload', source);
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | source ID。 |
| `bytes` | `Uint8Array \| ArrayBuffer` | 必填 | 原始文件字节。 |
| `options.filename` | `string` | `` `${id}.geojson` `` | 扩展名选择导入器。 |
| `options.formats`、`resourceLimits`、`zipLimits`、`adapter` | 同 `fromUrl` | 同 `fromUrl` | 继承 `fromUrl` 选项。 |

公开上传应收紧 `zipLimits`；详见[数据源与图层](../concepts/source-layer.md)。移除宿主视图前等待 `dispose()`：

```ts
await map.dispose();
```

## 下一步

- [核心概念](../concepts/overview.md)
- [样式](../guides/styling.md)
- [编辑](../guides/editing.md)

## 可运行示例

- [GeoJSON 查看器示例](/mapseekai/emap/examples/getting-started/geojson-viewer/)

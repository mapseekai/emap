---
id: styling
slug: /guides/styling
title: 样式图层
api: ["ClassificationResult","ClassifyFeaturesOptions","Emap.setPaintProperty","FillPaint","LayerSpecification","LineDashStyle","LinePaint","PointMarkerShape","StyleExpression"]
examples: ["getting-started/lines","getting-started/point-style","getting-started/polygon-fill","getting-started/polygons","attribute-styling"]
stability: stable
verifiedVersion: 0.8.1
---

# 样式图层

Emap 的样式模型直接对应 Canvas 绘制基元，只有 `fill`、`line` 和 `circle`
三种图层类型。`fill-color` 支持下文列出的受限 `StyleExpression` 子集，但不追求
完整 MapLibre 样式表达式系统；数据计算和呈现仍保持分离。

## 图层结构

```ts
map.addLayer({
  id: 'route',
  type: 'line',
  source: 'main',
  'source-layer': 'roads',
  layout: {
    visibility: 'visible',
  },
  paint: {
    'line-color': '#335c99',
    'line-width': 2,
  },
});
```

字段含义：

| 字段 | 说明 |
|---|---|
| `id` | 地图内唯一且稳定的渲染图层 ID |
| `type` | `fill`、`line` 或 `circle` |
| `source` | 已通过 `map.addSource` 注册的地图 source ID |
| `source-layer` | 多图层 dataset 中的 source layer 名称 |
| `layout.visibility` | `'visible'` 或 `'none'` |
| `paint` | 与图层类型对应的绘制属性 |

添加图层前必须先注册 source，否则 `addLayer` 会抛出 “Source not found”。
重复的图层 ID 也会抛错。

## 面填充

`fill` 用于 polygon source layer：

```ts
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'main',
  paint: {
    'fill-color': '#60a5fa',
    'fill-opacity': 0.55,
  },
});
```

| 属性 | 类型 | 说明 |
|---|---|---|
| `fill-color` | `string \| StyleExpression` | Canvas 可识别的颜色字符串，或受支持的属性表达式 |
| `fill-opacity` | `number` | 透明度，通常使用 `0` 到 `1` |

需要单独控制面边界时，再添加一个引用同一 source layer 的 `line` 图层。

## 线和面边界

`line` 用于 polyline，也可以描绘 polygon 边界：

```ts
map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'main',
  paint: {
    'line-color': '#1e3a8a',
    'line-width': 1.5,
    'line-dasharray': [8, 4],
  },
});
```

| 属性 | 类型 | 说明 |
|---|---|---|
| `line-color` | `string` | Canvas 可识别的颜色字符串，默认为 `#1e88e5` |
| `line-width` | `number` | 线宽，默认为 `0.8`；设置为 `0` 时不绘制描边 |
| `line-dasharray` | `number[]` | 交替的实线和间隔长度，例如 `[8, 4]`；省略或传空数组时绘制实线 |
| `line-dashstyle` | `solid \| dash \| dot \| dash-dot \| arrow-dot` | 命名线型；`arrow-dot` 用重复方向箭头替代点划线中的点 |
| `line-arrow-spacing` | `number` | `arrow-dot` 箭头间距，CSS 像素，默认 `32` |
| `line-arrow-size` | `number` | `arrow-dot` 箭头大小，CSS 像素，默认 `6` |

线宽和虚线长度以 CSS 像素为单位，并随当前渲染变换得到适合 Canvas 的宽度。

方向箭头默认遵循坐标顺序。polyline 从第一个顶点指向最后一个顶点；polygon
外环和内环分别遵循各自的坐标顺序。当前样式模型没有方向翻转字段。

```ts
map.addLayer({
  id: 'direction-flow',
  type: 'line',
  source: 'main',
  paint: {
    'line-color': 'rgba(37, 99, 235, 0.85)',
    'line-width': 2,
    'line-dashstyle': 'arrow-dot',
    'line-arrow-spacing': 32,
    'line-arrow-size': 6,
  },
});
```

箭头在当前可见视野中按屏幕像素采样，缩放和高 DPI 下保持稳定大小；普通
`line-dasharray` 数组仍走原有 Canvas 虚线批处理路径。

## 点图层

`circle` 用于 point source layer：

```ts
map.addLayer({
  id: 'city',
  type: 'circle',
  source: 'main',
  'source-layer': 'cities',
  paint: {
    'circle-color': '#ef4444',
    'circle-radius': 5,
    'circle-shape': 'star',
    'circle-fill': true,
  },
});
```

`circle-radius` 默认为 `4`，`circle-shape` 默认为 `circle`，还支持 `square`、
`triangle`、`triangle-down`、`diamond`、`pentagon`、`star`、`cross`、`x`、
`hexagon` 和 `octagon`。`circle-fill` 默认为 `true`，将其设为 `false`
可以只绘制形状轮廓。

## 图层顺序

后添加的图层绘制在更上方。可以在添加时指定 `before`：

```ts
map.addLayer(labelLayer, 'district-outline');
```

也可以在之后移动：

```ts
map.moveLayer('district-fill', 'district-outline');
```

`before` 对应的图层不存在时，`addLayer` 会抛错；`moveLayer` 则把目标图层移到末尾。

## 运行时更新

更新单个 paint 属性：

```ts
map.setPaintProperty('district-fill', 'fill-opacity', 0.3);
map.setPaintProperty('district-outline', 'line-color', '#0f172a');
```

切换可见性：

```ts
map.setLayerVisibility('district-fill', 'none');
map.setLayerVisibility('district-fill', 'visible');
```

移除图层：

```ts
map.removeLayer('district-outline');
```

这些方法会安排下一次渲染。不要直接修改 `map.getLayer(...)` 返回对象来刷新界面。

## 属性驱动样式

自 0.9.0 起，fill / line / circle 图层都支持属性驱动颜色，均为**显式 opt-in**，
不改变未声明图层的任何行为。

### classifyFeatures：分级烘焙

`classifyFeatures` 按字段与方法（`quantile` / `equal-interval` / `nice` /
`categorical` 等）计算断点，把颜色**烘焙**到每条记录的 `fill` 字段：

```ts
const result = await map.ops.classifyFeatures({
  source: 'cities',
  target: 'cities',
  field: 'pop',
  method: 'equal-interval',
  classes: 4,
  colors: ['#eff3ff', '#bdd7e7', '#6baed6', '#2171b5'],
  nullValue: '#eeeeee', // 可选：null/缺失记录的填充色
});
if (result.ok) {
  // 判别联合：显式断点（breaks）与自动方法（breaks）返回不同形态，
  // 计数与类别数满足 classes === colors.length === breaks.length + 1。
  console.log(result.value.breaks, result.value.counts);
}
```

`classifyFeatures` 可通过 `saveAs` 指定烘焙字段。颜色渲染使用与 mapshaper 兼容的
`fill` / `stroke`：fill 与 circle 读取 `fill`，line 读取 `stroke`。烘焙是普通的
可撤回 op：undo 恢复全部记录原值。

### styleSource opt-in：渲染烘焙字段

图层加 `styleSource: 'mapshaper'` 后，渲染器按几何类型读取每条记录烘焙的颜色：
fill / circle 读取 `fill`，line 读取 `stroke`；未声明 `styleSource` 的图层完全不读记录字段：

```ts
map.addLayer({
  id: 'cities-fill',
  type: 'fill',
  source: 'cities',
  'source-layer': 'cities',
  styleSource: 'mapshaper',
});
```

优先序：显式标量 `fill-color` / `line-color` / `circle-color` paint 永远胜出
（声明了静态色的图层不会被 `styleSource` 劫持）；无标量 paint 时才读烘焙字段。

### paint 表达式子集

`fill-color`、`line-color` 和 `circle-color` 都接受同一套表达式子集（无需预先烘焙）：

```ts
map.addLayer({
  id: 'cities-choropleth',
  type: 'fill',
  source: 'cities',
  paint: {
    'fill-color': ['match', ['get', 'level'], 'a', '#111111', '#999999'],
    // 或连续：['interpolate', 'linear', ['get', 'pop'], 0, '#000000', 100, '#ffffff']
    // 或分档：['step', ['get', 'pop'], '#eff3ff', 25, '#bdd7e7', 50, '#6baed6']
  },
});
```

支持的算子：`get`、`match`、`step`、`interpolate`（`linear`）。表达式在
`addLayer` / `setPaintProperty` 时同步校验，非法表达式直接抛错；单条记录求值
异常隔离到主题色 null 桶，不影响其余要素渲染。类别数超过 256 时照常渲染并
触发 `warning` 事件。

性能：表达式结果按 （表达式, 数据集引用, attributeVersion) 缓存，几何编辑
（顶点级）不触发重算。实测 10 万记录冷构建约 4ms，缓存命中接近 0。

## 默认颜色

未设置颜色时使用 `#1e88e5`。生产应用应显式设置颜色，避免不同几何类型因为共享默认值
而难以区分。

## 常见问题

### 图层存在但不可见

- 检查 `layout.visibility` 是否为 `'none'`。
- 检查 source 和 `source-layer` 是否正确。
- 检查 `type` 是否与几何类型兼容。
- 检查相机是否位于数据范围。
- 检查上层不透明填充是否覆盖当前图层。

### 属性驱动样式

fill / line / circle 图层都支持颜色表达式与烘焙字段 opt-in，见上文「属性驱动样式」。
其中 fill 与 circle 的 `styleSource` 读取 `fill`，line 读取 `stroke`。

## API

- [FillPaint](/mapseekai/emap/api/interfaces/emap.FillPaint.html)
- [LinePaint](/mapseekai/emap/api/interfaces/emap.LinePaint.html)
- [CirclePaint](/mapseekai/emap/api/interfaces/emap.CirclePaint.html)
- [LayerSpecification](/mapseekai/emap/api/interfaces/emap.LayerSpecification.html)

## 可运行示例

- [线图层样式（颜色、宽度和虚线）](/mapseekai/emap/examples/getting-started/lines/)
- [面图层](/mapseekai/emap/examples/getting-started/polygons/)
- [面填充](/mapseekai/emap/examples/getting-started/polygon-fill/)
- [面属性驱动样式（classifyFeatures 烘焙与 fill-color 表达式）](/mapseekai/emap/examples/attribute-styling/)
- [线属性驱动样式](/mapseekai/emap/examples/attribute-styling-line/)
- [点属性驱动样式](/mapseekai/emap/examples/attribute-styling-point/)

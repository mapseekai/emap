---
id: styling
slug: /guides/styling
title: 样式图层
api: ["ClassificationResult", "ClassifyFeaturesOptions", "Emap.setPaintProperty", "FillPaint", "LayerSpecification", "LineDashStyle", "LinePaint", "PointMarkerShape", "StyleExpression", "Emap", "CirclePaint"]
examples: ["getting-started/lines","getting-started/point-style","getting-started/polygon-fill","getting-started/polygons","attribute-styling"]
stability: stable
verifiedVersion: 0.12.0
---

# 样式图层

Emap 渲染 `fill`、`line`、`circle` 图层；图层引用 source 和可选 `source-layer`，后添加者绘制在上方。


```ts
map.addLayer({ // 添加面填充图层
  id: 'parcel-fill', // 图层唯一 ID
  type: 'fill', // 绘制面
  source: 'parcels', // 已添加的 source ID
  'source-layer': 'lots', // 要渲染的数据图层
  paint: { 'fill-color': '#4c956c', 'fill-opacity': 0.35 }, // 填充外观
});

map.addLayer({ // 添加面轮廓图层
  id: 'parcel-outline', // 图层唯一 ID
  type: 'line', // 绘制路径和轮廓
  source: 'parcels', // 已添加的 source ID
  'source-layer': 'lots', // 要渲染的数据图层
  paint: { 'line-color': '#1d3557', 'line-width': 2, 'line-dasharray': [6, 3] }, // 线条外观
});

map.addLayer({ // 添加点标记图层
  id: 'stations', // 图层唯一 ID
  type: 'circle', // 绘制点标记
  source: 'stations', // 已添加的 source ID
  paint: { 'circle-color': '#e76f51', 'circle-radius': 6, 'circle-fill': true }, // 标记外观
});
```

## 核心参数

`LayerSpecification` 按图层类型组合字段：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 图层唯一标识。 |
| `type` | `'fill' \| 'line' \| 'circle'` | 必填 | `fill` 绘制面，`line` 绘制路径和轮廓，`circle` 绘制点标记。 |
| `source` | `string` | 必填 | 已添加 source 的 ID。 |
| `source-layer` | `string` | source 的第一个数据图层 | 要渲染的数据图层；名称、ID 或 `layer-N`。 |
| `paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | 各字段默认值见下表 | 图层绘制属性。 |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | 是否参与渲染。 |
| `filter` | `StyleExpression` | 未设置 | `true` 的要素参与渲染、拾取和属性筛选。 |
| `styleSource` | `'mapshaper'` | 未设置 | 启用烘焙颜色：fill、circle 读 `fill`，line 读 `stroke`。 |
| `pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | 仅 `circle`：CSS 像素网格代表点；`false` 绘制全部，`cellSize` 为 1–64。 |

## 更多绘制属性

### line paint

`line` 使用以下 `LinePaint` 字段，也作为 fill 轮廓样式。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `line-color` | `string \| StyleExpression` | `var(--emap-primary)` | 线颜色，fill 中为面轮廓色；表达式按记录分桶。 |
| `line-width` | `number` | `0.8` | 线宽（CSS 像素）；fill 轮廓为 `0` 时纯填充。 |
| `line-dasharray` | `readonly number[]` | 未设置 | 交替实线和间隔长度（CSS 像素）。 |
| `line-dashstyle` | `LineDashStyle \| StyleExpression` | 有 `line-dasharray` 时为 `'dash'`，否则为 `'solid'` | 命名图案，优先于 `line-dasharray`；`arrow-dot` 绘制方向箭头；表达式结果须为 `LineDashStyle`。 |
| `line-arrow-spacing` | `number` | `32` | `arrow-dot` 箭头间距（CSS 像素），最小 4。 |
| `line-arrow-size` | `number` | `6` | `arrow-dot` 箭头翼长度（CSS 像素），最小 2。 |

`LineDashStyle`：`'solid'`、`'dash'`、`'dot'`、`'dash-dot'`、`'arrow-dot'`。fill 轮廓读取静态 `line-color` 和 `line-dashstyle`。

### fill paint

`fill` 在共享 `line-*` 轮廓之外增加内部填充：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `fill-color` | `string \| StyleExpression` | `var(--emap-muted)` | 面颜色；表达式按记录分桶。 |
| `fill-opacity` | `number` | `1` | 颜色 alpha 乘数，绘制时钳制为 0–1。 |

### circle paint

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `circle-color` | `string \| StyleExpression` | `var(--emap-primary)` | 标记颜色；表达式按记录分桶。 |
| `circle-radius` | `number` | `4` | 标记半径（CSS 像素）。 |
| `circle-fill` | `boolean` | `true` | 是否填充标记内部。 |
| `circle-shape` | `PointMarkerShape \| StyleExpression` | `'circle'` | Canvas 标记形状；表达式结果须为 `PointMarkerShape`。 |

`PointMarkerShape`：`'circle'`、`'square'`、`'triangle'`、`'triangle-down'`、`'diamond'`、`'pentagon'`、`'star'`、`'cross'`、`'x'`、`'hexagon'`、`'octagon'`。

## 更多图层操作

```ts
map.setPaintProperty('parcel-fill', 'fill-opacity', 0.6);
map.setPaintProperty('parcel-outline', 'line-width', 3);
map.setLayerVisibility('stations', 'none');
```

`map.setPaintProperty(id, name, value)` 更新已添加图层 `id` 的 paint 属性 `name`；`value` 须匹配属性类型。`map.moveLayer(id, beforeId)` 调整顺序；省略 `beforeId` 移到顶部。

## 属性驱动样式

颜色字段和 `line-dashstyle`、`circle-shape` 接受 `StyleExpression`；枚举外结果保留静态值。表达式设置时校验，并按记录求值。

### 表达式形式

`StyleExpression` 是无 `eval` 的数组子集，可组合字符串、数字、布尔、`null` 和下列形式。

| 运算符 | 允许形式 | 行为 |
| --- | --- | --- |
| `get` | `['get', field]` | 读取字段；缺失为 `null`。 |
| `==`、`!=` | `['==', left, right]`、`['!=', left, right]` | 严格相等比较。 |
| `<`、`<=`、`>`、`>=` | `['>', left, right]` 等 | 两侧转为数字。 |
| `!` | `['!', value]` | 反转真值。 |
| `all`、`any` | `['all', condition, ...]`、`['any', condition, ...]` | 组合条件。 |
| `match` | `['match', input, caseValue \| [caseValue, ...], output, ..., fallback]` | 严格匹配；末项为回退输出。 |
| `step` | `['step', input, output0, stop1, output1, ...]` | 有限递增 stop；非数值和首个 stop 以下用 `output0`。 |
| `interpolate` | `['interpolate', 'linear', input, stop1, output1, stop2, output2, ...]` | 至少两组有限递增 stop；线性插值，越界用端点，静态颜色至多 257 值。 |

```ts
map.setPaintProperty('parcel-fill', 'fill-color', [
  'match', ['get', 'zone'],
  'residential', '#8ecae6',
  'industrial', '#ffb703',
  '#adb5bd',
]);
```

### 属性分级填充桶

`map.ops.classifyFeatures()` 将分类颜色烘焙到记录字段；fill 图层的 `styleSource: 'mapshaper'` 从该字段建桶。默认 `saveAs: 'fill'` 对应 fill 读取字段。

```ts
await map.ops.classifyFeatures({
  source: 'parcels',
  target: 'lots',
  field: 'assessedValue',
  method: 'quantile',
  classes: 5,
  colors: ['#eff3ff', '#bdd7e7', '#6baed6', '#2171b5', '#08306b'],
});

map.addLayer({
  id: 'parcel-buckets',
  type: 'fill',
  source: 'parcels',
  'source-layer': 'lots',
  styleSource: 'mapshaper',
  paint: { 'fill-opacity': 0.7, 'line-color': '#fff', 'line-width': 0.5 },
});
```

`ClassifyFeaturesOptions` 参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | 必填 | 目标数据图层所在 source ID。 |
| `target` | `string` | 必填 | 待分类数据图层名称或 ID。 |
| `field` | `string` | 必填 | 分类属性字段。 |
| `method` | `'quantile' \| 'equal-interval' \| 'nice' \| 'categorical'` | 必填 | 前三种计算数值断点；`categorical` 映射类别。 |
| `classes` | `number` | `4` | 数值类别数；无 `breaks` 时为不小于 2 的整数。 |
| `breaks` | `number[]` | 按 `method` 计算 | 数值内部断点；提供后直接使用。 |
| `categories` | `(string \| number)[]` | 记录中首次出现顺序的去重值 | `categorical` 类别清单。 |
| `colors` | `string[]` | 必填 | 数值方法为 `breaks.length + 1`；类别方法为 `categories.length`。 |
| `saveAs` | `string` | `'fill'` | 每条记录的颜色字段；line 用 `'stroke'`。 |
| `nullValue` | `string` | `var(--emap-muted)` | `null` 或 `undefined` 的烘焙颜色。 |
| `otherColor` | `string` | `nullValue` | `categories` 外类别的颜色。 |
| `invert` | `boolean` | `false` | 反转烘焙颜色坡度。 |

成功结果的 `value` 包含实际 `breaks` 或 `categories`、`colors`、各类 `counts`、`nullColor`、`nullCount`、`saveAs`、`featureCount`；类别结果还包含 `otherColor`、`otherCount`。

## 可运行示例

- [面填充](/mapseekai/emap/examples/getting-started/polygon-fill/)
- [线样式](/mapseekai/emap/examples/getting-started/lines/)
- [属性样式](/mapseekai/emap/examples/attribute-styling/)

---
id: styling
slug: /guides/styling
title: 样式图层
api: ["SymbolStyle", "SymbolLayout", "SymbolPaint", "SymbolImage", "SymbolLabeling", "SymbolIconSettings", "Emap.setLayerSymbol", "Emap.removeLayerSymbol", "Emap.setSymbolLayoutProperty", "Emap.setSymbolPaintProperty", "IconOptions", "Emap.setLayerIcon", "LabelOptions", "Emap.setLayerLabel", "ClassificationResult", "ClassifyFeaturesOptions", "Emap.setPaintProperty", "FillPaint", "LayerSpecification", "LineDashStyle", "LinePaint", "PointMarkerShape", "StyleExpression", "Emap", "CirclePaint"]
examples: ["getting-started/lines","getting-started/point-style","getting-started/polygon-fill","getting-started/polygons","attribute-styling"]
stability: stable
verifiedVersion: 0.14.0
---

# 样式图层

Emap 支持 `fill`、`line`、`circle` 图层、属性驱动样式，以及附属文字和图片符号；图层引用 source 和可选 `source-layer`，后添加者绘制在上方。


```ts
map.addLayer({
  // 添加面填充图层
  id: 'parcel-fill', // 图层唯一 ID
  type: 'fill', // 绘制面
  source: 'parcels', // 已添加的 source ID
  'source-layer': 'lots', // 要渲染的数据图层
  paint: { 'fill-color': '#4c956c', 'fill-opacity': 0.35 }, // 填充外观
});

map.addLayer({
  // 添加面轮廓图层
  id: 'parcel-outline', // 图层唯一 ID
  type: 'line', // 绘制路径和轮廓
  source: 'parcels', // 已添加的 source ID
  'source-layer': 'lots', // 要渲染的数据图层
  paint: { 'line-color': '#1d3557', 'line-width': 2, 'line-dasharray': [6, 3] }, // 线条外观
});

map.addLayer({
  // 添加点标记图层
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
  'match',
  ['get', 'zone'],
  'residential',
  '#8ecae6',
  'industrial',
  '#ffb703',
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

## 绑定式文字注记

`label` 将文字直接附属于现有 `circle`、`line`、`fill` 图层，共用父图层的树节点。
关闭父图层可见性、设置过滤器或移除父图层时，注记同步更新。

```ts
map.addLayer({
  id: 'city-points', source: 'cities', type: 'circle',
  paint: { 'circle-radius': 5 },
  label: { field: 'name', fontSize: 16, color: '#243447', haloWidth: 2 },
});
map.setLayerLabel('city-points', {
  field: 'name', fontSize: 18, allowOverlap: false,
  priority: ['get', 'population'],
});
map.setLayerLabel('city-points', null); // 移除注记，不移除城市图层
```

`setLayerLabel` 替换整个配置。`field` 与 `text` 二选一，后者支持字符串或已有的安全
样式表达式子集。空值不显示；字号和描边使用 CSS 像素，`offset` 是像素偏移。
点注记尝试周边位置，线注记整体沿线旋转且保持正向，面注记使用排除孔洞的内部锚点。
`placement: 'horizontal'` 使线注记保持水平。当前排布以完整文字串为单位，支持上述点、线、面锚点；
逐字曲线、引线、规则式注记和 QGIS PAL 排布需由应用另行集成。面锚点位于有效面内，文字矩形可延伸至面外。

Canvas2D 支持该配置；luma 分支在现有 GPU RenderPass 中批量绘制字体图集。
本地 `luma-benchmark`、`luma-25d` 和 `luma-vertex-editing` 示例包含父图层注记面板。
未启用时不建立字体图集/注记索引；已启用时跨图层避让，最多显示 2,000 条/视图，
默认 1,000 条/图层，候选最多 20,000。预算外候选不参与优先级全局比较。
文字图集最多四张 1024×1024 RGBA 纹理，CPU/GPU 各约 16 MiB 上限，不含源索引。
luma 路径采用 HarfBuzz 排版和按字形共享的 RGB MSDF，颜色与描边由 GPU 计算。
默认使用自托管 Noto 子集；自定义字体通过 `label.fontUrl` 提供 TTF/OTF/WOFF1。
字号、颜色和 DPR 的常规变化复用字形，异常宽描边可能需要更宽的距离范围档。
手势快照期间文字仍暂随旧画面变换，停止后刷新；Canvas2D 路径保留兼容绘制。

## 点图层的图片符号

`icon` 为现有 `circle` 图层设置图片点符号，共用父图层的树节点。
父图层显隐、过滤、原有点聚合和绑定注记保持不变。

```ts
map.setLayerIcon('city-points', {
  url: '/images/pin.png', size: 32, anchor: [0.5, 1],
  rotation: 0, offset: [0, -2], opacity: 1,
});
map.setLayerIcon('city-points', null); // 恢复普通点符号。
```

数字尺寸为 CSS 像素高度并保持宽高比；`[width,height]` 显式设置两维。
`rect: [x,y,width,height]` 可裁剪共享图集，`tint` 可将原图 alpha 蒙版着色。
支持 PNG/JPEG/WebP、自包含 SVG 和本地图片；图标加载失败保留普通点并报告错误。
luma 后端复用原点/LOD 缓冲，Canvas2D 也支持该配置。
图片配置以图层为单位，拾取沿用点图层规则，密度显示沿用 PointLod；逐要素图片映射、alpha 像素拾取和带数量聚类需由应用另行实现。
## 统一的附属 Symbol 样式

推荐将文字和图标配置放入父图层的 `symbol.layout / symbol.paint`。属性名借鉴 MapLibre，
底层映射到现有 label/icon，共用父图层节点和渲染器。`type` 使用 circle/line/fill。

```ts
map.addLayer({
  id: 'poi', type: 'circle', source: 'poi',
  paint: { 'circle-radius': 4, 'circle-color': '#2563eb' },
  symbol: {
    images: { marker: { url: '/images/marker.png', size: [24, 32] } },
    layout: {
      'icon-image': 'marker', 'icon-size': 1, 'icon-anchor': 'bottom',
      'text-field': ['get', 'name'], 'text-size': 14,
      'text-offset': [0, 1.2], 'text-allow-overlap': false,
    },
    paint: {
      'icon-opacity': 1, 'text-color': '#243447',
      'text-halo-color': '#ffffff', 'text-halo-width': 1.5,
    },
  },
});
map.setSymbolLayoutProperty('poi', 'text-size', 20);
map.setSymbolPaintProperty('poi', 'icon-opacity', 0.6);
map.setSymbolLayoutProperty('poi', 'text-offset', null);
map.removeLayerSymbol('poi'); // 同时去掉附属文字/图标，保留父图层
// map.setLayerSymbol('poi', null); // 等价写法
```

`text-offset` 单位为 em，随 text-size 换算为像素；`icon-size` 是 images 中 size 的倍率。
图片 size 由应用显式指定基准 CSS 尺寸：数字表示等比高度，数组表示宽高。
icon-offset 先乘倍率再随 icon-rotate 旋转，icon-anchor 使用 center/bottom/top-left 等九种名称。
`symbol.layout.visibility` 仅开关附属符号，父图层 visibility 仍控制整个图层。

支持 text-field/size/font/offset/allow-overlap/padding，icon-image/size/anchor/rotate/offset，
text-color/halo-color/halo-width 和 icon-opacity/color。text-font 当前为单一字体名称数组。
QGIS 风格的高级文字注记设置放在 `symbol.labeling`：placement、priority、maxLabels、
minScale、maxScale、fontUrl、fontWeight、fontStyle、enabled。图标仅有的原生兼容项放在
`symbol.icon`：enabled 和自定义归一化 anchor；常规锚点继续使用 `icon-anchor`。

使用上面列出的属性配置附属符号；完整 MapLibre Style、sprite/glyphs 服务、样式过渡和
逐要素颜色/字号/图标表达式需使用相应的外部样式集成。附属符号复用 placement、点 LOD、图片 alpha 蒙版与 MSDF。
校验器对列表外的属性明确报错，并保留原始配置。
`setLayerSymbol` 替换整个对象；`removeLayerSymbol` 与 `setLayerSymbol(id, null)` 等价。
单属性接口的 null/undefined 删除该值并恢复默认。

旧 label/icon 接口继续工作；symbol 存在时是权威配置，旧 setter 会同步更新对应 symbol 通道，
保留另一通道。`getLayer()` 会返回 symbol 深拷贝及已映射的 label/icon 兼容视图。

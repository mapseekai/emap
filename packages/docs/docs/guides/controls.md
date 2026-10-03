---
id: controls
slug: /guides/controls
title: 控件
api: ["BasemapControl", "BasemapOptions", "BasemapStyle", "BoxSelectControl", "BoxSelectControlOptions", "Control", "ControlPosition", "DrawFeatureControl", "DrawFeatureControlOptions", "EditToolbar", "EditToolbarOptions", "Emap", "GetScaleMetricsOptions", "HistoryControl", "HistoryControlOptions", "LassoSelectControl", "LassoSelectControlOptions", "LayerChangeEvent", "LayerChangeReason", "LayerControl", "MapLibreBasemapService", "MapLibreIntegrationOptions", "MapLibreOverlayService", "MapLibreOverlayServiceBase", "MapLibreOverlayResourceService", "MapLibreOverlayStyleService", "MapLibreServiceChangeEvent", "MapLibreServiceChangeReason", "MapLibreServiceErrorEvent", "MapLibreServiceEventMap", "MapLibreServiceManager", "MapLibreServiceState", "MapOptions", "MeasureControl", "MeasureControlOptions", "MeasureHandler", "MeasurementMode", "MeasureOptions", "MeasureResult", "NavigationControl", "NavigationOptions", "ScaleCalculationMethod", "ScaleControl", "ScaleControlOptions", "ScaleControlStyle", "ScaleMetrics", "ScaleViewMetrics", "SimplifyControl", "SimplifyControlOptions", "StatusControl", "StatusOptions", "VertexEditControl", "VertexEditControlOptions"]
examples: ["box-select","china-editing","draw-snap-edge","interaction-handlers","lasso-select","measurement","online-map-services","simplify-control","vertex-editing"]
stability: stable
verifiedVersion: 0.14.0
---

# 控件

Emap 提供导航、比例尺、图层、选择、编辑、测量和历史控件，可挂载到地图四角；控件是可选 DOM 界面，由 `Emap` 集中管理状态和生命周期。

```ts
import '@mapseekai/emap/style.css'; // 加载控件样式
import { HistoryControl, NavigationControl, ScaleControl } from '@mapseekai/emap'; // 导入内置控件

const navigation = new NavigationControl({ showHome: true }); // 创建导航控件
await map.addControl(navigation, 'top-left'); // 挂载到左上角
await map.addControl(new HistoryControl(), 'top-right'); // 挂载撤销/重做控件
await map.addControl(new ScaleControl(), 'bottom-left'); // 挂载比例尺

await map.removeControl(navigation); // 不再需要时移除控件
```

## 核心方法

`addControl(control, position?)` 挂载控件，默认位置为 `'top-left'`；`removeControl(control)` 移除已挂载控件。`control` 实现 `onAdd(map)` 和 `onRemove(map?)`。

## 更多控件与参数

| 控件 | 用途 |
| --- | --- |
| `NavigationControl` | 缩放和重置视图 |
| `StatusControl` | 显示状态文本 |
| `ScaleControl` | 显示基于 CRS 和视图的比例尺 |
| `HistoryControl` | 撤销和重做按钮 |
| `LayerControl` | 切换 Emap 图层可见性 |
| `BasemapControl` | 选择已注册的 MapLibre 底图 |
| `DrawFeatureControl`、`VertexEditControl`、`EditToolbar` | 激活编辑工具 |
| `MeasureControl` | 激活长度或面积测量模式 |
| `BoxSelectControl`、`LassoSelectControl` | 激活选择拖拽工具 |
| `SimplifyControl` | 运行简化操作 |

绘制和测量控件需各自选项：

```ts
await map.addControl(
  new DrawFeatureControl({ source: 'parcels', sourceLayer: 'lots', type: 'polygon' }),
  'top-left',
);
await map.addControl(new MeasureControl({ mode: 'area' }), 'top-left');
```

## 构造参数

### `NavigationControl`

`new NavigationControl(options?)` 提供缩放和复位。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `showZoom` | `boolean` | `true` | 显示缩放按钮。 |
| `showHome` | `boolean` | `true` | 显示重置视图按钮并触发 `reset`。 |
| `className` | `string` | `undefined` | 容器 CSS 类。 |

### `StatusControl`

`new StatusControl(options?)` 显示指针坐标和 CRS。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `showMousePos` | `boolean` | `true` | 显示指针坐标（四位小数）。 |
| `showEPSG` | `boolean` | `true` | 显示并更新当前 EPSG。 |
| `alignment` | `'left' \| 'right' \| 'center'` | `'left'` | 内容对齐。 |
| `className` | `string` | `undefined` | 容器 CSS 类。 |

### `ScaleControl`

`new ScaleControl(options?)` 显示随视图和 CRS 更新的比例尺。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `units` | `'metric' \| 'imperial' \| 'dual'` | `'metric'` | 比例尺单位；`'dual'` 显示两种单位。 |
| `calculationMethod` | `'top' \| 'center' \| 'bottom' \| 'average' \| 'equator'` | `'center'` | 米/像素的视图位置或聚合方式。 |
| `maxWidth` | `number` | `140` | 距离条最大 CSS 像素宽度。 |
| `dpi` | `number` | `96` | 比例分母的显示 DPI。 |
| `showScale` | `boolean` | `true` | 显示比例分母和距离条。 |
| `showZoom` | `boolean` | `true` | 显示缩放级别。 |
| `style` | `'checker' \| 'line' \| 'ruler' \| 'steps' \| 'solid' \| 'minimal'` | `'checker'` | 距离条样式。 |
| `className` | `string` | `undefined` | 容器 CSS 类。 |

### `HistoryControl`

`new HistoryControl(options?)` 提供撤销和重做。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `undoTitle` | `string` | `'Undo (Ctrl+Z)'` | 撤销按钮提示。 |
| `redoTitle` | `string` | `'Redo (Ctrl+Shift+Z)'` | 重做按钮提示。 |
| `className` | `string` | `undefined` | 容器 CSS 类。 |

### `LayerControl`

`new LayerControl()` 列出图层和 MapLibre 覆盖物并切换可见性；无构造选项，内容随图层和服务注册表更新。

### `BasemapControl`

`new BasemapControl(options?)` 显示 MapLibre 底图单选面板：`styles`（`BasemapStyle[]`，默认 OSM、CartoDB Light、CartoDB Dark 三项）为旧式底图样式列表，`defaultStyle`（`string`，默认 `undefined`）指定初始激活的旧式样式 `name`。

`BasemapStyle` 参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 必填 | 面板显示名称。 |
| `url` | `string` | 必填 | MapLibre 样式或瓦片 URL。 |
| `type` | `'vector' \| 'raster'` | 自动推断 | 样式类型；`{z}` URL 视为栅格瓦片。 |

### `DrawFeatureControl`

`new DrawFeatureControl(options)` 为单一几何类型提供绘制按钮。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | 必填 | 新要素的目标 source ID。 |
| `sourceLayer` | `string` | 首个匹配几何图层 | 目标图层名。 |
| `type` | `'polygon' \| 'polyline' \| 'point'` | 必填 | 要创建的几何类型。 |
| `snapThreshold` | `number` | `10` | 顶点或边吸附像素阈值。 |
| `snapSources` | `string[]` | `[source]` | 吸附目标 source ID。 |
| `snapToVertex` | `boolean` | `true` | 启用顶点吸附。 |
| `snapToEdge` | `boolean` | `true` | 启用边吸附。 |
| `drawColor` | `string` | `EMAP_THEME_COLORS.primary` | 绘制反馈 CSS 颜色。 |
| `icon` | `string \| Node` | 按 `type` 选择内置 SVG | 按钮图标。 |

### `VertexEditControl`

`new VertexEditControl(options?)` 提供顶点编辑开关：`polygonFillColor`（`string`，默认取 VertexEdit Handler 当前值）为悬停填充 CSS 颜色。

### `EditToolbar`

`new EditToolbar(options?)` 组合编辑和绘制按钮。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `controls` | `Control[]` | `undefined` | 显式控件数组。 |
| `drawSource` | `string` | `undefined` | 加入该 source 的绘制按钮。 |
| `drawSourceLayer` | `string` | 首个匹配几何图层 | 自动绘制使用的 source layer。 |
| `advancedTools` | `boolean` | `false` | 加入高级编辑按钮。 |

### `MeasureControl`

`new MeasureControl(options)` 为单一测量模式提供按钮。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `mode` | `'length' \| 'area'` | 必填 | 测量模式。 |
| `drawColor` | `string` | `EMAP_THEME_COLORS.primary` | 草图和结果 CSS 颜色。 |
| `icon` | `string \| Node` | 按 `mode` 选择内置 SVG | 按钮图标。 |

### `BoxSelectControl`

`new BoxSelectControl(options?)` 挂载时启用矩形框选；左拖拽替换，`Shift` 追加，`Shift+Alt` 切换。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `layers` | `string[]` | 所有可见图层 | 参与框选的图层 ID。 |
| `style` | `BoxSelectStyle` | 见下表 | 矩形外观。 |
| `dragThreshold` | `number` | `4` | 最小拖拽对角线像素长度。 |
| `dragActivator` | `ModifierCombo` | `'none'` | 开始拖拽的修饰键组合。 |

`BoxSelectStyle` 参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `stroke` | `string` | 当前主题主色 | 虚线边框 CSS 颜色。 |
| `strokeWidth` | `number` | `1.5` | 边框 CSS 像素宽度。 |
| `fill` | `string` | `'transparent'` | 填充 CSS 颜色。 |

### `LassoSelectControl`

`new LassoSelectControl(options?)` 挂载时启用套索；`Shift` 左拖拽开始，`Shift+Ctrl` 或 `Shift+Meta` 追加，`Shift+Alt` 切换。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `layers` | `string[]` | 所有可见图层 | 参与套索选择的图层 ID。 |
| `style` | `LassoSelectStyle` | 见下表 | SVG 套索外观。 |
| `dragThreshold` | `number` | `4` | 最小拖拽对角线像素长度。 |
| `includeIntersecting` | `boolean` | `true` | 选择与套索相交的要素。 |

`LassoSelectStyle` 参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `stroke` | `string` | 当前主题主色 | 套索线 CSS 颜色。 |
| `strokeWidth` | `number` | `1.5` | 套索线 CSS 像素宽度。 |
| `fill` | `string` | `'none'` | 闭合套索填充。 |
| `strokeDasharray` | `string` | `'4 3'` | SVG 虚线节奏。 |

### `SimplifyControl`

`new SimplifyControl(options)` 打开简化面板并记录历史。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | 必填 | 要简化的 source ID。 |
| `target` | `string` | 整个 source dataset | 要简化的图层名。 |
| `initialPercentage` | `number` | `10` | 初始保留顶点百分比（`0`–`100`，步进 `0.1`）。 |
| `initialMethod` | `'dp' \| 'visvalingam' \| 'weighted'` | `'weighted'` | 初始简化算法；`'dp'` 为 Douglas–Peucker。 |
| `title` | `string` | `'Simplify geometry'` | 按钮提示。 |

## 可运行示例

- [编辑中国数据](/mapseekai/emap/examples/china-editing/)
- [顶点编辑](/mapseekai/emap/examples/vertex-editing/)
- [测量](/mapseekai/emap/examples/measurement/)

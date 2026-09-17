---
id: emap
slug: /concepts/emap
title: Emap 地图实例
api: ["Emap", "Feature", "FeatureAccessor", "FeatureQuery", "findInvalidFieldName", "HighlightManager", "isValidFieldName", "VisibleLayerLookup", "MapOptions", "TopologySource"]
examples: ["getting-started/geojson-viewer","interaction-handlers","undo-redo"]
stability: stable
verifiedVersion: 0.12.0
---

# Emap 地图实例

`Emap` 是应用的地图 facade，管理 Canvas、相机、source、render layer、选择、编辑历史、Handler 和地图事件。

```ts
import { Emap, TopologySource } from '@mapseekai/emap';

const map = await Emap.create({ container: 'map', interactive: true }); // 创建地图实例
const source = await TopologySource.fromUrl('main', '/data/districts.geojson'); // 从 URL 导入数据
await map.addSource('main', source); // 以 source ID 登记数据

map.addLayer({
  // 为数据声明绘制层
  id: 'districts', // 唯一 render layer ID
  type: 'fill', // 面绘制器
  source: 'main', // 引用登记的 source ID
  paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.7 }, // 设置填充样式
});

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 }); // 适配数据范围
```

## 核心方法

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `Emap.create(options)` | `EmapOptions` | 创建地图实例；参数含 `MapOptions`、preset 与插件配置。 |
| `addSource(id, source, answers?)` | `string`、`TopologySource` | 异步登记 source，必要时归一到项目 CRS；`answers.sourceCrs` 为缺少 CRS 元数据的数据显式指定 CRS。 |
| `addLayer(layer, before?)` | `LayerSpecification`、`string` | 同步注册渲染样式图层；后添加图层位于上方，`before` 指定插入前的样式图层 ID。 |

### `MapOptions` 核心参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | 浏览器 preset 必填 | Canvas 容器；字符串为元素 ID；`headless` 可省略。 |
| `interactive` | `boolean` | `true` | 启用拖拽、滚轮缩放等浏览器交互。 |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | 功能集合：编辑、浏览选择、无 DOM 工作区或应用自组插件。 |

### `LayerSpecification`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 唯一样式图层 ID。 |
| `type` | `'fill' \| 'line' \| 'circle'` | 必填 | 面、线或点绘制类型。 |
| `source` | `string` | 必填 | `addSource()` 的 source ID。 |
| `source-layer` | `string` | 首个数据 layer | source 内数据 layer ID 或名称。 |
| `paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | 类型渲染默认值 | 与 `type` 对应的样式。 |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | 图层渲染与拾取开关。 |
| `filter` | `StyleExpression` | 未设置 | 逐要素 boolean MapLibre 子集表达式。 |
| `styleSource` | `'mapshaper'` | 未设置 | 使用 mapshaper 兼容的烘焙颜色字段。 |
| `pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }`（`circle`） | 点密度抽稀；`cellSize` 为 CSS 像素。 |

缩放条件可监听相机事件并用 `setLayerVisibility()` 更新图层。

`paint` 参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `fill-color` | `string \| StyleExpression` | 主题 muted 色 | 面填充颜色或逐要素表达式。 |
| `fill-opacity` | `number` | 保留颜色 alpha | 面填充不透明度。 |
| `line-color` | `string \| StyleExpression` | 主题 primary 色 | 线或面轮廓颜色。 |
| `line-width` | `number` | `0.8` | 线或面轮廓宽度。 |
| `line-dasharray` | `readonly number[]` | 实线 | CSS 像素虚线与间隙长度。 |
| `line-dashstyle` | `LineDashStyle \| StyleExpression` | 由 `line-dasharray` 推导或 `'solid'` | 命名线型；`'arrow-dot'` 使用方向箭头。 |
| `line-arrow-spacing` | `number` | `32` | `'arrow-dot'` 箭头间距（CSS 像素）。 |
| `line-arrow-size` | `number` | `6` | `'arrow-dot'` 箭翼长度（CSS 像素）。 |
| `circle-color` | `string \| StyleExpression` | 主题 primary 色 | 点标记颜色或逐要素表达式。 |
| `circle-radius` | `number` | `4` | 点标记半径（CSS 像素）。 |
| `circle-fill` | `boolean` | `true` | 点标记填充模式。 |
| `circle-shape` | `PointMarkerShape \| StyleExpression` | `'circle'` | 点标记形状或逐要素表达式。 |

## 更多创建选项

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `plugins` | `readonly Plugin[]` | `[]` | 追加 Cordis 插件；同名插件替换 preset 插件。 |
| `excludePlugins` | `readonly string[]` | `[]` | 按名称排除 preset 插件。 |
| `authorizeCapability` | `CapabilityAuthorizer` | 宿主默认策略 | capability 调用的宿主授权策略。 |
| `expressionPolicy` | `'disabled' \| 'trusted'` | `'disabled'` | mapshaper JavaScript 表达式策略。 |
| `useWorker` | `boolean \| 'auto'` | `false` | dataset-replace 的执行位置。 |
| `workerUrl` | `string` | `'emap-worker.js'` | Worker bundle 地址，相对 `document.baseURI` 解析。 |
| `workerThreshold` | `number` | `50000` | `'auto'` 的弧顶点数阈值。 |
| `workerPoolSize` | `number` | `1` | 惰性创建的 Worker 数量。 |
| `workerPool` | `MapshaperWorkerPool` | 未设置 | 应用专属池，优先于 URL 和大小；释放时销毁。 |
| `workerRouting` | `WorkerRoutingFn` | 引擎决策 | `'auto'` 的逐调用 Worker 路由覆盖。 |
| `mapLibre` | `MapLibreIntegrationOptions` | 未设置 | 原生底图与在线叠加层配置。 |

`mapLibre` 子参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `services` | `readonly MapLibreService[]` | `[]` | 可注册的底图或 overlay 服务。 |
| `defaultBasemap` | `string` | 未设置 | 启动时激活的 basemap 服务 ID。 |
| `mapOptions` | `Omit<maplibregl.MapOptions, 'container' \| 'style' \| 'center' \| 'zoom' \| 'interactive'>` | MapLibre 默认值 | MapLibre 其余原生选项。 |

## CRS

地图初始 CRS 为 `EPSG:4326`；首个已确认 source 建立地图 CRS。

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `setCRS(crs)` | `string` | 注册 source 前设定项目 CRS。 |
| `getCRS()` | 无 | 当前项目 CRS。 |
| `reproject(targetCrs)` | `string` | 将 source 与视图投影到目标 CRS。 |

## 事件与查询

```ts
map.on('moveend', (event) => {
  console.log(event.center, event.zoom);
});

map.on('feature:click', { layers: ['districts'] }, (event) => {
  console.log(event.ref);
});
```

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `on(type, listener)` | `string`、`EventListener` | 持续订阅地图事件，返回 map。 |
| `on(type, filter, listener)` | `filter.source`、`filter.layers` | 按 source 与数据 layer 筛选 `feature:*` 事件。 |
| `once(...)` | 与 `on(...)` 相同 | 一次性监听器。 |
| `off(type, listener)` | 注册时的 `type` 与函数 | 移除监听器。 |

相机事件载荷含 `center`、`zoom` 与 `originalEvent`。`feature:*` 事件提供 `feature`、`ref`、Canvas `point`、`lngLat`、修饰键和 DOM 事件。

`queryFeatures(geometryOrOptions)` 查询可见要素：参数为像素点 `[number, number]`、两角范围 `[[number, number], [number, number]]` 或 `QueryFeaturesOptions`（默认整个 Canvas），`options.layers` 限定 source data layer ID、名称或 layer ID。返回项含 `id`、`source`、`layer`、`geometryType` 与 `properties`，按可见图层从上到下排序。选择用 `select()`、`deselect()`、`clearSelection()` 修改，`getSelection()` 读取。

## 相机

所有相机方法返回 map。`center` 使用项目坐标；`scale` 是 CRS 无关像素比例，`zoom` 是 Web Mercator 语义。

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `jumpTo(options)` | `CameraOptions` | 立即应用中心和缩放并触发生命周期事件。 |
| `easeTo(options)` | `CameraOptions & AnimationOptions` | 中心线性、比例对数插值。 |
| `flyTo(options)` | `FlyToOptions` | van Wijk 飞行路径。 |
| `fitBounds(bounds, options?)` | `Bounds`、`FitBoundsOptions` | 将数据范围置于视口内。 |
| `panTo(center, options?)` | `[number, number]`、`AnimationOptions` | 保持比例并移动中心。 |
| `zoomTo(zoom, options?)` | `number`、`AnimationOptions` | 保持中心并按 zoom 设定比例。 |
| `stop()` | 无 | 停止相机动画并完成终止事件。 |

`CameraOptions`、动画与范围参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `center` | `[number, number]` | 当前中心 | 目标项目坐标。 |
| `zoom` | `number` | 当前比例 | Web Mercator 目标 zoom。 |
| `scale` | `number` | 当前比例 | 正的目标像素比例，优先于 `zoom`。 |
| `duration` | `number` | `1000` | 动画时长（毫秒）。 |
| `easing` | `(t: number) => number` | `Tween.sineInOut` | `[0, 1]` 进度的缓动函数。 |
| `animate` | `boolean` | `true` | 动画开关；`false` 立即定位。 |
| `curve` | `number` | `1.42` | `flyTo` van Wijk 曲率。 |
| `speed` | `number` | 未设置 | `flyTo` 平均速度（屏幕宽度/秒）。 |
| `padding` | `number` | `0` | `fitBounds` 每边像素内边距。 |
| `maxScale` | `number` | 未设置 | `fitBounds` 最大比例。 |

`project(x, y)` 将项目坐标转为 Canvas 像素 `[px, py]`，`unproject(px, py)` 反向转换；两者应用当前视图变换，CRS 转换使用 `reproject()`。

## 编辑与数据操作

选择和高亮只改变交互状态。编辑使用命令、会话或 Handler；批量处理使用 `map.ops`。

```ts
const result = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.25,
});

if (!result.ok) console.error(result.error);
```

## 生命周期

`remove()` 发起 Cordis 原生卸载；`dispose()` 卸载并等待资源释放。

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [交互处理器](/mapseekai/emap/examples/interaction-handlers/)
- [撤销与重做](/mapseekai/emap/examples/undo-redo/)

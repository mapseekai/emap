---
id: overview
slug: /concepts/overview
title: 核心概念
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.14.0
---

# 核心概念

`@mapseekai/emap` 是浏览器 Canvas 地图与地理数据编辑库：`Emap` 管理地图，`TopologySource` 管理数据，render layer 管理显示。

这些对象共同支持数据加载、多样式显示、空间查询和可撤销编辑；下文按应用任务介绍各入口。

```ts
import { Emap, TopologySource } from '@mapseekai/emap'; // 导入地图和数据源

const map = await Emap.create({ container: 'map' }); // 创建地图
const source = await TopologySource.fromUrl('main', '/data/roads.geojson'); // 加载 GeoJSON

await map.addSource('main', source); // 注册 source
map.addLayer({
  id: 'roads',
  type: 'line',
  source: 'main',
  paint: { 'line-color': '#334155', 'line-width': 2 },
}); // 渲染 source

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 }); // 适配数据范围
```

`main` 是地图 source ID；render layer 和数据操作以它引用 source。多图层 dataset 还用 `source-layer` 选择目标。

## 核心分层

```text
浏览器容器
└─ Emap
   ├─ 相机、Canvas、事件、选择和编辑历史
   ├─ source "main" → TopologySource
   │  └─ mapshaper dataset
   │     ├─ source layer "districts"
   │     └─ source layer "roads"
   └─ 渲染图层
      ├─ "district-fill" → main / districts
      ├─ "district-outline" → main / districts
      └─ "road-line" → main / roads
```

| 层级 | 负责什么 | 常用入口 |
| --- | --- | --- |
| `Emap` | 容器、相机、图层顺序、交互和地图状态 | `await Emap.create(...)` |
| source | 导入后的 dataset 及其 CRS、范围和拓扑 | `TopologySource` |
| source layer | dataset 内的一组几何和属性 | `source-layer` |
| render layer | 绘制类型、样式和显示顺序 | `map.addLayer(...)` |

一个 source layer 可供多个 render layer 复用，例如 `fill` 绘制填充、`line` 绘制同一几何的边界。

## 更多状态修改入口

| 目标 | 使用的 API | 适用场景 |
| --- | --- | --- |
| 改变视图 | `jumpTo`、`fitBounds`、`flyTo`、`panTo` | 定位、拟合、飞行或平移 |
| 改变显示 | `addLayer`、`removeLayer`、`setLayerVisibility` | 图层声明、顺序和显示 |
| 读取屏幕位置的要素 | `queryFeatures` | 点击、框选和命中检测 |
| 改变选择 | `select()` / `deselect()` / `clearSelection()` 或选择 Handler | 代码或手势选择 |
| 编辑要素 | 编辑命令、编辑会话或编辑 Handler | 可撤销几何和属性变更 |
| 处理整个数据集 | `map.ops` | mapshaper 数据操作 |
| 响应地图变化 | `on`、`once`、`off` | 地图事件订阅 |

## 更多视图参数

视图坐标使用地图投影/数据坐标；`scale` 与 CRS 无关，优先于 WebMercator `zoom`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `jumpTo(options).center` | `[number, number]` | 当前中心 | 立即移动的目标中心 |
| `jumpTo(options).zoom` | `number` | 当前缩放 | WebMercator 目标 zoom |
| `jumpTo(options).scale` | `number` | 当前 scale | CRS 无关的目标 scale；优先于 `zoom` |
| `fitBounds(bounds, options).bounds` | `Bounds` | 必填 | 居中并拟合的坐标范围 |
| `fitBounds(bounds, options).padding` | `number` | `0` | 四边像素内边距 |
| `fitBounds(bounds, options).maxScale` | `number` | 未限制 | 最大拟合 scale |
| `fitBounds(bounds, options).duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | 拟合动画时长、缓动和开关 |
| `flyTo(options).center` | `[number, number]` | 当前中心 | 飞行终点中心 |
| `flyTo(options).zoom` / `scale` | `number` | 当前缩放 | 终点缩放；`scale` 优先 |
| `flyTo(options).duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | 飞行动画时长、缓动和开关 |
| `flyTo(options).speed` | `number` | 未指定 | 每秒屏幕宽度数；按距离定时 |
| `flyTo(options).curve` | `number` | `1.42` | van Wijk 飞行曲率 |
| `panTo(center, options).center` | `[number, number]` | 必填 | 保持 scale 的平移终点 |
| `panTo(center, options).duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | 平移动画时长、缓动和开关 |

## 更多图层参数

render layer API 以图层 ID 管理显示；`addLayer` 的 `source` 必须已添加。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `addLayer(layer).id` / `.type` / `.source` | `string` / `'fill' \| 'line' \| 'circle'` / `string` | 必填 | 唯一 render layer ID、绘制方式和关联 source ID |
| `addLayer(layer)['source-layer']` | `string` | 第一个 source layer | dataset 内的目标 source layer |
| `addLayer(layer).layout.visibility` | `'visible' \| 'none'` | `'visible'` | 初始显示状态 |
| `addLayer(layer).paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | 未指定 | 图层样式 |
| `addLayer(layer, before).before` | `string` | 末尾 | 前插目标 render layer ID |
| `removeLayer(id).id` / `setLayerVisibility(id, visibility).id` | `string` | 必填 | 目标 render layer ID |
| `setLayerVisibility(id, visibility).visibility` | `'visible' \| 'none'` | 必填 | 目标显示状态 |

## 更多查询与选择参数

`queryFeatures` 查询 Canvas 像素点、像素包围框或当前视口；结果按可见 render layer 从上到下排列。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queryFeatures(geometry).geometry` | `[number, number]` 或 `[[number, number], [number, number]]` | 当前视口 | Canvas 像素点或包围框 |
| `queryFeatures(geometry, options).options.layers` | `string[]` | 可见 render layer 对应的全部 source layer | 限定 source layer 范围 |

选择 API 以 `FeatureRef`（`source`、`layer`、`id`）标识要素，并发出 `selectionchange`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `select(features, options).features` | `ReadonlyArray<FeatureRef>` | 必填 | 要选择的要素引用 |
| `select(features, options).options.mode` | `'replace' \| 'add' \| 'toggle'` | `'replace'` | 替换、累加或切换选择 |
| `deselect(features).features` | `ReadonlyArray<FeatureRef>` | 必填 | 要移除的要素引用 |
| `clearSelection()` | `—` | `—` | 清空选择 |

## 更多数据操作参数

`map.ops` 是 `MapshaperOps` 入口；数据操作返回 `Promise<OpResult>`、替换数据并写入撤销历史。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `map.ops` | `Pick<MapshaperOps, keyof MapshaperOps>` | 只读 getter | 数据变换操作集合 |
| `map.ops.withSignal(signal).signal` | `AbortSignal` | 必填 | 长操作取消范围 |
| `map.ops.clipLayer(options).source` | `string` | 必填 | 目标和掩膜所在 source ID |
| `map.ops.clipLayer(options).target` | `string` | 必填 | 要裁剪的 source layer |
| `map.ops.clipLayer(options).mask` / `bbox` | `string` / `[number, number, number, number]` | 二选一 | 面掩膜或数据坐标矩形 |
| `map.ops.dissolveLayer(options).source` / `target` | `string` / `string` | 必填 | 待融合 source 和 source layer |
| `map.ops.dissolveLayer(options).field` / `fields` | `string` / `string[]` | 未分组 | 属性字段分组 |

## 更多事件参数

事件 API 返回 `map` 以便链式订阅；常用类型有 `moveend`、`data`、`layerchange`、`selectionchange` 和 `feature:click`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `on(type, listener).type` | `keyof EmapEventMap \| string` | 必填 | 持续订阅的地图事件 |
| `on(type, listener).listener` | `EventListener` | 必填 | 事件回调 |
| `on(type, filter, listener).filter` | `FeatureEventFilter` | 全部可见要素 | `feature:*` 的 source/layer 筛选器 |
| `once(type, listener).type` / `listener` | `keyof EmapEventMap \| string` / `EventListener` | 必填 | 单次事件订阅 |
| `once(type, filter, listener).filter` | `FeatureEventFilter` | 全部可见要素 | 单次 `feature:*` 的 source/layer 筛选器 |
| `off(type, listener).type` / `listener` | `keyof EmapEventMap \| string` / `EventListener` | 必填 | 移除事件回调 |

`source.getDataset()` 提供实时零复制的 TypeScript 只读视图。通过地图编辑和操作入口修改其底层数据，可同步渲染、选择、索引和历史。

继续阅读 [Emap 地图实例](./emap.md)、[数据源与图层](./source-layer.md)、[拓扑模型](./topology.md)、[坐标与 CRS](./coordinates-crs.md)；代码和插件组织见[技术架构与源码组织](./architecture.md)。

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)

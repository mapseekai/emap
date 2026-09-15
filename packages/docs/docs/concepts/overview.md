---
id: overview
slug: /concepts/overview
title: 核心概念
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.12.0
---

# 核心概念

> 想了解代码和插件如何组织，请先看 [当前技术架构与源码组织](/concepts/architecture)。


`@mapseekai/emap` 是浏览器中的 Canvas 地图与地理数据编辑库。应用创建一个 `Emap`，导入 `TopologySource`，再用渲染图层声明数据如何显示。数据、显示和交互分别由不同对象管理。

## 对象关系

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

## 四个层级

| 层级 | 负责什么 | 常用入口 |
| --- | --- | --- |
| `Emap` | 容器、相机、图层顺序、交互和地图状态 | `await Emap.create(...)` |
| source | 导入后的 dataset 及其 CRS、范围和拓扑 | `TopologySource` |
| source layer | dataset 内的一组几何和属性 | `source-layer` |
| render layer | 绘制类型、样式和显示顺序 | `map.addLayer(...)` |

一个 source layer 可以供多个 render layer 使用。例如，用 `fill` 绘制行政区填充，再用 `line` 绘制同一组行政区边界；两者读取相同几何。

## 从数据到可交互地图

```ts
import { Emap, TopologySource } from '@mapseekai/emap';

const map = await Emap.create({ container: 'map' });
const source = await TopologySource.fromUrl('main', '/data/roads.geojson');

await map.addSource('main', source);
map.addLayer({
  id: 'roads',
  type: 'line',
  source: 'main',
  paint: { 'line-color': '#334155', 'line-width': 2 },
});

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 });
```

`main` 是地图中的 source ID。render layer 的 `source` 和数据操作的 `source` 都使用它。多图层 dataset 还通过 `source-layer` 指定其中的 source layer。

## 状态应由谁修改

| 目标 | 使用的 API |
| --- | --- |
| 改变视图 | `jumpTo`、`fitBounds`、`flyTo`、`panTo` |
| 改变显示 | `addLayer`、`removeLayer`、`setLayerVisibility` |
| 读取屏幕位置的要素 | `queryFeatures` |
| 改变选择 | `select()` / `deselect()` / `clearSelection()` 或选择 Handler |
| 编辑要素 | 编辑命令、编辑会话或编辑 Handler |
| 处理整个数据集 | `map.ops` |
| 响应地图变化 | `on`、`once`、`off` |

不要直接修改 `source.getDataset()` 返回的数据。它是实时 dataset 的零复制只读 TypeScript 视图；通过地图的编辑和操作入口变更数据，渲染、选择、空间索引和历史会同步更新。

继续阅读 [Emap 地图实例](./emap.md)、[数据源与图层](./source-layer.md)、[拓扑模型](./topology.md) 和 [坐标与 CRS](./coordinates-crs.md)。

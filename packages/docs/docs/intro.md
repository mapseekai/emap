---
id: intro
slug: /
title: Emap 简介
api: ["Emap", "LayerSpecification", "TopologySource"]
examples: ["china-editing","export-formats","getting-started/vector-file"]
stability: stable
verifiedVersion: 0.14.0
---

# Emap

`@mapseekai/emap` 是浏览器端的拓扑地图引擎。它加载、绘制、编辑和分析矢量数据，数据保存在可撤销的 mapshaper topology dataset 里。

用它做数据查看器、拓扑编辑器或空间分析页面。格式、底图和后台处理按需加插件。

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = await Emap.create({ container: 'map' });
const source = await TopologySource.fromUrl('main', '/data/roads.geojson');
await map.addSource('main', source);
map.addLayer({ id: 'roads', type: 'line', source: 'main' });
```

## 按任务查阅

| 你要做的事 | 从这里进入 |
| --- | --- |
| 画出第一张图 | [安装](./getting-started/installation.md)、[第一张地图](./getting-started/quick-start.md) |
| 理解地图、数据源和图层 | [核心概念](./concepts/overview.md) |
| 移动视图、处理坐标系 | [相机](./guides/camera.md)、[坐标系](./concepts/coordinates-crs.md) |
| 给点、线、面设置样式 | [样式](./guides/styling.md) |
| 点击、选择、监听事件 | [选择](./guides/selection.md)、[事件](./guides/events.md) |
| 绘制和修改要素 | [编辑](./guides/editing.md) |
| 导入导出、算几何、跑 SQL | [数据格式](./data/formats.md)、[几何操作](./data/operations.md)、[DuckDB](./data/duckdb.md) |
| 看运行时怎样对应到源码 | [运行时组成](./concepts/runtime.md) |

参数表留在对应指南和[参考](./reference/events.md)。示例按同样的任务分组，见[示例集](/mapseekai/emap/examples/)。

## 可运行示例

- [打开矢量文件](/mapseekai/emap/examples/getting-started/vector-file/)
- [格式导出](/mapseekai/emap/examples/export-formats/)
- [中国行政区划编辑](/mapseekai/emap/examples/china-editing/)

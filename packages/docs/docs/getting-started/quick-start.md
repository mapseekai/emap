---
id: quick-start
slug: /getting-started/quick-start
title: 第一张地图
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/vector-file"]
stability: stable
verifiedVersion: 0.14.0
---

# 第一张地图

完成[安装](./installation.md)后，用一个 GeoJSON 数据源和两个图层画出一张可以拖动的地图。

容器需要有高度：

```html
<div id="map" style="width: 100%; height: 480px"></div>
```

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = await Emap.create({ container: 'map' });
const source = await TopologySource.fromUrl('districts', '/data/districts.geojson');
await map.addSource('districts', source);
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.45 },
});
map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: { 'line-color': '#1e3a8a', 'line-width': 1.5 },
});
map.setExtent(source.getExtent());
```

`districts` 是数据源 ID。填充和边界是两个图层，读的是同一份数据。创建选项、导入限制和图层字段见[核心概念](../concepts/overview.md)和[样式](../guides/styling.md)。

## 下一步

- [地图、数据源与图层](../concepts/overview.md)
- [样式](../guides/styling.md)
- [编辑](../guides/editing.md)

## 可运行示例

- [打开矢量文件](/mapseekai/emap/examples/getting-started/vector-file/)

---
id: quick-start
slug: /getting-started/quick-start
title: 第一张地图
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: unreleased
---

# 第一张地图

完成[安装](./installation.md)后，用一个 GeoJSON 数据源和两层渲染图层得到第一张可交互地图。

## 准备容器

地图容器必须已经在页面上且有非零尺寸。Emap 不会替容器决定高度：

```html
<div id="map" style="width: 100%; height: 480px"></div>
```

## 创建地图并加载数据

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = await Emap.create({
  container: 'map',
  expressionPolicy: 'disabled',
});

const source = await TopologySource.fromUrl('districts', '/data/districts.geojson');
await map.addSource('districts', source);
```

`Emap.create` 是异步的：它启动 Cordis 运行时并等待默认 preset 的插件就绪。`expressionPolicy: 'disabled'` 是默认值，这里写出来是为了提醒：只有配置和数据完全由应用控制时才改为 `'trusted'`。

## 添加图层并定位

```ts
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: {
    'fill-color': '#60a5fa',
    'fill-opacity': 0.45,
  },
});

map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: {
    'line-color': '#1e3a8a',
    'line-width': 1.5,
  },
});

map.setExtent(source.getExtent());
```

`source` 引用的是 `addSource` 注册的 source ID。dataset 内有多个图层时，用 `'source-layer'` 指定其中一个。图层按添加顺序绘制，后添加的在上面。

## 加载本地文件

用户选择的文件走 `fromBytes`，按文件名判断格式：

```ts
const file = input.files?.[0];
if (!file) throw new Error('Choose a file first');

const source = await TopologySource.fromBytes('upload', await file.arrayBuffer(), {
  filename: file.name,
});
await map.addSource('upload', source);
```

面向公开上传时收紧 `zipLimits`；可用的限制项见[数据源与图层](../concepts/source-layer.md)。

## 卸载

宿主视图移除时等待 `dispose()` 完成，再复用容器：

```ts
await map.dispose();
```

## 下一步

- [核心概念](../concepts/overview.md)：source、source layer 和渲染图层的关系。
- [样式](../guides/styling.md)：paint 属性和属性驱动样式。
- [编辑](../guides/editing.md)：启用编辑 Handler 和撤销/重做。
- [GeoJSON 查看器示例](/mapseekai/emap/examples/getting-started/geojson-viewer/)：本页的完整可运行版本。

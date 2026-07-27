---
id: installation
slug: /getting-started/installation
title: 安装
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# 安装

使用包管理器安装 emap：

```bash
pnpm add @zwishing/emap
```

在应用入口导入样式，并为地图准备一个有尺寸的容器：

```ts
import { Emap, TopologySource } from '@zwishing/emap';
import '@zwishing/emap/style.css';
```

```html
<div id="map"></div>
```

```css
html,
body,
#map {
  width: 100%;
  height: 100%;
  margin: 0;
}
```

创建地图实例，加载数据源，然后让视图适配数据范围：

```ts
const map = new Emap({ container: 'map' });

const response = await fetch('/data/china.geojson');
const content = new Uint8Array(await response.arrayBuffer());
const source = new TopologySource('china');

await source.setData({ filename: 'china.geojson', content });
map.addSource('china', source);
map.setExtent(source.getExtent());
```

`source.setData(...)` 会等待数据集载入完成。`map.addSource(...)` 将数据源加入地图，`map.setExtent(...)` 使用数据范围设置初始视图。

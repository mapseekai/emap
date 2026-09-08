---
id: emap
slug: /concepts/emap
title: Emap 地图实例
api: ["Emap","Feature","FeatureAccessor","FeatureQuery","findInvalidFieldName","HighlightManager","isValidFieldName","VisibleLayerLookup","MapOptions","TopologySource"]
examples: ["getting-started/geojson-viewer","interaction-handlers","undo-redo"]
stability: stable
verifiedVersion: 0.9.0
---

# Emap 地图实例

`Emap` 是应用的地图 facade。一个实例绑定一个浏览器容器，统一管理 Canvas、相机、已注册 source、render layer、选择、编辑历史、交互 Handler 和地图事件。应用通过实例的方法修改地图状态，而不是直接操作 Canvas 或 dataset。

## 创建地图

```ts
import { Emap } from '@mapseekai/emap';

const map = new Emap({
  container: 'map',
  interactive: true,
});
```

`container` 可以是元素 ID 或 `HTMLElement`；元素必须已经存在且尺寸非零。`interactive` 控制默认浏览器交互。数据处理可用 `useWorker: true` 或 `useWorker: 'auto'` 路由到 Worker；`workerUrl` 指定 Worker 脚本 URL，`workerThreshold` 是 `'auto'` 模式使用的顶点数阈值。

`expressionPolicy` 的值为 `'disabled'` 或 `'trusted'`。只有应用自身提供的表达式才能使用 `'trusted'`；用户输入和远程内容应保持 `'disabled'`。

## 添加数据和显示

```ts
import { TopologySource } from '@mapseekai/emap';

const source = await TopologySource.fromUrl('main', '/data/districts.geojson');
await map.addSource('main', source);

map.addLayer({
  id: 'districts',
  type: 'fill',
  source: 'main',
  paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.7 },
});

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 });
```

`addSource` 将 source 注册为地图 source ID；`addLayer` 使用该 ID 引用数据。source 内有多个 source layer 时，在 layer 配置中加入 `'source-layer'`。图层按添加顺序绘制，后添加的图层位于上方。

## 读取和响应地图状态

```ts
map.on('moveend', (event) => {
  console.log(event.center, event.zoom);
});

map.on('feature:click', { layers: ['districts'] }, (event) => {
  console.log(event.ref);
});
```

`on` 持续监听，`once` 只接收一次事件，`off` 使用同一个 listener 取消监听。`queryFeatures` 查询 Canvas 本地像素位置或范围内的要素；选择状态由 `map.selection` 保存。

## 编辑与数据操作

选择和高亮只改变交互状态。要素编辑应使用编辑命令、编辑会话或内置 Handler；批量处理使用 `map.ops`。这些入口会更新渲染、空间索引、选择和历史。

```ts
const result = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.25,
});

if (!result.ok) console.error(result.error);
```

使用 `jumpTo`、`easeTo`、`flyTo`、`fitBounds`、`panTo` 和 `zoomTo` 修改相机。使用 `project` 和 `unproject` 在地图坐标与 Canvas 像素之间转换；这两个方法不执行 CRS 重投影。

## 生命周期

当应用卸载地图容器时，调用 `map.remove()`。它停止交互、移除 Canvas 和控件，并释放地图持有的资源。

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [交互处理器](/mapseekai/emap/examples/interaction-handlers/)
- [撤销与重做](/mapseekai/emap/examples/undo-redo/)

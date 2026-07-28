---
id: emap
slug: /concepts/emap
title: Emap 地图实例
api: ["Emap","Feature","FeatureAccessor","FeatureQuery","findInvalidFieldName","HighlightManager","isValidFieldName","isValidLayerName","quoteCliArg"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.5.0
---

# Emap 地图实例

`Emap` 是一个地图容器的协调器。它管理 Canvas、相机、已注册数据源、渲染图层顺序、
控件、交互处理器、选择、历史记录和 Worker 路由。应用通常只需要创建一个实例，
然后通过公开方法和事件与它交互。

## 创建实例

```ts
import { Emap } from '@zwishing/emap';

const map = new Emap({
  container: 'map',
});
```

`container` 可以是容器 ID。容器必须已存在并具有非零尺寸。

常用选项：

| 选项 | 默认值 | 用途 |
|---|---|---|
| `interactive` | `true` | 是否启用默认浏览器交互 |
| `useWorker` | `false` | `true` 强制路由，`'auto'` 按工作量决定 |
| `workerThreshold` | `50000` | `'auto'` 模式下参与判断的数据规模阈值 |
| `workerUrl` | `emap-worker.js` | Worker 脚本的公开 URL |
| `expressionPolicy` | `'disabled'` | 是否允许执行 mapshaper 表达式 |

只有在表达式来自可信代码时才使用 `expressionPolicy: 'trusted'`。用户输入或远程内容
不应直接作为可信表达式执行。

## 注册数据源

```ts
const source = await TopologySource.fromUrl('main', '/data/districts.geojson');

map.addSource('main', source);
map.setExtent(source.getExtent());
```

数据源可以先加载后添加，也可以先添加空的 `TopologySource`，再异步调用
`setData(...)`。地图会响应数据源的 `data` 事件，因此这两种顺序都可用。

地图级 source ID 必须与渲染图层和 `map.ops` 中使用的 `source` 一致。

## 添加渲染图层

```ts
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'main',
  paint: {
    'fill-color': '#60a5fa',
    'fill-opacity': 0.7,
  },
});

map.addLayer({
  id: 'district-line',
  type: 'line',
  source: 'main',
  paint: {
    'line-color': '#1e3a8a',
    'line-width': 1,
  },
});
```

渲染图层 ID 在地图中必须唯一且稳定。选择过滤器、要素事件和应用状态通常会保存该 ID。

## 控件与交互处理器

控件提供 DOM 界面，Handler 实现真实交互。使用内置控件时，通过 `addControl`
把生命周期交给地图：

```ts
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-right');
```

如果应用已经有自己的工具栏，可以直接启用或禁用地图 Handler，而不必复制指针交互逻辑。

## 监听地图状态

`Emap` 继承事件分发能力。已知事件名会推断 payload：

```ts
map.on('moveend', (event) => {
  console.log(event.center, event.zoom);
});

map.on(
  'feature:click',
  { layers: ['district-fill'] },
  (event) => {
    console.log(event.ref);
  },
);

map.on('historychange', (event) => {
  console.log(event);
});
```

持续监听使用 `on`，单次监听使用 `once`，不再需要时使用同一 listener 调用 `off`。

## 修改数据

根据变化规模选择入口：

- 选择和高亮只改变交互状态，不改写 dataset。
- 要素移动、顶点编辑和属性编辑通过编辑命令进入历史。
- 缓冲区、融合、投影、简化等批量操作通过 `map.ops` 执行。
- 多个命令需要形成一次撤销操作时使用 transaction。

```ts
const result = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.25,
});

if (!result.ok) {
  console.error(result.error);
}
```

不要绕过这些入口直接改写 `source.getDataset()`。地图依赖命令效果分类来更新选择、
空间索引、历史和渲染缓存。

## 相机与屏幕坐标

通过 `jumpTo`、`easeTo`、`flyTo`、`fitBounds`、`panTo` 和 `zoomTo` 改变视图。
通过 `project` 与 `unproject` 在地图坐标和 Canvas 像素之间转换。不要直接修改
viewport，也不要在应用代码中维护另一套矩阵。

## API

- [Emap](/emap/api/classes/index.Emap.html)
- [MapOptions](/emap/api/interfaces/index.MapOptions.html)
- [EmapEventMap](/emap/api/interfaces/index.EmapEventMap.html)

## 可运行示例

- [GeoJSON 查看器](/emap/examples/getting-started/geojson-viewer/)
- [交互处理器](/emap/examples/interaction-handlers/)
- [撤销与重做](/emap/examples/undo-redo/)
- [Web Worker](/emap/examples/web-worker/)

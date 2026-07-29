---
id: overview
slug: /concepts/overview
title: 核心概念
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# 核心概念

Emap 的运行模型围绕 `Emap`、`TopologySource`、source layer 和渲染图层展开。
先理解它们的职责边界，可以避免数据已经加载却无法显示、图层 ID 混用或直接修改
dataset 导致历史和缓存失效等问题。

## 对象关系

```text
浏览器容器
└─ Emap
   ├─ Camera / Viewport
   ├─ Controls 与 Handlers
   ├─ History 与 Selection
   ├─ TopologySource "main"
   │  └─ mapshaper dataset
   │     ├─ source layer "districts"
   │     └─ source layer "roads"
   └─ 渲染图层
      ├─ "district-fill" → main / districts
      ├─ "district-outline" → main / districts
      └─ "road-line" → main / roads
```

## 地图实例

`Emap` 绑定一个浏览器容器，负责：

- 创建和更新 Canvas。
- 保存相机与视口状态。
- 注册数据源并维护渲染图层顺序。
- 调度选择、编辑、拖拽和缩放处理器。
- 管理控件、历史、验证和 Worker 路由。
- 通过 `on`、`off`、`once` 和 `fire` 分发引擎事件。

一个容器对应一个地图实例。应用界面应通过公开 API 和事件与地图同步，而不是直接
修改 Canvas 或 viewport 内部状态。

## 数据源

`TopologySource` 是导入数据与地图之间的边界。它接收 URL、文件或内存字节，
将输入转换为 mapshaper dataset，并提供：

- 数据范围。
- dataset 中的 source layers。
- 用于渲染的拓扑弧和简化层级。
- 导出与格式插件入口。

数据源的 ID 是地图级引用，例如 `main`、`roads` 或 `upload`。调用
`map.addSource('main', source)` 后，渲染图层和操作都使用这个 ID 定位数据。

## Source layer 与渲染图层

这两个“图层”具有不同职责：

| 类型 | 来源 | 保存什么 | 示例 |
|---|---|---|---|
| source layer | 导入的数据集 | 几何和属性记录 | `districts` |
| 渲染图层 | 应用配置 | 绘制类型、顺序和 paint | `district-fill` |

一个 source layer 可以被多个渲染图层引用。例如同一组行政区面可以先绘制填充，
再绘制边界线。多图层数据集通过 `source-layer` 指定要使用的 source layer。

## 数据范围与相机

数据坐标不会自动决定用户当前看到的位置。数据加载后通常执行：

```ts
const extent = source.getExtent();
if (extent.hasBounds()) {
  map.fitBounds(extent, { padding: 32, duration: 0 });
}
```

`setExtent` 适合直接设置初始范围；`fitBounds` 还可以设置 padding 和动画。
如果数据为空，应先检查范围，再移动相机。

## 查询、选择与编辑

- **查询**回答“某个屏幕位置有哪些要素”，不一定改变地图状态。
- **选择**保存 source、source layer 和 feature ID 的引用，并触发
  `selectionchange`。
- **编辑**通过命令或 edit session 修改数据，并同步历史、缓存和渲染失效。
- **数据操作**通过 `map.ops` 替换或更新 dataset，并返回 `OpResult`。

不要直接修改 `source.getDataset()` 返回的对象。直接修改不会自动建立撤销快照，
也可能让空间索引、简化显示和选择状态与实际数据不一致。

## 一次完整的数据流

```ts
const source = await TopologySource.fromUrl('main', '/data/roads.geojson');

map.addSource('main', source);
map.addLayer({
  id: 'roads',
  type: 'line',
  source: 'main',
  paint: {
    'line-color': '#334155',
    'line-width': 2,
  },
});

map.setExtent(source.getExtent());

map.on(
  'feature:click',
  { layers: ['roads'] },
  (event) => {
    console.log(event.ref);
  },
);
```

执行顺序是：输入数据 → 构建 topology → 注册 source → 配置渲染图层 →
设置相机 → 通过事件响应交互。

## 应该从哪里修改状态

| 需求 | 使用的入口 |
|---|---|
| 改变视图 | `jumpTo`、`fitBounds`、`flyTo`、`panBy` 等相机 API |
| 改变显示 | 添加、移除或更新渲染图层 |
| 改变选择 | 地图选择 API 或选择 Handler |
| 改变单个要素 | 编辑命令、编辑会话或内置编辑 Handler |
| 批量处理数据 | `map.ops.*` |
| 批量合并用户动作 | Transaction |
| 响应内部变化 | `map.on(...)` |

后续分别阅读 [Emap 地图实例](./emap.md)、[数据源与图层](./source-layer.md)、
[拓扑模型](./topology.md) 和[坐标与 CRS](./coordinates-crs.md)。

---
id: events
slug: /guides/events
title: 事件
api: ["CameraEvent","Emap","EmapEventMap","EventDispatcher","EventListener","FeatureEvent","FeatureEventFilter"]
examples: ["feature-attributes","interaction-handlers"]
stability: stable
verifiedVersion: 0.8.1
---

# 事件

Emap 在引擎层使用 `EventDispatcher`。应用通过 `map.on`、`map.once` 和 `map.off`
监听相机、数据、选择、历史、验证、指针和要素变化，而不需要监听内部 Canvas
的实现事件。

## 基本用法

```ts
const onMoveEnd = (event: {
  center: [number, number];
  zoom: number;
}) => {
  console.log(event.center, event.zoom);
};

map.on('moveend', onMoveEnd);
map.off('moveend', onMoveEnd);
```

`off` 必须接收注册时的同一个函数引用。只需要一次通知时使用：

```ts
map.once('data', (event) => {
  console.log(event.sourceId, event.reason);
});
```

## 公开地图事件

| 事件 | 载荷 | 使用场景 |
|---|---|---|
| `movestart` | `CameraEvent` | 相机移动开始 |
| `move` | `Partial<CameraEvent>` | 移动过程；字段可能为空 |
| `moveend` | `CameraEvent` | 相机移动结束 |
| `zoomstart` | `CameraEvent` | 缩放开始 |
| `zoom` | `CameraEvent` | 缩放过程 |
| `zoomend` | `CameraEvent` | 缩放结束 |
| `resize` | 无业务字段 | 容器尺寸更新 |
| `crschange` | 无业务字段 | 地图 CRS 改变 |
| `data` | `sourceId`、`reason` | 加载、替换、编辑或重投影数据 |
| `editmodechange` | `mode` | 编辑模式改变 |
| `error` | `error` | 地图级异步错误 |
| `historychange` | 历史快照字段 | 撤销或重做状态改变 |
| `selectionchange` | `selected`、`added`、`removed` | 选择集合实际改变 |
| `validationfailed` | `results`、`label` | after-commit 验证失败 |
| `mousemove` | 屏幕和地图指针信息 | 构建坐标读数或自定义 hover |

`move` 既可能来自完整相机流程，也可能来自 viewport 平移，因此它的相机字段是可选的。
需要稳定的最终中心和 zoom 时优先监听 `moveend`。

## 要素事件

公开要素事件包括：

- `feature:click`
- `feature:hover`
- `feature:enter`
- `feature:leave`

可以监听所有可见图层：

```ts
map.on('feature:click', (event) => {
  console.log(event.ref);
  console.log(event.feature.properties);
});
```

也可以按地图 source ID 或 source layer 名称过滤：

```ts
map.on(
  'feature:click',
  {
    source: 'main',
    layers: ['districts'],
  },
  (event) => {
    console.log(event.ref.id);
  },
);
```

`layers` 过滤的是 `FeatureRef.layer`，即 dataset 中的 source layer 名称，
不是渲染图层 ID。

`FeatureEvent` 提供：

| 字段 | 说明 |
|---|---|
| `feature` | 可读取属性和几何的 Feature 访问器 |
| `ref` | `{ source, layer, id }` |
| `point` | Canvas 容器内像素坐标 |
| `lngLat` | 当前地图坐标 |
| `modifiers` | Shift、Ctrl、Alt、Meta 状态 |
| `originalEvent` | 原始浏览器事件 |

## 选择事件

`selectionchange` 只在集合实际变化时触发：

```ts
map.on('selectionchange', ({ selected, added, removed }) => {
  console.log('当前选择', selected);
  console.log('本次新增', added);
  console.log('本次移除', removed);
});
```

可以直接用 `selected` 更新属性面板，不必再次读取地图状态。

## 相机事件与程序调用

程序调用相机 API 时，`CameraEvent.originalEvent` 为 `null`：

```ts
map.on('moveend', (event) => {
  if (event.originalEvent === null) {
    console.log('由应用代码触发');
  }
});
```

用户手势触发的相机事件会携带对应的鼠标事件。

## 自定义应用事件

应用可以扩展 `EmapEventMap`，保留完整类型推断：

```ts
declare module '@mapseekai/emap' {
  interface EmapEventMap {
    'panel:open': { panelId: string };
  }
}

map.on('panel:open', ({ panelId }) => {
  console.log(panelId);
});

map.fire('panel:open', { panelId: 'properties' });
```

Worker 池内部的 `workerjob*` 信号不是 `map.on` 的公开事件。应用应以 operation
Promise、`OpResult` 和自己的加载状态驱动进度 UI。

## 避免高频事件中的重工作

`move`、`zoom`、`mousemove` 和 `feature:hover` 可能高频触发。监听器中避免执行
数据导入或拓扑操作；DOM 更新可合并到 `requestAnimationFrame`。

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [EmapEventMap](/mapseekai/emap/api/interfaces/emap.EmapEventMap.html)
- [CameraEvent](/mapseekai/emap/api/interfaces/emap.CameraEvent.html)
- [FeatureEvent](/mapseekai/emap/api/interfaces/emap.FeatureEvent.html)

## 可运行示例

- [要素属性](/mapseekai/emap/examples/feature-attributes/)
- [交互处理器](/mapseekai/emap/examples/interaction-handlers/)
- [要素选择](/mapseekai/emap/examples/feature-selection/)

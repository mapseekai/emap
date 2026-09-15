---
id: events
slug: /guides/events
title: 事件
api: ["CameraEvent", "Emap", "EmapEventMap", "EventDispatcher", "EventListener", "FeatureEvent", "FeatureEventFilter"]
examples: ["feature-attributes","interaction-handlers"]
stability: stable
verifiedVersion: 0.12.0
---

# 事件

使用 `map.on()` 订阅，`map.once()` 订阅一次，`map.off()` 移除同一个监听函数。Emap 为相机、数据、图层、选择、历史、验证、指针和要素事件提供类型化载荷。

## 订阅和移除

```ts
const onMoveEnd = ({ center, zoom }: { center: [number, number]; zoom: number }) => {
  const view = { center, zoom };
};

map.on('moveend', onMoveEnd);
map.once('data', () => map.getSelection());
map.off('moveend', onMoveEnd);
```

## 常用地图事件

| 事件 | 用途 |
|---|---|
| `movestart`、`move`、`moveend` | 同步相机位置 |
| `zoomstart`、`zoom`、`zoomend` | 同步缩放 UI |
| `data`、`crschange`、`resize` | 响应数据和视图生命周期 |
| `layerchange` | 更新图层列表 |
| `selectionchange` | 更新选择摘要 |
| `historychange` | 启用或禁用撤销/重做按钮 |
| `editmodechange` | 同步编辑工具状态 |
| `validationfailed`、`error`、`warning` | 呈现操作和样式诊断 |

程序相机调用产生的 `CameraEvent.originalEvent` 为 `null`。

## 订阅要素事件

要素事件支持可选过滤器。`layers` 使用 source layer 名称：

```ts
map.on('feature:click', { layers: ['lots'] }, (event) => {
  map.select([event.ref]);
});

map.on('feature:hover', (event) => {
  map.setHighlightedFeatures([event.ref]);
});
```

可用事件为 `feature:click`、`feature:hover`、`feature:enter` 和 `feature:leave`。`mousemove` 提供没有命中测试筛选的指针事件。

## 处理高频事件

`move`、`zoom`、`mousemove` 和 `feature:hover` 可以高频触发。在监听器中合并 DOM 更新到 `requestAnimationFrame`，把数据导入和拓扑操作放在显式用户动作中。

## 可运行示例

- [要素属性](/mapseekai/emap/examples/feature-attributes/)
- [交互 Handler](/mapseekai/emap/examples/interaction-handlers/)

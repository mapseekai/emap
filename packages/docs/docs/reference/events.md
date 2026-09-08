---
id: events
slug: /reference/events
title: 事件参考
api: ["Emap","EmapEventMap","CameraEvent","LayerChangeEvent","EventListener","FeatureEvent","FeatureEventFilter","PointerMoveEvent"]
examples: ["feature-selection","web-worker"]
stability: stable
verifiedVersion: 0.9.0
---

# 事件参考

`Emap` 通过 `on`、`once` 和 `off` 订阅事件。已知事件名会推断 payload；应用也可以通过声明合并扩展 `EmapEventMap`，为自定义事件提供类型。

```ts
map.once("moveend", (event) => {
  console.log(event.center, event.zoom)
})
```

## 相机事件

| 事件 | payload | 触发时机 |
| --- | --- | --- |
| `movestart` | `CameraEvent` | 相机移动开始 |
| `move` | `Partial<CameraEvent>` | 视图或相机位置改变 |
| `moveend` | `CameraEvent` | 相机移动结束 |
| `zoomstart` | `CameraEvent` | 缩放开始 |
| `zoom` | `CameraEvent` | 缩放值改变 |
| `zoomend` | `CameraEvent` | 缩放结束 |

`CameraEvent` 包含 `center`、`zoom` 和 `originalEvent`。编程式相机移动的 `originalEvent` 为 `null`。`move` 也由平移和滚轮视图更新触发，因此其相机字段是可选的。

## 地图状态事件

| 事件 | payload | 触发时机 |
| --- | --- | --- |
| `crschange` | 无字段 | 地图坐标参考系改变 |
| `resize` | 无字段 | 地图容器尺寸改变 |
| `data` | `sourceId?`、`reason?`、`origin?` | 数据源加载、编辑、替换或重投影 |
| `layerchange` | `LayerChangeEvent` | 图层添加、移除或有效可见性改变 |
| `editmodechange` | `{ mode }` | 编辑模式改变 |
| `selectionchange` | `{ selected, added, removed }` | 选择集改变 |
| `historychange` | 历史快照字段（可选） | 历史记录改变 |
| `validationfailed` | `{ results, label }` | 提交后的验证返回失败结果 |
| `warning` | `{ layerId, buckets?, error? }` | 样式解析产生诊断 |
| `error` | `{ error }` | 地图操作或事件监听器报告错误 |

`data.reason` 的值为 `edit`、`load`、`replace` 或 `reproject`；外部输入替换会包含 `origin: "external"`。`layerchange.reason` 的值为 `add`、`remove`、`visibility` 或 `effective`。

## 指针和要素事件

| 事件 | payload | 用途 |
| --- | --- | --- |
| `mousemove` | `PointerMoveEvent` | 读取容器像素坐标、地图坐标和原始 DOM 事件 |
| `feature:click` | `FeatureEvent` | 处理命中的要素点击 |
| `feature:hover` | `FeatureEvent` | 处理命中的要素悬停 |
| `feature:enter` | `FeatureEvent` | 指针进入要素 |
| `feature:leave` | `FeatureEvent` | 指针离开要素 |

要素事件可按 source 或图层过滤：

```ts
map.on("feature:click", { source: "parcels", layers: ["parcel-fill"] }, (event) => {
  console.log(event.ref, event.lngLat)
})
```

`FeatureEvent` 提供 `feature`、`ref`、`point`、`lngLat`、修饰键状态和 `originalEvent`。`mousemove` 不进行要素命中测试；其 payload 提供 `point`、`mapCoord` 和 `originalEvent`。

内部 handler、Worker 和 source dispatcher 的事件不会通过 `map.on` 分发。

## API

- [src.EmapEventMap](/mapseekai/emap/api/interfaces/emap.EmapEventMap.html)
- [src.EventListener](/mapseekai/emap/api/types/emap.EventListener.html)
- [src.FeatureEvent](/mapseekai/emap/api/interfaces/emap.FeatureEvent.html)

## 可运行示例

- [feature-selection](/mapseekai/emap/examples/feature-selection/)
- [web-worker](/mapseekai/emap/examples/web-worker/)

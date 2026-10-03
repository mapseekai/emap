---
id: camera
slug: /guides/camera
title: 相机
api: ["Emap", "Bounds", "Viewport", "CameraOptions", "AnimationOptions", "FlyToOptions", "FitBoundsOptions"]
examples: ["getting-started/geojson-viewer","crs-switch"]
stability: stable
verifiedVersion: 0.14.0
---

# 相机

相机支持立即定位、平滑平移缩放、飞行和范围适配，以中心和比例管理二维视图；目标中心使用数据/投影坐标。WebMercator 可用 `zoom`，任意 CRS 可用 `scale`。

```ts
map.jumpTo({ center: [121.47, 31.23], zoom: 10 }); // 立即定位
map.flyTo({ center: [121.47, 31.23], zoom: 11, speed: 1.2 }); // 远距离飞行
map.fitBounds(source.getExtent(), { padding: 32 }); // 适配数据范围
```

## 核心方法

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `jumpTo(options)` | `CameraOptions` | 立即应用中心和比例。 |
| `easeTo(options)` | `CameraOptions & AnimationOptions` | 平滑过渡：线性插值中心，对数插值比例。 |
| `flyTo(options)` | `FlyToOptions` | 远距离用 van Wijk 曲线，近距离平滑过渡。 |
| `fitBounds(bounds, options?)` | `Bounds`, `FitBoundsOptions` | 居中范围并按容器和内边距计算比例。 |

### `CameraOptions`

`jumpTo()`、`easeTo()` 和 `flyTo()` 共享：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `center` | `[number, number]` | 当前中心 | 目标中心的数据/投影坐标。 |
| `zoom` | `number` | 当前比例保持 | WebMercator 目标缩放级别。 |
| `scale` | `number` | 当前比例保持 | 目标像素比例，有限正数；优先于 `zoom`。 |

### `AnimationOptions`

`easeTo()`、`flyTo()`、`fitBounds()` 等动画方法共享：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `duration` | `number` | `1000`（毫秒） | 动画时长（毫秒），有限非负。 |
| `easing` | `(t: number) => number` | `Tween.sineInOut` | 进度缓动函数。 |
| `animate` | `boolean` | `true` | `false` 或 `duration: 0` 立即更新视图。 |

### `FitBoundsOptions`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `padding` | `number` | `0` | 四边统一内边距（像素）。 |
| `maxScale` | `number` | 未设置 | 拟合结果的最大比例。 |
| `duration`、`easing`、`animate` | — | — | 继承 `AnimationOptions` 全部参数。 |

## 更多视图操作

```ts
map.panBy([80, 0], { duration: 250 }); // 像素偏移平移，为浮层让位
map.zoomTo(12); // 过渡到指定缩放级别
map.stop(); // 结束当前动画
```

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `setCenter(center)` | `[number, number]` | 立即更新中心并保留比例。 |
| `setZoom(zoom)` | `number` | 立即更新 WebMercator 缩放级别。 |
| `panTo(center, options?)` | `[number, number]`, `AnimationOptions` | 平滑移动到目标中心。 |
| `panBy(offset, options?)` | `[number, number]`, `AnimationOptions` | 将像素偏移转为 `[dx / scale, -dy / scale]`。 |
| `zoomTo(zoom, options?)` | `number`, `AnimationOptions` | 平滑过渡到 WebMercator 缩放级别。 |
| `stop()` | 无 | 结束相机动画并发出终止事件。 |
| `zoomIn()` / `zoomOut()` | 无 | 以 `1.15` / `1 / 1.15` 倍比例动画缩放。 |

`FlyToOptions` 在 `CameraOptions`、`AnimationOptions` 上额外提供：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `curve` | `number` | `1.42` | van Wijk 飞行曲率。 |
| `speed` | `number` | 未设置 | 平均飞行速度（屏幕宽度/秒），有限正数；覆盖 `duration`。 |

## 读取视图与事件

```ts
const center = map.getCenter(); // WebMercator 为 [longitude, latitude]
const extent = map.getExtent(); // 当前视口的 Bounds 副本

map.on('moveend', (event) => {
  const savedView = { center: event.center, zoom: event.zoom };
});
```

`getZoom()` 返回 WebMercator 缩放级别（其他 CRS 为 `0`）。相机移动发出 `movestart`、`move`、`moveend`；比例变化还发出 `zoomstart`、`zoom`、`zoomend`。事件 `center` 使用数据/投影坐标，`zoom` 为 `log2(scale)`。

## 范围管理

`Bounds` 用数据/投影坐标表达轴对齐范围：`new Bounds(xmin, ymin, xmax, ymax)`（默认 `Infinity` 空范围），`bounds.hasBounds()` 判断是否有效。

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `setExtent(bounds)` | `Bounds` | 保存范围副本并适配视口。 |
| `reset()` | 无 | 合并 source 范围后适配，否则恢复初始范围。 |
| `resize()` | 无 | 容器尺寸变化后更新 Canvas 和视口。 |

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [CRS 切换](/mapseekai/emap/examples/crs-switch/)

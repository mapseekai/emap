---
id: camera
slug: /guides/camera
title: 相机
api: ["Emap", "Bounds", "Viewport", "CameraOptions", "AnimationOptions", "FlyToOptions", "FitBoundsOptions"]
examples: ["getting-started/geojson-viewer","crs-switch"]
stability: stable
verifiedVersion: 0.12.0
---

# 相机

相机控制二维地图的中心和比例。中心使用地图的投影/数据坐标；`zoom` 是 WebMercator 的便利值，任意 CRS 都可以使用 `scale`。

## 立即或平滑地移动视图

```ts
map.jumpTo({ center: [121.47, 31.23], zoom: 10 });
map.easeTo({ center: [121.5, 31.2], scale: 4, duration: 600 });
map.panBy([80, 0], { duration: 250 });
map.zoomTo(12, { duration: 250 });
map.flyTo({ center: [121.47, 31.23], zoom: 11, speed: 1.2 });
```

`jumpTo()` 立即移动。`easeTo()`、`panTo()`、`panBy()`、`zoomTo()` 和 `flyTo()` 可以使用 `duration`、`easing` 或 `animate: false`。每次新动画替换正在运行的相机动画；`map.stop()` 取消动画。

## 适配数据范围

用 `Bounds` 适配已知范围，或从 source 读取范围：

```ts
const bounds = new Bounds(121.2, 31.1, 121.8, 31.5);
map.fitBounds(bounds, { padding: 32, duration: 400 });

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent);
```

`fitBounds()` 使用数据坐标，并支持 `padding` 和 `maxScale`。容器尺寸变化后调用 `map.resize()`，以更新 Canvas 和视口。

## 读取和监听视图

```ts
const center = map.getCenter();
const zoom = map.getZoom();
const extent = map.getExtent();

map.on('moveend', (event) => {
  const savedView = { center: event.center, zoom: event.zoom };
});
```

Emap 不提供 bearing 或 pitch。对于 zoom 没有 CRS 含义的数据，使用中心、范围和比例而不是将 zoom 用作业务坐标。

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [CRS 切换](/mapseekai/emap/examples/crs-switch/)

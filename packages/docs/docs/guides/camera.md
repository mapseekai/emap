---
id: camera
slug: /guides/camera
title: 相机
api: []
examples: []
stability: stable
verifiedVersion: 0.8.1
---

# 相机

相机控制地图中心和缩放比例。Emap 是二维地图，不提供 bearing 或 pitch。相机中心使用
当前地图的 projected/data 坐标；Canvas 指针使用容器内像素坐标。

## 即时移动

```ts
map.jumpTo({
  center: [120, 30],
  zoom: 7,
});
```

也可以只设置一项：

```ts
map.setCenter([120, 30]);
map.setZoom(7);
```

`zoom` 是 WebMercator 便利值。非 WebMercator CRS 中，使用 CRS 无关的 `scale`
更明确：

```ts
map.jumpTo({
  center: [500000, 3400000],
  scale: 0.002,
});
```

同一调用同时提供 `scale` 和 `zoom` 时，`scale` 优先。

## 适配数据范围

```ts
const extent = source.getExtent();

if (extent.hasBounds()) {
  map.fitBounds(extent, {
    padding: 48,
    duration: 0,
  });
}
```

`padding` 是四边统一的像素内边距。首次绘制、自动化场景和不希望出现动画时使用
`duration: 0` 或 `animate: false`。

`setExtent(extent)` 直接替换 viewport 范围；`fitBounds` 通过相机流程适配范围，
并支持 padding、动画和 `maxScale`。

## 平滑动画

```ts
map.easeTo({
  center: [121.47, 31.23],
  zoom: 9,
  duration: 800,
});
```

单独平移或缩放：

```ts
map.panTo([121.47, 31.23], { duration: 500 });
map.panBy([80, 0], { duration: 300 });
map.zoomTo(10, { duration: 500 });
```

`panBy` 接收 Canvas 像素偏移。

长距离移动使用 van Wijk flight：

```ts
map.flyTo({
  center: [116.4, 39.9],
  zoom: 8,
  speed: 1.2,
  curve: 1.42,
});
```

同一时间只有一个相机动画；后一次调用会结束前一次。主动取消：

```ts
map.stop();
```

## 动画选项

| 选项 | 说明 |
|---|---|
| `duration` | 毫秒；ease/fly 默认 `1000` |
| `easing` | 接收 `0..1` 并返回缓动进度的函数 |
| `animate` | `false` 时立即跳转 |
| `curve` | `flyTo` 曲率，默认 `1.42` |
| `speed` | `flyTo` 平均屏幕距离/秒；提供时覆盖 duration |

## 坐标转换

地图坐标转 Canvas 像素：

```ts
const [x, y] = map.project(120, 30);
```

Canvas 像素转地图坐标：

```ts
const [mapX, mapY] = map.unproject(x, y);
```

不要把经纬度和任意 projected CRS 混用。`project` 只执行当前地图坐标与屏幕坐标的
视口转换，不负责在 EPSG 坐标系之间重投影。

## 相机事件

```ts
map.on('movestart', ({ center, zoom }) => {
  console.log('开始', center, zoom);
});

map.on('moveend', ({ center, zoom, originalEvent }) => {
  console.log('结束', center, zoom, originalEvent);
});
```

程序调用产生的 `originalEvent` 为 `null`。`move` 事件可能没有完整相机字段，
需要最终状态时使用 `moveend`。

## 容器尺寸变化

地图容器因侧栏、弹窗或布局变化而改变尺寸后调用：

```ts
map.resize();
```

浏览器窗口 resize 会由地图监听，但应用自身只改变容器布局时仍应显式通知地图。

## 常见问题

### 数据加载成功但画面空白

检查 extent 是否有效，并在加载完成后调用 `setExtent` 或 `fitBounds`。

### 非 WebMercator 数据的 zoom 不符合预期

zoom 是 WebMercator 便利概念。对其他 CRS 优先使用数据范围、`fitBounds` 或 `scale`。

### 动画在组件切换后继续

在视图离开或开始另一项导航前调用 `map.stop()`。

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [CameraOptions](/mapseekai/emap/api/interfaces/emap.CameraOptions.html)
- [FitBoundsOptions](/mapseekai/emap/api/interfaces/emap.FitBoundsOptions.html)
- [FlyToOptions](/mapseekai/emap/api/interfaces/emap.FlyToOptions.html)

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [CRS 切换](/mapseekai/emap/examples/crs-switch/)
- [范围适配](../recipes/fit-bounds.md)

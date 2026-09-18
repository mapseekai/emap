---
id: fit-bounds
slug: /recipes/fit-bounds
title: 适配范围
api: ["Emap", "Bounds", "FitBoundsOptions"]
examples: ["getting-started/geojson-viewer", "getting-started/polygon-fill"]
stability: stable
verifiedVersion: 0.13.0
---

# 适配范围

数据加载后，用其 `Bounds` 适配相机。空数据源（包括过滤后无要素）范围为空，调用 `fitBounds` 前检查 `hasBounds()`。


```ts
const extent = source.getExtent(); // 读取已加载数据的范围
if (extent.hasBounds()) {
  // 空 source 不能适配
  map.fitBounds(extent, { padding: 48, duration: 0 }); // 首次视图不使用动画
}
```

## 核心参数

`map.fitBounds(bounds, options?)` 将相机居中于 `bounds`，按可用视口的限制方向计算适配比例，并返回当前 `Emap` 实例。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `bounds` | `Bounds` | 必填 | 要显示的数据坐标范围 |
| `options` | `FitBoundsOptions` | `{}` | 相机适配与动画配置 |

`FitBoundsOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `padding` | `number` | `0` | 每边像素内边距，为侧栏、图例或浮层留出空间 |
| `duration` | `number` | `1000` | 动画时长（毫秒）；首次加载用 `0` |
| `animate` | `boolean` | `true` | 是否执行动画；`false` 或 `duration: 0` 可同步定位 |
| `easing` | `(t: number) => number` | `Tween.sineInOut` | 接收并返回 `0` 到 `1` 的动画进度 |
| `maxScale` | `number` | `undefined` | 相机 scale 上限，限制点、短线或小面范围的放大 |

## 更多 Bounds 操作

`Bounds` 使用数据坐标，构造顺序为西、南、东、北：

```ts
const district = new Bounds(116.2, 39.7, 116.6, 40.1);
const districtFromArray = Bounds.fromArray([116.2, 39.7, 116.6, 40.1]);

if (district.hasBounds()) {
  map.fitBounds(district);
}
```

`new Bounds()` 创建空范围；`Bounds.fromArray()` 接受 `[xmin, ymin, xmax, ymax]` 边界框。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `xmin` | `number` | `Infinity` | 最小 x 坐标（西侧或左侧） |
| `ymin` | `number` | `Infinity` | 最小 y 坐标（南侧或下侧） |
| `xmax` | `number` | `-Infinity` | 最大 x 坐标（东侧或右侧） |
| `ymax` | `number` | `-Infinity` | 最大 y 坐标（北侧或上侧） |

`Bounds.fromArray()`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `arr` | `[number, number, number, number]` | 必填 | `[xmin, ymin, xmax, ymax]` 顺序的边界框 |

`hasBounds(): boolean` 在 `xmin <= xmax` 且 `ymin <= ymax` 时返回 `true`；点要素的零宽高范围也有效。


## API

- `Emap`
- `Bounds`
- `FitBoundsOptions`

## 可运行示例

- [GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [面填充](/mapseekai/emap/examples/getting-started/polygon-fill/)

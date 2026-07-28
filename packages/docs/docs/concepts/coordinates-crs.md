---
id: coordinates-crs
slug: /concepts/coordinates-crs
title: 坐标与 CRS
api: ["AffineTransform","AnimationOptions","Bounds","CameraOptions","DEFAULT_CRS","Emap","FitBoundsOptions","FlyToOptions","inferFromPrj","normalizeCrsString","Projection","resolveDatasetCRS","Viewport"]
examples: ["crs-switch","project"]
stability: stable
verifiedVersion: 0.5.0
---

# 坐标与 CRS

emap 同时处理三种坐标空间：

| 空间 | 示例 | 用途 |
|---|---|---|
| dataset/map 坐标 | `[120, 30]` 或 `[13358338, 3503549]` | 几何、相机中心和空间操作 |
| Canvas 像素 | `[320, 180]` | 指针命中、控件和屏幕叠加物 |
| CRS 标识 | `EPSG:4326`、`EPSG:3857` | 解释 dataset 坐标含义 |

不要把 Canvas 像素当成经纬度，也不要假设每个 dataset 都使用 WGS84。

## CRS 识别

`TopologySource.getCRS()` 会按导入元数据解析：

1. `crs_string`
2. `.prj` / WKT
3. mapshaper 解析后的 CRS
4. 无法识别时回退到 `EPSG:4326`

```ts
console.log(source.getCRS());
console.log(map.getCRS());
```

回退值不代表数据一定是经纬度。来源不明的文件应允许用户确认或覆盖 CRS。

## 设置显示 CRS 与重投影

`setCRS` 只更新 projection/viewport 对坐标的解释，不改写 source 坐标：

```ts
map.setCRS('EPSG:3857');
```

需要真正转换所有已注册 source：

```ts
await map.reproject('EPSG:3857');
```

`reproject` 会：

- 转换 source dataset 坐标。
- 更新 CRS 元数据。
- 清理空间索引。
- 用新范围更新 viewport。
- 触发 `crschange` 和 `data`。

如果只处理一个目标 layer，也可以使用：

```ts
const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
});
```

`ProjectOptions` 的字段名是 `crs`，不是 `targetCrs`。

## 地图坐标与屏幕坐标

```ts
const [screenX, screenY] = map.project(120, 30);
const [mapX, mapY] = map.unproject(screenX, screenY);
```

`project(x, y)` 只应用当前 viewport 变换，不执行 EPSG 重投影。EPSG 转换使用
`reproject` 或 project operation。

## 范围

`Bounds` 表示 dataset/map 坐标范围：

```ts
const extent = source.getExtent();

if (extent.hasBounds()) {
  map.fitBounds(extent, {
    padding: 32,
    duration: 0,
  });
}
```

空 layer 或过滤后无 geometry 的数据可能返回空范围，移动相机前先检查。

## 距离和面积单位

空间操作的距离、容差和面积阈值通常使用 dataset 坐标单位：

- projected CRS 通常是米或英尺，具体由 CRS 定义。
- `EPSG:4326` 使用角度，不是米。
- buffer、simplify tolerance、snap interval 不能默认解释为米。

对地理 CRS 执行距离操作前，优先重投影到合适的本地 projected CRS。DuckDB
距离类 helper 默认拒绝部分地理 CRS 操作，除非显式允许基于角度的行为。

## 相机 zoom 与 scale

`zoom` 是 WebMercator 便利值；其他 CRS 使用 `fitBounds` 或 `scale` 更可靠：

```ts
map.jumpTo({
  center: [500000, 3400000],
  scale: 0.002,
});
```

同一相机调用同时提供 `scale` 和 `zoom` 时，`scale` 优先。

## 常见问题

### 重投影后数据位置异常

检查 source 原始 CRS 是否识别正确。错误地把 projected 坐标标记成 EPSG:4326，
再重投影会产生无意义结果。

### buffer 半径远大于预期

确认 `radius` 的 dataset 单位。经纬度数据中的 `1` 表示一度，不是一米。

### 屏幕点击坐标无法查询

`queryFeatures` 接收 Canvas 容器内像素。使用浏览器事件时应由 emap Handler
归一化坐标，或先减去容器位置。

## API

- [Emap](/emap/api/classes/index.Emap.html)
- [Bounds](/emap/api/classes/index.Bounds.html)
- [Projection](/emap/api/classes/index.Projection.html)
- [resolveDatasetCRS](/emap/api/functions/index.resolveDatasetCRS.html)
- [ProjectOptions](/emap/api/interfaces/index.ProjectOptions.html)

## 可运行示例

- [投影操作](/emap/examples/project/)
- [CRS 切换](/emap/examples/crs-switch/)
- [DuckDB buffer](/emap/examples/duckdb-buffer/)

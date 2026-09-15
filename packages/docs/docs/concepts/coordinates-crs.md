---
id: coordinates-crs
slug: /concepts/coordinates-crs
title: 坐标与 CRS
api: ["AffineTransform", "AnimationOptions", "Bounds", "CameraOptions", "DEFAULT_CRS", "Emap", "FitBoundsOptions", "FlyToOptions", "inferFromPrj", "normalizeCrsString", "Projection", "resolveDatasetCRS", "setDatasetCrsMetadata", "Viewport"]
examples: ["crs-switch","project","duckdb-buffer"]
stability: stable
verifiedVersion: 0.12.0
---

# 坐标与 CRS

Emap 区分 dataset/map 坐标、Canvas 像素和 CRS 标识。几何、相机中心和空间操作使用 dataset/map 坐标；指针命中和屏幕叠加物使用 Canvas 本地像素；CRS 说明坐标数值代表的位置和单位。

| 空间 | 示例 | 用途 |
| --- | --- | --- |
| dataset/map 坐标 | `[120, 30]`、`[13358338, 3503549]` | 几何、范围、相机、操作 |
| Canvas 像素 | `[320, 180]` | 指针、命中测试、屏幕 UI |
| CRS 标识 | `EPSG:4326`、`EPSG:3857` | 解释坐标和单位 |

Canvas 像素不是经纬度，dataset 坐标也不一定是 WGS84。

## 读取和确定 CRS

`source.getCRS()` 与 `map.getCRS()` 返回 CRS 字符串。`resolveDatasetCRS(dataset)` 从 dataset 元数据解析 CRS，在没有可识别元数据时返回 `DEFAULT_CRS`（`EPSG:4326`）。该回退值不能证明原始坐标就是经纬度；来源不明的数据应由应用收集 CRS。

```ts
console.log(source.getCRS());
console.log(map.getCRS());
```

空地图可用 `map.setCRS('EPSG:3857')` 预设 CRS。第一个注册的 source 会在地图尚未预设 CRS 时建立活动 CRS。后续 source 在注册前会归一到地图 CRS。

将外部构造的 dataset 挂到地图前，可用 `setDatasetCrsMetadata(dataset, crs)` 显式写入 CRS 元数据：给定的 `crs` 会替换 dataset 内嵌的 prj/wkt1 提示，传入 `undefined` 则清除。

## 重投影地图或导出图层

已注册 source 的地图通过 `map.reproject(...)` 改变 CRS：

```ts
await map.reproject('EPSG:3857');
```

该操作将所有已注册 source 转换到目标 CRS，更新 CRS 元数据、空间索引和视图。一个 source 转换失败时不提交任何 source。已注册数据不能用 `setCRS` 仅改变解释；`setCRS` 用于没有 source 的地图。

要以另一 CRS 导出某个 layer 而不改变地图，使用 `projectLayer`：

```ts
const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
  output: { format: 'geojson', filename: 'districts-3857.geojson' },
});

if (result.ok) {
  const { blob, filename } = result.value;
  console.log(blob, filename);
}
```

`projectLayer` 处理隔离副本，返回导出文件，不修改地图 source、活动 CRS 或 viewport。

## 地图坐标与屏幕坐标

```ts
const [screenX, screenY] = map.project(120, 30);
const [mapX, mapY] = map.unproject(screenX, screenY);
```

`project` 和 `unproject` 只应用 viewport 变换，不进行 EPSG 坐标转换。`queryFeatures` 使用 Canvas 本地像素；浏览器事件坐标需要先换算到容器内。

## 范围、距离和单位

`Bounds` 表示 dataset/map 坐标范围。加载后检查范围再移动相机：

```ts
const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 });
```

buffer 半径、simplify tolerance、snap interval 和面积阈值使用 dataset 坐标单位。投影 CRS 的单位可能是米或英尺；`EPSG:4326` 的单位是度。距离或面积操作应在适合该区域的投影 CRS 下执行，而不是把经纬度数值当成米。

## 相机 zoom 与 scale

`zoom` 是 Web Mercator 便利值。其他 CRS 使用 `fitBounds` 或 CRS 无关的 `scale`：

```ts
map.jumpTo({
  center: [500000, 3400000],
  scale: 0.002,
});
```

同一相机调用同时提供 `scale` 和 `zoom` 时，`scale` 优先。

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [Bounds](/mapseekai/emap/api/classes/emap.Bounds.html)
- [resolveDatasetCRS](/mapseekai/emap/api/functions/emap.resolveDatasetCRS.html)
- [setDatasetCrsMetadata](/mapseekai/emap/api/functions/emap.setDatasetCrsMetadata.html)

## 可运行示例

- [CRS 切换](/mapseekai/emap/examples/crs-switch/)
- [投影操作](/mapseekai/emap/examples/project/)
- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)

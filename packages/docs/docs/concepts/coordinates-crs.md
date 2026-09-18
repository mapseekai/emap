---
id: coordinates-crs
slug: /concepts/coordinates-crs
title: 坐标与 CRS
api: ["AffineTransform", "AnimationOptions", "Bounds", "CameraOptions", "DEFAULT_CRS", "Emap", "FitBoundsOptions", "FlyToOptions", "inferFromPrj", "normalizeCrsString", "Projection", "resolveDatasetCRS", "setDatasetCrsMetadata", "Viewport"]
examples: ["crs-switch","project","duckdb-buffer"]
stability: stable
verifiedVersion: 0.13.0
---

# 坐标与 CRS

Emap 使用 dataset/map 坐标保存几何和空间计算，使用 Canvas 像素进行交互和绘制，并以 CRS 标识定义坐标含义与单位。

```ts
const map = await Emap.create({ container: '#map' }); // 创建地图实例
map.setCRS('EPSG:3857'); // 为空地图建立 CRS
const source = await TopologySource.create('places', {
  // 创建带 CRS 的空 source
  name: 'places', // 设置数据 layer 名称
  geometryType: 'point', // 设置几何类型
  crs: 'EPSG:3857', // 指定输入坐标 CRS
});
await map.addSource('places', source); // 登记 source 并统一地图 CRS
```

## 核心方法

| API | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `map.setCRS(crs)` | `crs: string` | 必填 | 为无 source 的地图设置活动 CRS。 |
| `map.getCRS()` / `source.getCRS()` | 无 | — | 读取地图 / source CRS。 |
| `map.project(x, y)` / `map.unproject(px, py)` | 两个 `number` | 必填 | 当前 CRS 坐标与 Canvas 本地像素互转。 |
| `map.reproject(targetCrs)` | `targetCrs: string` | 必填 | 重投影已登记 source、元数据、索引和视图，并创建可撤销记录。 |

| 空间 | 示例 | 用途 |
| --- | --- | --- |
| dataset/map 坐标 | `[120, 30]`、`[13358338, 3503549]` | 几何、范围、相机和空间操作。 |
| Canvas 像素 | `[320, 180]` | 指针、命中测试和屏幕 UI。 |
| CRS 标识 | `EPSG:4326`、`EPSG:3857` | 坐标位置和单位。 |

## 更多 CRS 设置

`Emap.create(options)` 初始化地图。`TopologySource.create(id, options)` 创建独立空 layer；`map.addSource(id, source, answers)` 为导入 source 建立 CRS。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `Emap.create(options)` 的 `options` | `EmapOptions` | `{}` | 地图初始化选项。 |
| `TopologySource.create(id, options)` 的 `id` / `options` | `string` / `CreateLayerOptions` | 必填 | source 标识 / 空 layer 及 CRS 元数据。 |
| `name` / `geometryType` | `string` / `'point' \| 'polyline' \| 'polygon'` | 必填 | layer 名称 / 几何类型。 |
| `crs` / `fields` | `string` / `readonly LayerFieldDefinition[]` | 必填 / `[]` | 新 layer CRS / 初始属性字段。 |
| `map.addSource` 的 `id` / `source` / `answers.sourceCrs` | `string` / `TopologySource` / `string` | 必填 / 必填 / source 元数据 | 注册名 / source / 导入坐标 CRS 覆盖值。 |

`DEFAULT_CRS` 为 `EPSG:4326`。`resolveDatasetCRS(dataset)` 缺省为它；`normalizeCrsString(str)` 规范化外部标签；`inferFromPrj(prj)` 从 `.prj`/WKT 提取 EPSG；`setDatasetCrsMetadata(dataset, crs)` 写入 CRS 并清理 `prj`/`wkt1`。

## 更多重投影

```ts
await map.reproject('EPSG:3857'); // 重投影地图及其已登记 source
```

| API | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source.reproject(targetCrs, targetCrsMetadata?)` | `string`、`string \| undefined` | `targetCrs` 必填、元数据 `undefined` | 重投影独立 source 并可写入规范 CRS 元数据。 |
| `map.ops.projectLayer(options)` | `source`、`target`、`crs` | 必填 | 导出另一 CRS 的 layer 副本，不改变地图状态。 |
| `options.init` / `densify` | `string` / `boolean` | source 元数据 / `false` | 输入 CRS 覆盖值 / 投影曲线的中间顶点。 |
| `output.format` / `output.filename` | `ExportFormat` / `string` | `'geojson'` / `${target}.${format}` | Blob 格式 / 建议文件名。 |

```ts
const result = await map.ops.projectLayer({
  // 导出重投影后的 layer 副本
  source: 'main', // 选择 source
  target: 'districts', // 选择 layer
  crs: 'EPSG:3857', // 选择输出 CRS
  output: { format: 'geojson', filename: 'districts-3857.geojson' }, // 设置导出文件
});

if (result.ok) {
  // 仅在成功时读取结果
  const { blob, filename } = result.value; // 取得 Blob 和文件名
  console.log(blob, filename); // 使用导出结果
}
```

## 更多坐标空间

```ts
const [screenX, screenY] = map.project(120, 30); // 转为 Canvas 本地像素
const [mapX, mapY] = map.unproject(screenX, screenY); // 转回当前 CRS 坐标
```

`project`/`unproject` 应用当前视图变换；EPSG 转换使用 `reproject` 或 `projectLayer`。底层 `AffineTransform` 为 `project(x, y) = [x * mx + bx, y * my + by]`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `new AffineTransform(mx, my, bx, by)` | 四个 `number` | `1`、`1`、`0`、`0` | X/Y 缩放与 X/Y 平移。 |
| `projection.setCRS(crs)` | `string` | 必填 | Projection CRS 标签。 |
| `projection.getCenter(cx, cy)` / `projection.getScale(zoom)` / `projection.getZoom(mx)` | `number` | 必填 | 中心 / zoom 的 scale / X scale 的 zoom。 |
| `viewport.setCRS(crs)` | `string` | 必填 | Viewport CRS 提示。 |
| `viewport.project(x, y)` / `viewport.unproject(px, py)` | 两个 `number` | 必填 | dataset/map 与 Viewport 像素互转。 |

`Projection` 初始 CRS 为 `EPSG:4326`；`Viewport` 初始为单位变换。

## 范围、距离和单位

`Bounds` 表示 dataset/map 范围；`source.getExtent()` 返回它。buffer、simplify、snap 和面积阈值都使用 dataset 坐标单位。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `new Bounds(xmin, ymin, xmax, ymax)` | 四个 `number` | `Infinity`、`Infinity`、`-Infinity`、`-Infinity` | 最小 X/Y 与最大 X/Y。 |
| `map.fitBounds(bounds, options)` | `Bounds`、`FitBoundsOptions` | bounds 必填 | 显示范围。 |
| `options.padding` / `maxScale` | `number` | `0` / 未限制 | Canvas 像素内边距 / 拟合最大 scale。 |
| `options.duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | 动画时长、缓动和开关。 |

```ts
const extent = source.getExtent(); // 读取数据范围
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 }); // 立即适配有效范围
```

## 相机 zoom 与 scale

`CameraOptions` 服务于 `jumpTo`、`easeTo` 和 `flyTo`。`Projection` 处理 Web Mercator zoom/scale；其他 CRS 使用 `scale`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options.center` / `zoom` / `scale` | `[number, number]` / `number` / `number` | 当前中心 / 当前 zoom / 当前 scale | 目标中心 / Web Mercator zoom / 优先于 `zoom` 的 scale。 |
| `options.duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | 动画时长、缓动和开关。 |
| `options.curve` / `speed` | `number` | `1.42` / 自动计算 | `flyTo` van Wijk 曲率 / 飞行速度。 |

```ts
map.jumpTo({
  // 立即更新相机
  center: [500000, 3400000], // 使用投影坐标设置中心
  scale: 0.002, // 为任意 CRS 设置比例
});
```

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [Bounds](/mapseekai/emap/api/classes/emap.Bounds.html)
- [AffineTransform](/mapseekai/emap/api/classes/emap.AffineTransform.html)
- [Projection](/mapseekai/emap/api/classes/emap.Projection.html)
- [Viewport](/mapseekai/emap/api/classes/emap.Viewport.html)
- [CameraOptions](/mapseekai/emap/api/interfaces/emap.CameraOptions.html)
- [AnimationOptions](/mapseekai/emap/api/interfaces/emap.AnimationOptions.html)
- [FitBoundsOptions](/mapseekai/emap/api/interfaces/emap.FitBoundsOptions.html)
- [FlyToOptions](/mapseekai/emap/api/interfaces/emap.FlyToOptions.html)
- [DEFAULT_CRS](/mapseekai/emap/api/variables/emap.DEFAULT_CRS.html)
- [resolveDatasetCRS](/mapseekai/emap/api/functions/emap.resolveDatasetCRS.html)
- [normalizeCrsString](/mapseekai/emap/api/functions/emap.normalizeCrsString.html)
- [inferFromPrj](/mapseekai/emap/api/functions/emap.inferFromPrj.html)
- [setDatasetCrsMetadata](/mapseekai/emap/api/functions/emap.setDatasetCrsMetadata.html)

## 可运行示例

- [CRS 切换](/mapseekai/emap/examples/crs-switch/)
- [投影操作](/mapseekai/emap/examples/project/)
- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)

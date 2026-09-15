---
id: geopackage
slug: /data/geopackage
title: GeoPackage 矢量直接导入
api: ["importGeoPackage", "importGeoPackageInWorker", "geoPackagePlugin", "ImportGeoPackageOptions", "GeoPackageWorkerOptions", "GeoPackagePluginOptions", "GeoPackageLimits", "GeoPackageProgress", "GeoPackageDataset", "GeoPackageMetadata", "GeoPackageTableMetadata"]
examples: ["geopackage-viewer"]
stability: experimental
verifiedVersion: unreleased
---

# GeoPackage 矢量直接导入

`@mapseekai/emap/geopackage` 使用 `@ngageoint/geopackage@4.2.9` 的 SQL.js/WASM 适配器读取 SQLite 数据库。它不调用该库的 GeoJSON、wkx 几何对象或瓦片 API，而是直接解码 GP Binary/WKB 到数值缓冲区。

```text
.gpkg bytes
  → SQLite WASM / prepared statement
  → gpkg_contents + gpkg_geometry_columns + gpkg_spatial_ref_sys
  → GP Binary header + WKB
  → Float64Array XY + Int32Array arc lengths
  → mapshaper layers + DataTable + one shared ArcCollection
  → one dataset / one topology build
```

默认读取所有 `data_type = 'features'` 表。每个矢量表保留独立图层、名称、字段与属性，所有图层位于同一个 dataset；`tiles`、`attributes` 等非矢量表不进入结果。纯瓦片 GeoPackage 会明确报错。不会为每个表创建一个独立 Source。

## 安装与静态资源

依赖通过 `pnpm add @ngageoint/geopackage` 安装在 emap 的依赖图中。当前版本固定为 4.2.9；低层 SQL.js 适配器是专门的集成边界。浏览器无需原生 `better-sqlite3`，仓库明确禁用其构建脚本。

将这些发布资源部署到同一公开目录：

```text
@mapseekai/emap/dist/emap-geopackage-worker.js
@mapseekai/emap/dist/mapshaper-vendor.js
@mapseekai/emap/dist/sql-wasm.wasm
```

主线程导入只需指定 `wasmUrl`；Worker 导入还需 `workerUrl`，Worker 与 `mapshaper-vendor.js` 必须相邻。服务器应正确返回 JavaScript 和 `application/wasm`，并在 CSP 中允许应用使用 Worker/WASM。不依赖 CDN。编译后的 WASM 模块可在同一执行环境复用，数据库连接始终属于单次导入。

## 直接获得一个 dataset

```ts
import { importGeoPackage } from '@mapseekai/emap/geopackage';

const bytes = await file.arrayBuffer();
const dataset = await importGeoPackage(bytes, {
  wasmUrl: '/assets/sql-wasm.wasm',
  // 不传 layers 时读取全部矢量表。
  layers: ['roads', 'stations'],
  targetCrs: 'EPSG:3857',
});
console.log(dataset.layers);
console.log(dataset.arcs?.getVertexData?.().xx);
console.log(dataset.info.geopackage.tables);
```

SQL 采用两遍读取：第一遍校验并统计几何大小，第二遍按确切长度写入 TypedArray，避免先构造一棵完整 GeoJSON 几何树。线/面坐标直接进入共享弧段数组；点坐标仅在最终 mapshaper 边界转成其原生 `PointShape` 元组。属性直接进入 DataTable。默认构建共享拓扑，以支持编辑和空间操作；`noTopology: true` 只适用于不需要拓扑的临时结果。

## 通过原生 Cordis 格式插件加载

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';

const map = await Emap.create({ container: 'map' });
const fiber = map.ctx.plugin(geoPackagePlugin({
  workerUrl: '/assets/emap-geopackage-worker.js',
  wasmUrl: '/assets/sql-wasm.wasm',
}));
await fiber.await();

const source = new TopologySource('gpkg', { formats: map.formats });
await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
await map.addSource('gpkg', source);

for (const [index, layer] of source.getLayers().entries()) {
  const type = layer.geometry_type === 'point' ? 'circle'
    : layer.geometry_type === 'polyline' ? 'line'
    : layer.geometry_type === 'polygon' ? 'fill' : undefined;
  if (type) map.addLayer({ id: `gpkg-${index}`, source: 'gpkg', 'source-layer': layer.name, type });
}
await map.dispose();
```

格式注册属于该地图实例。单纯 import 模块不会注册格式或初始化数据库。`fiber.dispose()` 会撤销格式，并取消正在进行的导入；已经成功加载的 dataset 不会被删除。当前只支持导入，不提供 GeoPackage 写出。

## Worker、进度与取消

```ts
import { importGeoPackageInWorker } from '@mapseekai/emap/geopackage';

const controller = new AbortController();
const dataset = await importGeoPackageInWorker(bytes, {
  workerUrl: '/assets/emap-geopackage-worker.js',
  wasmUrl: '/assets/sql-wasm.wasm',
  signal: controller.signal,
  onProgress: ({ phase, table, rows }) => console.log(phase, table, rows),
});
// 用户取消时调用 controller.abort()。
```

SQLite 查询、WKB 解码、坐标归一和共享拓扑构建均在 Worker 中完成。弧段数组和点坐标通过 transferable ArrayBuffer 返回，接收端重建 ArcCollection/DataTable，不经 JSON 序列化。默认复制输入后转移副本，不会意外 detach 调用方的 bytes；只有显式 `transferInput: true` 且传入完整自有 ArrayBuffer 才转移原始输入。

取消会终止 Worker，并拒绝 Promise；失败不会静默回退主线程，也不会提交部分图层。主线程模式按批次让出执行权，无法强制抢占同步的拓扑构建，较大数据优先使用 Worker。

## 坐标系、几何与属性规则

| 情况 | 行为 |
| --- | --- |
| 不同表 CRS 不同 | 默认统一到第一个选中表的 CRS；也可明确指定 `targetCrs`。默认全部读取时按表名排序。 |
| CRS 未定义或不可解析 | 不臆测坐标系。不能把未知 CRS 与已知 CRS 混合；用 `sourceCrs: { tableName: 'EPSG:4326' }` 明确覆盖。 |
| Point / MultiPoint / LineString / MultiLineString / Polygon / MultiPolygon | 保留要素与多部件；面环按 shell/hole 语义规范方向。 |
| 混合 GEOMETRY / GeometryCollection | 按点、线、面拆为该表的子图层，仍在一个 dataset 内；空几何记录单独保留，混合要素的属性独立复制。 |
| NULL / EMPTY / 空表 | 保留属性记录与几何位置，空表保留字段和声明几何类型。 |
| Z / M / ZM | 正确按维度读取 WKB，只导入 XY；metadata 中记录 `hasZ/hasM`，不声称保留 3D 编辑能力。 |
| 曲线、扩展自定义 WKB、损坏 header/计数/坐标 | 明确拒绝整次导入，不静默忽略。 |
| 大整数、BLOB、日期 | 安全整数为 number，超出安全范围为十进制 string，BLOB 保留 Uint8Array，日期保持 SQLite 原始值。 |

`dataset.info.geopackage` 保留原表、几何列、原 SRS、原 SQL 列类型、输入记录数与输出图层映射。属性对象按安全自有属性创建，合法的 `__proto__` 字段不会污染对象原型。

## 资源限制与真实内存成本

默认输入与解码坐标预算各为 2 GiB，默认最多 1000 万输入记录、4096 个图层、32 层几何嵌套。可通过 `limits` 下调。SQLite WASM 会把数据库加载进自己的内存；输出记录、拓扑处理与 Worker 输入副本还需要额外内存。因此这不是零拷贝文件读取，也不保证 2 GiB 文件一定可在浏览器中导入。面向公网应使用更低限制。

[GeoPackage 多图层示例](/mapseekai/emap/examples/geopackage-viewer/) 默认运行 Worker 路径，可切到主线程比较结果，并显示各图层、共享弧段和原始导入 metadata。

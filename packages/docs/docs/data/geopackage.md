---
id: geopackage
slug: /data/geopackage
title: GeoPackage 矢量直接导入
api: ["importGeoPackage", "importGeoPackageInWorker", "geoPackagePlugin", "ImportGeoPackageOptions", "GeoPackageWorkerOptions", "GeoPackagePluginOptions", "GeoPackageLimits", "GeoPackageProgress", "GeoPackageDataset", "GeoPackageMetadata", "GeoPackageTableMetadata"]
examples: ["geopackage-viewer"]
stability: experimental
verifiedVersion: 0.12.0
---

# GeoPackage 矢量直接导入

`@mapseekai/emap/geopackage` 通过 `@ngageoint/geopackage@4.2.9` 的 SQL.js/WASM 适配器读取 SQLite，并将 GP Binary/WKB 直接解码为数值缓冲区。

```ts
import { importGeoPackage } from '@mapseekai/emap/geopackage'; // 导入 GeoPackage 读取器

const bytes = await file.arrayBuffer(); // 读取用户选择的 .gpkg 文件
const dataset = await importGeoPackage(bytes, {
  wasmUrl: '/assets/sql-wasm.wasm', // 指向部署的 SQL.js WASM
  layers: ['roads', 'stations'], // 只读取所需的要素表
  targetCrs: 'EPSG:3857', // 统一输出坐标系
});
```

## 核心参数

签名：`importGeoPackage(content: ArrayBuffer | Uint8Array, options?: ImportGeoPackageOptions): Promise<GeoPackageDataset>`。

`ImportGeoPackageOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `layers` | `readonly string[]` | 省略时读取全部矢量表 | 要素表名；非空且唯一，指定顺序保留。 |
| `targetCrs` | `string` | 第一张选中表的 CRS | 统一输出 CRS。 |
| `wasmUrl` | `string` | `'sql-wasm.wasm'` | SQL.js WASM URL。 |

导入先扫描几何以确定缓冲区长度，再写入 TypedArray。

## 更多导入方式

### 导入流程

```text
.gpkg bytes
  → SQLite WASM / prepared statement
  → gpkg_contents + gpkg_geometry_columns + gpkg_spatial_ref_sys
  → GP Binary header + WKB
  → Float64Array XY + Int32Array arc lengths
  → mapshaper layers + DataTable + one shared ArcCollection
  → one dataset / one topology build
```

默认读取 `data_type = 'features'` 表，保留各表图层、名称、字段和属性；纯瓦片包报错。

### 高级导入参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `sourceCrs` | `Readonly<Record<string, string>>` | `undefined` | 按表名覆盖源 CRS。 |
| `noTopology` | `boolean` | `false` | 是否构建线、面的共享弧拓扑。 |
| `limits` | `Partial<GeoPackageLimits>` | 见“资源限制与真实内存成本” | 资源阈值覆盖。 |
| `signal` | `AbortSignal` | `undefined` | 导入取消信号。 |
| `onProgress` | `(progress: GeoPackageProgress) => void` | `undefined` | 阶段进度回调。 |

### 安装与静态资源

安装 `@ngageoint/geopackage@4.2.9`，并将以下资源部署到公开目录：

```text
@mapseekai/emap/dist/emap-geopackage-worker.js
@mapseekai/emap/dist/mapshaper-vendor.js
@mapseekai/emap/dist/sql-wasm.wasm
```

主线程使用 `wasmUrl`；Worker 还需要 `workerUrl`，且须与 `mapshaper-vendor.js` 相邻。服务器和 CSP 必须支持 JavaScript、WASM 与 Worker。

### 通过原生 Cordis 格式插件加载

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';

const map = await Emap.create({ container: 'map' });
const fiber = map.ctx.plugin(geoPackagePlugin({
  workerUrl: '/assets/emap-geopackage-worker.js',
  wasmUrl: '/assets/sql-wasm.wasm',
  layers: ['roads'],
}));
await fiber.await();

const source = new TopologySource('gpkg', { formats: map.formats });
await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
await map.addSource('gpkg', source);
```

签名：`geoPackagePlugin(options?: GeoPackagePluginOptions): Plugin.Object`。插件注册 `.gpkg`；Fiber 释放时注销格式并取消未完成导入。

`GeoPackagePluginOptions` 继承 `ImportGeoPackageOptions` 及全部高级导入参数，并新增或覆盖：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `workerUrl` | `string \| URL` | `undefined` | GeoPackage Worker 脚本 URL；设置后使用 Worker 导入。 |
| `wasmUrl` | `string` | Worker 中为相对 `workerUrl` 的 `sql-wasm.wasm` | SQL.js WASM URL。 |

注册后，带 `formats: map.formats` 的 `TopologySource` 可按 `.gpkg` 加载。

### Worker、进度与取消

```ts
import { importGeoPackageInWorker } from '@mapseekai/emap/geopackage';

const controller = new AbortController();
const dataset = await importGeoPackageInWorker(bytes, {
  workerUrl: '/assets/emap-geopackage-worker.js',
  wasmUrl: '/assets/sql-wasm.wasm',
  signal: controller.signal,
  onProgress: ({ phase, table, rows }) => console.log(phase, table, rows),
});
```

签名：`importGeoPackageInWorker(content: ArrayBuffer | Uint8Array, options: GeoPackageWorkerOptions): Promise<GeoPackageDataset>`。`GeoPackageWorkerOptions` 继承 `ImportGeoPackageOptions`，要求 `workerUrl`（`string \| URL`，`emap-geopackage-worker.js` URL）；`transferInput`（`boolean`，默认 `false`）为 `true` 时转移自有 `ArrayBuffer`，否则复制后转移。省略 `wasmUrl` 时，Worker 从 `workerUrl` 目录解析 `sql-wasm.wasm`。

`GeoPackageProgress`：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `phase` | `'scan' \| 'decode' \| 'topology'` | 当前导入阶段。 |
| `table` | `string` | `scan` 和 `decode` 的当前表名；`topology` 阶段为 `undefined`。 |
| `rows` | `number` | 累计行数或拓扑输出 shape 数。 |

扫描和解码每 4096 行及表结束时报告；拓扑构建前报告一次。`signal` 可终止 Worker。

## 坐标系、几何与属性规则

| 情况 | 行为 |
| --- | --- |
| 不同表 CRS | 默认统一到第一张选中表的 CRS；`targetCrs` 可指定目标 CRS。 |
| CRS 未定义或不可解析 | `sourceCrs` 按表补充源 CRS。 |
| Point / MultiPoint / LineString / MultiLineString / Polygon / MultiPolygon | 保留要素和多部件；面环规范方向。 |
| 混合 GEOMETRY / GeometryCollection | 拆为点、线、面子图层，属性独立复制。 |
| NULL / EMPTY / 空表 | 保留属性、几何位置、字段和声明类型。 |
| Z / M / ZM | 读取维度，导入 XY，在 metadata 记录 `hasZ` / `hasM`。 |
| 大整数、BLOB、日期 | 安全整数为 `number`，大整数为十进制 `string`，BLOB 为 `Uint8Array`。 |

`GeoPackageDataset` 是带 `info.geopackage: GeoPackageMetadata` 的 `MapshaperDataset`：`tables` 为每张选中表一个 `GeoPackageTableMetadata`，`dimensions` 恒为 `'xy'`，`integerEncoding` 恒为 `'safe-number-or-decimal-string'`（SQLite 整数编码策略）。

每个 `GeoPackageTableMetadata`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `table` | `string` | 源表名 | GeoPackage 要素表名。 |
| `geometryColumn` | `string` | 源几何列名 | GP Binary 列。 |
| `declaredType` | `string` | 源声明值 | 大写几何类型。 |
| `sourceSrsId` | `number` | 源 SRS ID | 原始 `srs_id`。 |
| `sourceCrs` | `string \| null` | 解析结果 | 源或覆盖 CRS；无法解析时为 `null`。 |
| `rows` | `number` | 扫描结果 | 输入记录数。 |
| `outputLayers` | `string[]` | 导入结果 | 生成的 dataset 图层名。 |
| `hasZ`、`hasM` | `boolean` | 扫描结果 | 是否有 Z / M 维。 |
| `columns` | `Array<{ name: string; type: string; primary: number }>` | 源 schema | 表列名称、声明类型和主键序号。 |

## 资源限制与真实内存成本

`limits` 合并到默认值；每项须为正安全整数，`maxGeometryDepth` 至多为 256。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `maxInputBytes` | `number` | 2 GiB | 原始 GeoPackage 字节上限。 |
| `maxDecodedBytes` | `number` | 2 GiB | TypedArray 分配前的解码缓冲区上限。 |
| `maxFeatures` | `number` | 10,000,000 | 选中表累计记录数上限。 |
| `maxLayers` | `number` | 4,096 | 可发现要素表数上限。 |
| `maxGeometryDepth` | `number` | 32 | WKB 几何嵌套深度上限。 |

SQLite WASM、属性、拓扑和 Worker 输入副本均占用内存；公开上传应收紧 `limits`。

## 可运行示例

- [GeoPackage 多图层示例](/mapseekai/emap/examples/geopackage-viewer/)

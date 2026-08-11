---
id: duckdb
slug: /data/duckdb
title: DuckDB
api: ["areaDatasetWithDuckDb","boundaryDatasetWithDuckDb","bufferDatasetWithDuckDb","centroidDatasetWithDuckDb","centroidXDatasetWithDuckDb","centroidYDatasetWithDuckDb","closeDuckDbRuntime","containsAttributeDatasetWithDuckDb","containsDatasetWithDuckDb","overlapsDatasetWithDuckDb","overlapsAttributeDatasetWithDuckDb","equalsDatasetWithDuckDb","equalsAttributeDatasetWithDuckDb","crossesDatasetWithDuckDb","crossesAttributeDatasetWithDuckDb","coversDatasetWithDuckDb","coversAttributeDatasetWithDuckDb","coveredByDatasetWithDuckDb","coveredByAttributeDatasetWithDuckDb","containsProperlyDatasetWithDuckDb","containsProperlyAttributeDatasetWithDuckDb","convexHullDatasetWithDuckDb","createDuckDbGeoParquetQuerySource","createDuckDbRuntimeFromJsDelivr","CreateDuckDbRuntimeOptions","differenceDatasetWithDuckDb","disjointAttributeDatasetWithDuckDb","disjointDatasetWithDuckDb","distanceDatasetWithDuckDb","distanceWithinAttributeDatasetWithDuckDb","distanceWithinDatasetWithDuckDb","DUCKDB_ATTRIBUTE_OPERATION_SPECS","DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS","duckDbAttributeLayer","DuckDbAttributeLayerOptions","DuckDbAttributeLayerResult","DuckDbAttributeOperationId","DuckDbAttributeOperationOptions","DuckDbAttributeOperationSpec","DuckDbAttributeOptions","duckDbBufferLayer","DuckDbBufferLayerOptions","DuckDbBufferLayerResult","DuckDbBufferOptions","DuckDbConnection","duckDbGeometryLayer","DuckDbGeometryLayerOptions","DuckDbGeometryLayerResult","DuckDbGeometryOperationSpec","duckDbGeoParquetQueryLayer","DuckDbGeoParquetQueryLayerOptions","DuckDbGeoParquetQueryLayerResult","DuckDbGeoParquetQueryOptions","DuckDbGeoParquetQuerySource","DuckDbMapOpContext","DuckDbMapOpSource","DuckDbNamedRelationOperationSpec","DuckDbOperationError","DuckDbOperationErrorKind","DuckDbOverlayHelperOptions","duckDbOverlayLayer","DuckDbOverlayLayerOptions","DuckDbOverlayLayerResult","DuckDbOverlayOperationId","DuckDbOverlayOperationSpec","DuckDbOverlayOptions","duckDbQueryLayer","DuckDbQueryLayerOptions","DuckDbQueryLayerResult","DuckDbQueryOptions","DuckDbRelationAttributeDistanceOperationSpec","DuckDbRelationAttributeDistanceWithinOperationSpec","DuckDbRelationAttributePredicateOperationSpec","DuckDbRelationFilterDistanceWithinOperationSpec","DuckDbRelationFilterPredicateOperationSpec","DuckDbRelationHelperOptions","duckDbRelationLayer","DuckDbRelationLayerOptions","DuckDbRelationLayerResult","DuckDbRelationMode","DuckDbRelationOperationId","DuckDbRelationOperationSpec","DuckDbRelationOptions","DuckDbRelationOutputKind","DuckDbRuntime","DuckDbSimplifyOptions","DuckDbSpatialAggregateJoinPredicate","DuckDbSpatialAggregateJoinType","DuckDbSpatialAggregateOperation","DuckDbSpatialAggregation","DuckDbSpatialAggregateJoinOptions","spatialAggregateJoinDatasetWithDuckDb","DuckDbSpatialAggregateJoinLayerOptions","DuckDbSpatialAggregateJoinLayerResult","duckDbSpatialAggregateJoinLayer","DuckDbUnaryGeometryOperationId","DuckDbUnaryGeometryOptions","DuckDbWasmModule","Emap","envelopeDatasetWithDuckDb","geometryTypeDatasetWithDuckDb","getDuckDbAttributeOperationSpec","getDuckDbOverlayOperationSpec","getDuckDbRelationOperationSpec","getDuckDbRuntime","getDuckDbUnaryGeometryOperationSpec","intersectionDatasetWithDuckDb","intersectsAttributeDatasetWithDuckDb","intersectsDatasetWithDuckDb","isEmptyDatasetWithDuckDb","isSimpleDatasetWithDuckDb","isValidDatasetWithDuckDb","lengthDatasetWithDuckDb","makeValidDatasetWithDuckDb","normalizeDuckDbBufferOptions","perimeterDatasetWithDuckDb","processAttributeWithDuckDb","processGeometryWithDuckDb","processOverlayWithDuckDb","processRelationWithDuckDb","queryDatasetWithDuckDb","queryGeoParquetWithDuckDb","resolveAttributeOutputColumn","resolveRelationOutputColumn","runRelationOperation","setDuckDbRuntime","simplifyDatasetWithDuckDb","simplifyPreserveTopologyDatasetWithDuckDb","touchesAttributeDatasetWithDuckDb","touchesDatasetWithDuckDb","ValidatedDuckDbSelectSql","ValidatedDuckDbSelectSqlWithoutRowId","ValidatedDuckDbSelectSqlWithRowId","validateDuckDbSelectSql","ValidateDuckDbSelectSqlOptions","withinAttributeDatasetWithDuckDb","withinDatasetWithDuckDb","xDatasetWithDuckDb","yDatasetWithDuckDb"]
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-spatial-aggregate-join","duckdb-query","duckdb-spatial-ops"]
stability: stable
verifiedVersion: 0.5.0
---

# DuckDB

`@mapseekai/emap/duckdb` 是可选入口，在浏览器 DuckDB-Wasm 中执行受限 SQL 和空间函数。
核心地图不会自动加载 DuckDB；只有导入该子路径的应用承担下载和初始化成本。

## 安装

```bash
pnpm add @duckdb/duckdb-wasm
```

该包是 Emap 的 optional dependency。包管理器跳过 optional dependency 时需要显式安装。

推荐懒加载：

```ts
const duckdb = await import('@mapseekai/emap/duckdb');
```

## 初始化运行时

使用 jsDelivr bundle：

```ts
const runtime = await duckdb.createDuckDbRuntimeFromJsDelivr();
duckdb.setDuckDbRuntime(runtime);
```

应用已经管理 DuckDB-Wasm 时，可以通过 `setDuckDbRuntime(...)` 注入适配器。
GeoParquet bytes 查询要求 runtime 实现 `registerFileBuffer`；`dropFile` 是可选清理方法。

页面销毁且不再复用 runtime 时：

```ts
await duckdb.closeDuckDbRuntime();
```

## Dataset helper

helper 的第一个参数是 `MapshaperDataset`，第二个参数是 operation options：

```ts
const dataset = source.getDataset();
if (!dataset) throw new Error('Source has no dataset');

const buffered = await duckdb.bufferDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  distance: 25,
  outputLayer: 'parcels_buffer',
});
```

旧形式 `queryDatasetWithDuckDb({ runtime, source, sql })` 不符合当前签名。runtime
通过 `setDuckDbRuntime` 配置，dataset 单独作为第一个参数。

## 几何 helper

```ts
const centroids = await duckdb.centroidDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  outputLayer: 'parcel_centroids',
});

const simplified =
  await duckdb.simplifyPreserveTopologyDatasetWithDuckDb(dataset, {
    layer: 'parcels',
    tolerance: 5,
    outputLayer: 'parcels_simplified',
  });
```

支持 centroid、envelope、convex hull、boundary、simplify、
simplify-preserve-topology 和 make-valid 等一元几何操作。

## 属性 helper

属性 helper 保留输入 geometry，并添加标量字段：

```ts
const withArea = await duckdb.areaDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  outputColumn: 'area_m2',
});

const withType = await duckdb.geometryTypeDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  outputColumn: 'geom_type',
});
```

area、length、perimeter 使用 dataset 坐标单位，默认拒绝 geographic CRS。

## Relation 与 overlay

```ts
const inside = await duckdb.intersectsDatasetWithDuckDb(
  parcelsDataset,
  floodplainDataset,
  {
    inputLayer: 'parcels',
    maskLayer: 'floodplain',
    outputLayer: 'parcels_in_floodplain',
  },
);

const clipped = await duckdb.intersectionDatasetWithDuckDb(
  parcelsDataset,
  floodplainDataset,
  {
    inputLayer: 'parcels',
    maskLayer: 'floodplain',
    outputLayer: 'parcels_clipped',
  },
);
```

overlay 会先 union mask geometry，只保留输入属性。输入和 mask 必须已经使用相同 CRS。

DuckDB 始终按 `ST_Function(inputGeometry, maskGeometry)` 计算关系。`covers` 表示输入
要素覆盖 mask 要素；`coveredBy` 表示输入要素被 mask 要素覆盖；`containsProperly` 表示
输入要素严格包含 mask 要素。以下六个谓词均是拓扑关系，均允许使用 geographic CRS。

| 操作 id | DuckDB 函数 | 过滤 helper | 属性 helper | 默认输出列 |
| --- | --- | --- | --- | --- |
| `overlaps` | `ST_Overlaps` | `overlapsDatasetWithDuckDb` | `overlapsAttributeDatasetWithDuckDb` | `duckdb_overlaps` |
| `equals` | `ST_Equals` | `equalsDatasetWithDuckDb` | `equalsAttributeDatasetWithDuckDb` | `duckdb_equals` |
| `crosses` | `ST_Crosses` | `crossesDatasetWithDuckDb` | `crossesAttributeDatasetWithDuckDb` | `duckdb_crosses` |
| `covers` | `ST_Covers` | `coversDatasetWithDuckDb` | `coversAttributeDatasetWithDuckDb` | `duckdb_covers` |
| `coveredBy` | `ST_CoveredBy` | `coveredByDatasetWithDuckDb` | `coveredByAttributeDatasetWithDuckDb` | `duckdb_covered_by` |
| `containsProperly` | `ST_ContainsProperly` | `containsProperlyDatasetWithDuckDb` | `containsProperlyAttributeDatasetWithDuckDb` | `duckdb_contains_properly` |

## 空间聚合连接

`spatialAggregateJoinDatasetWithDuckDb(targetDataset, joinDataset, options)` 用于在不改变
目标要素的前提下，按空间匹配把多个 join 要素的统计值追加到目标 layer。它适合为行政区
统计 POI 数量、销售额或评分，而不是复制 join 的原始字段或创建新 geometry。

```ts
const result = await spatialAggregateJoinDatasetWithDuckDb(zones, points, {
  predicate: 'contains',
  joinType: 'left',
  aggregations: [
    { operation: 'count', outputColumn: 'poi_count' },
    { operation: 'sum', field: 'sales', outputColumn: 'sales_total' },
    { operation: 'avg', field: 'score', outputColumn: 'score_avg' },
  ],
  outputLayer: 'zone_statistics',
});
```

`targetLayer` 和 `joinLayer` 可分别选择两个 dataset 的 layer；省略时各自使用第一个
layer。结果只包含所选 target layer，按原 target 顺序保留 geometry、shape、共享 arc、
topology、属性、CRS 和 info，输入 dataset 不会被修改。

`predicate` 支持 `intersects`、`contains`、`within`、`touches`、`overlaps`、`equals`、
`crosses`、`covers`、`coveredBy` 和 `containsProperly`。参数方向始终是 target 在前、
join 在后：`contains` 表示 target 包含 join，`within` 表示 target 位于 join 内；
`covers` 表示 target 覆盖 join，`coveredBy` 表示 target 被 join 覆盖。

`joinType` 默认为 `left`，为每个 target 要素产生一行；`inner` 只保留至少匹配一个
join 要素的 target。两种模式都保持相对于 target 的原始顺序。null target geometry
视为未匹配，故只在 `left` 保留；null join geometry 会被忽略。

每个 `aggregations` 项可使用 `count`、`sum`、`avg`、`min` 或 `max`。`count` 不接受
`field`；其他操作要求存在且非空的 join 字段。`sum` 和 `avg` 只接受数值字段，`min` 和
`max` 只接受 DuckDB 可排序的标量字段。非 count 聚合忽略 null 字段值；某个匹配组的值
全部为 null 时结果为 null。`left` 中未匹配 target 的 count 为 `0`，其他聚合为 `null`。

`outputColumn` 会先 trim，之后必须非空、请求内唯一，并且不能与 target 属性或 geometry
列同名；冲突会报错，绝不会自动加后缀或覆盖已有属性。

地图 operation 使用 `duckDbSpatialAggregateJoinLayer(ctx, options)`，从 `src` 读取 target
source、从 `join` 读取统计 source，并将结果写入 `output.sourceId`。`output` 的类型虽可选，
但运行时必须提供非空 `output.sourceId`：

```ts
await duckDbSpatialAggregateJoinLayer(ctx, {
  src: 'zones',
  join: 'points',
  predicate: 'contains',
  aggregations: [{ operation: 'count', outputColumn: 'poi_count' }],
  output: { sourceId: 'zone_statistics' },
});
```

该 helper 不支持 `disjoint`、距离或 nearest 查询、任意 SQL、直接 GeoParquet 输入、复制
原始 join 字段，或构造输出 geometry。查看可运行的
[空间聚合连接示例](/mapseekai/emap/examples/duckdb-spatial-aggregate-join/)。

## 受限 SELECT

```ts
const filtered = await duckdb.queryDatasetWithDuckDb(dataset, {
  sql: `
    SELECT name, population
    FROM input
    WHERE population > 100000
    ORDER BY population DESC
    LIMIT 50
  `,
  outputLayer: 'large_places',
});
```

dataset layer 注册为逻辑表 `input`。当前 validator 支持标量 projection、简单
`WHERE`、`ORDER BY` 和整数 `LIMIT`。以下内容会在执行前拒绝：

- 多条 statement
- mutation
- join
- 直接访问其他表
- 计算输出 geometry

应用可以先调用 `validateDuckDbSelectSql` 使用同一校验规则。

## 查询 GeoParquet bytes

```ts
const result = await duckdb.queryGeoParquetWithDuckDb(bytes, {
  layerName: 'active_points',
  sql: 'SELECT geometry, name FROM input WHERE active = true',
});
```

SELECT 必须包含可识别 geometry column。不要让 SQL 直接调用 `read_parquet(...)`；
helper 负责注册 bytes 和逻辑输入表。

## 把结果加入地图

DuckDB helper 返回 dataset，不会隐式替换现有 source：

```ts
const output = new TopologySource('buffered');
output.setDataset(buffered);

await map.addSource('buffered', output);
map.setExtent(output.getExtent());
```

应用可以选择新建 source 或显式替换已有 source。不要在 helper 之外假设历史自动更新；
需要地图操作历史时使用 Emap adapter/operation 入口。

## CRS 与单位

- area、length、perimeter、distance 和 buffer 使用 dataset 单位。
- distance 类 helper 默认拒绝 geographic CRS。
- `failOnGeographicCrs: false` 只适合明确需要角度计算的场景。
- relation predicate 可以在 geographic CRS 上运行。

## 错误处理

DuckDB helper 可能抛出 `DuckDbOperationError`：

```ts
try {
  await duckdb.queryDatasetWithDuckDb(dataset, options);
} catch (error) {
  if (error instanceof duckdb.DuckDbOperationError) {
    console.error(error.kind, error.message);
  }
}
```

可区分 runtime 初始化、SQL 校验、空间扩展和执行失败。

## API

- [queryDatasetWithDuckDb](/mapseekai/emap/api/functions/duckdb.queryDatasetWithDuckDb.html)
- [bufferDatasetWithDuckDb](/mapseekai/emap/api/functions/duckdb.bufferDatasetWithDuckDb.html)
- [createDuckDbRuntimeFromJsDelivr](/mapseekai/emap/api/functions/duckdb.createDuckDbRuntimeFromJsDelivr.html)
- [DuckDbOperationError](/mapseekai/emap/api/classes/duckdb.DuckDbOperationError.html)

## 可运行示例

- [DuckDB 查询](/mapseekai/emap/examples/duckdb-query/)
- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)
- [空间操作](/mapseekai/emap/examples/duckdb-spatial-ops/)
- [Overlay](/mapseekai/emap/examples/duckdb-overlay/)
- [GeoParquet 查询](/mapseekai/emap/examples/duckdb-geoparquet-query/)

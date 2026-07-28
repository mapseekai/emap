---
id: duckdb
slug: /data/duckdb
title: DuckDB
api: ["areaDatasetWithDuckDb","boundaryDatasetWithDuckDb","bufferDatasetWithDuckDb","centroidDatasetWithDuckDb","centroidXDatasetWithDuckDb","centroidYDatasetWithDuckDb","closeDuckDbRuntime","containsAttributeDatasetWithDuckDb","containsDatasetWithDuckDb","convexHullDatasetWithDuckDb","createDuckDbGeoParquetQuerySource","createDuckDbRuntimeFromJsDelivr","CreateDuckDbRuntimeOptions","differenceDatasetWithDuckDb","disjointAttributeDatasetWithDuckDb","disjointDatasetWithDuckDb","distanceDatasetWithDuckDb","distanceWithinAttributeDatasetWithDuckDb","distanceWithinDatasetWithDuckDb","DUCKDB_ATTRIBUTE_OPERATION_SPECS","DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS","duckDbAttributeLayer","DuckDbAttributeLayerOptions","DuckDbAttributeLayerResult","DuckDbAttributeOperationId","DuckDbAttributeOperationOptions","DuckDbAttributeOperationSpec","DuckDbAttributeOptions","duckDbBufferLayer","DuckDbBufferLayerOptions","DuckDbBufferLayerResult","DuckDbBufferOptions","DuckDbConnection","duckDbGeometryLayer","DuckDbGeometryLayerOptions","DuckDbGeometryLayerResult","DuckDbGeometryOperationSpec","duckDbGeoParquetQueryLayer","DuckDbGeoParquetQueryLayerOptions","DuckDbGeoParquetQueryLayerResult","DuckDbGeoParquetQueryOptions","DuckDbGeoParquetQuerySource","DuckDbMapOpContext","DuckDbMapOpSource","DuckDbNamedRelationOperationSpec","DuckDbOperationError","DuckDbOperationErrorKind","DuckDbOverlayHelperOptions","duckDbOverlayLayer","DuckDbOverlayLayerOptions","DuckDbOverlayLayerResult","DuckDbOverlayOperationId","DuckDbOverlayOperationSpec","DuckDbOverlayOptions","duckDbQueryLayer","DuckDbQueryLayerOptions","DuckDbQueryLayerResult","DuckDbQueryOptions","DuckDbRelationAttributeDistanceOperationSpec","DuckDbRelationAttributeDistanceWithinOperationSpec","DuckDbRelationAttributePredicateOperationSpec","DuckDbRelationFilterDistanceWithinOperationSpec","DuckDbRelationFilterPredicateOperationSpec","DuckDbRelationHelperOptions","duckDbRelationLayer","DuckDbRelationLayerOptions","DuckDbRelationLayerResult","DuckDbRelationMode","DuckDbRelationOperationId","DuckDbRelationOperationSpec","DuckDbRelationOptions","DuckDbRelationOutputKind","DuckDbRuntime","DuckDbSimplifyOptions","DuckDbUnaryGeometryOperationId","DuckDbUnaryGeometryOptions","DuckDbWasmModule","Emap","envelopeDatasetWithDuckDb","geometryTypeDatasetWithDuckDb","getDuckDbAttributeOperationSpec","getDuckDbOverlayOperationSpec","getDuckDbRelationOperationSpec","getDuckDbRuntime","getDuckDbUnaryGeometryOperationSpec","intersectionDatasetWithDuckDb","intersectsAttributeDatasetWithDuckDb","intersectsDatasetWithDuckDb","isEmptyDatasetWithDuckDb","isSimpleDatasetWithDuckDb","isValidDatasetWithDuckDb","lengthDatasetWithDuckDb","makeValidDatasetWithDuckDb","normalizeDuckDbBufferOptions","perimeterDatasetWithDuckDb","processAttributeWithDuckDb","processGeometryWithDuckDb","processOverlayWithDuckDb","processRelationWithDuckDb","queryDatasetWithDuckDb","queryGeoParquetWithDuckDb","resolveAttributeOutputColumn","resolveRelationOutputColumn","runRelationOperation","setDuckDbRuntime","simplifyDatasetWithDuckDb","simplifyPreserveTopologyDatasetWithDuckDb","touchesAttributeDatasetWithDuckDb","touchesDatasetWithDuckDb","ValidatedDuckDbSelectSql","ValidatedDuckDbSelectSqlWithoutRowId","ValidatedDuckDbSelectSqlWithRowId","validateDuckDbSelectSql","ValidateDuckDbSelectSqlOptions","withinAttributeDatasetWithDuckDb","withinDatasetWithDuckDb","xDatasetWithDuckDb","yDatasetWithDuckDb"]
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-query","duckdb-spatial-ops"]
stability: stable
verifiedVersion: 0.5.0
---

# DuckDB

`@zwishing/emap/duckdb` 是可选入口，在浏览器 DuckDB-Wasm 中执行受限 SQL 和空间函数。
核心地图不会自动加载 DuckDB；只有导入该子路径的应用承担下载和初始化成本。

## 安装

```bash
pnpm add @duckdb/duckdb-wasm
```

该包是 emap 的 optional dependency。包管理器跳过 optional dependency 时需要显式安装。

推荐懒加载：

```ts
const duckdb = await import('@zwishing/emap/duckdb');
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

map.addSource('buffered', output);
map.setExtent(output.getExtent());
```

应用可以选择新建 source 或显式替换已有 source。不要在 helper 之外假设历史自动更新；
需要地图操作历史时使用 emap adapter/operation 入口。

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

- [queryDatasetWithDuckDb](/emap/api/functions/duckdb.queryDatasetWithDuckDb.html)
- [bufferDatasetWithDuckDb](/emap/api/functions/duckdb.bufferDatasetWithDuckDb.html)
- [createDuckDbRuntimeFromJsDelivr](/emap/api/functions/duckdb.createDuckDbRuntimeFromJsDelivr.html)
- [DuckDbOperationError](/emap/api/classes/duckdb.DuckDbOperationError.html)

## 可运行示例

- [DuckDB 查询](/emap/examples/duckdb-query/)
- [DuckDB buffer](/emap/examples/duckdb-buffer/)
- [空间操作](/emap/examples/duckdb-spatial-ops/)
- [Overlay](/emap/examples/duckdb-overlay/)
- [GeoParquet 查询](/emap/examples/duckdb-geoparquet-query/)

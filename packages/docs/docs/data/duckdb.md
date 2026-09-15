---
id: duckdb
slug: /data/duckdb
title: DuckDB Processing Toolbox
api: ["AggregateOptions", "append", "area", "attributeFilter", "AttributeFilterOptions", "attributeJoin", "AttributeJoinOptions", "AttributeOptions", "boundary", "buffer", "BufferOptions", "centroid", "centroidX", "centroidY", "clip", "ClipOptions", "closeDuckDbRuntime", "collect", "convexHull", "createDuckDbGeoParquetQuerySource", "createDuckDbRuntimeFromJsDelivr", "CreateDuckDbRuntimeOptions", "densify", "DensifyOptions", "difference", "DifferenceOptions", "dissolve", "DuckDbAgentMetadata", "duckDbAttributeFilterLayer", "DuckDbAttributeFilterLayerOptions", "DuckDbAttributeFilterLayerResult", "DuckDbConnection", "duckDbGeoParquetQueryLayer", "DuckDbGeoParquetQueryLayerOptions", "DuckDbGeoParquetQueryLayerResult", "DuckDbGeoParquetQueryOptions", "DuckDbGeoParquetQuerySource", "DuckDbMapOpContext", "DuckDbMapOpSource", "DuckDbOperationError", "DuckDbOperationErrorKind", "duckDbOverlayLayer", "DuckDbOverlayLayerOptions", "DuckDbOverlayLayerResult", "DuckDbRuntime", "DuckDbSpatialExtensionUrls", "duckDbSpatialSummaryJoinLayer", "DuckDbSpatialSummaryJoinLayerOptions", "DuckDbSpatialSummaryJoinLayerResult", "duckDbToolbox", "DuckDbToolCategory", "DuckDbToolDefinition", "DuckDbToolExecutionContext", "DuckDbToolId", "DuckDbToolInput", "DuckDbToolObjectProperty", "DuckDbToolOutput", "DuckDbToolParameter", "DuckDbWasmModule", "envelope", "extractVertices", "GeometryOptions", "geometryType", "intersect", "IntersectOptions", "isEmpty", "isSimple", "isValid", "length", "lineToPolygon", "merge", "MergeOptions", "multipartToSinglepart", "near", "nearest", "NearestOptions", "NearOptions", "perimeter", "pointToLine", "PointToLineOptions", "polygonToLine", "queryGeoParquetWithDuckDb", "quoteSqlString", "repairGeometry", "RepairGeometryOptions", "reproject", "ReprojectOptions", "simplify", "SimplifyOptions", "simplifyPreserveTopology", "SpatialAggregation", "spatialFilter", "SpatialFilterOptions", "SpatialFilterPredicate", "spatialJoin", "SpatialJoinOptions", "SpatialJoinPredicate", "spatialRelation", "SpatialRelationOptions", "spatialSummaryJoin", "SpatialSummaryJoinOptions", "SpatialSummaryJoinPredicate", "SpatialSummaryJoinType", "SpatialSummaryOperation", "symmetricDifference", "SymmetricDifferenceOptions", "union", "UnionOptions", "ValidatedDuckDbSelectSql", "ValidatedDuckDbSelectSqlWithoutRowId", "ValidatedDuckDbSelectSqlWithRowId", "validateDuckDbSelectSql", "ValidateDuckDbSelectSqlOptions", "x", "y"]
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-query","duckdb-spatial-aggregate-join"]
stability: stable
verifiedVersion: 0.12.0
---

# DuckDB Processing Toolbox

`@mapseekai/emap/duckdb` 是可选的浏览器端 DuckDB-Wasm GIS 子入口。它提供 GeoParquet 查询、独立 Dataset 处理函数和用于 UI、workflow 或 agent 的 `duckDbToolbox`。处理函数返回新 Dataset，不修改传入的 Dataset。

## 安装和运行时

安装包含 DuckDB-Wasm 的可选依赖，并从子入口导入。创建运行时后将它作为处理函数的 runtime 参数显式传入；每个工作区持有独立运行时。

```ts
import {
  createDuckDbRuntimeFromJsDelivr,
  closeDuckDbRuntime,
} from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr();

// 应用关闭 DuckDB 时：
await closeDuckDbRuntime(runtime);
```

## GIS 处理

处理函数采用短 GIS 名称，并可直接组合：

```ts
import { buffer, clip, dissolve, spatialJoin } from '@mapseekai/emap/duckdb';

const buffered = await buffer(roads, { distance: 20 }, runtime);
const clipped = await clip(buffered, boundary, {}, runtime);
const districts = await dissolve(clipped, { groupBy: ['district'] }, runtime);
const joined = await spatialJoin(districts, points, {
  predicate: 'contains',
}, runtime);
```

| 类别 | 工具 |
| --- | --- |
| Overlay | `clip`、`intersect`、`union`、`difference`、`symmetricDifference` |
| Proximity | `buffer`、`near`、`nearest` |
| Aggregate | `dissolve`、`collect` |
| Join | `attributeJoin`、`spatialJoin`、`spatialSummaryJoin` |
| Geometry | `centroid`、`envelope`、`convexHull`、`boundary`、`simplify`、`simplifyPreserveTopology`、`densify`、`multipartToSinglepart`、`extractVertices` |
| Transform | `pointToLine`、`lineToPolygon`、`polygonToLine` |
| Selection | `attributeFilter`、`spatialFilter`、`spatialRelation` |
| Data management | `merge`、`append`、`reproject`、`repairGeometry` |
| Attributes | `area`、`length`、`perimeter`、`geometryType`、`isValid`、`isEmpty`、`isSimple`、`x`、`y`、`centroidX`、`centroidY` |

距离工具使用 Dataset 的坐标单位。`near` 和 `nearest` 默认要求已知的投影坐标系。`spatialJoin` 产生一对多空间连接；`spatialSummaryJoin` 提供 count、sum、avg、min 和 max 汇总。

## Toolbox

`duckDbToolbox` 提供 `tools`、`list()`、`get()`、`require()`、`search()` 和 `execute()`。它适合按工具 ID 或搜索词构建 UI、workflow 和 agent：

```ts
import { duckDbToolbox } from '@mapseekai/emap/duckdb';

const candidates = duckDbToolbox.search('count points in polygon');
const result = await duckDbToolbox.execute('buffer', {
  inputs: { input: roads },
  params: { distance: 50 },
  runtime,
});
```

每个工具定义描述输入 geometry、参数、CRS/单位要求、输出语义、cost 和 agent 元数据。

## GeoParquet 查询

`queryGeoParquetWithDuckDb()` 查询 GeoParquet bytes。SQL 是面向 `input` 表的受限单条 `SELECT`：选择已提供的列，并使用支持的筛选、排序和限制语句。`validateDuckDbSelectSql()` 可在执行前验证同一查询契约。

```ts
import { queryGeoParquetWithDuckDb } from '@mapseekai/emap/duckdb';

const result = await queryGeoParquetWithDuckDb(bytes, {
  sql: 'SELECT geometry, name FROM input WHERE active = true',
}, runtime);
```

查询访问属于 GeoParquet 数据访问能力，不属于 Processing Toolbox。

## API

- [createDuckDbRuntimeFromJsDelivr](/mapseekai/emap/api/functions/duckdb.createDuckDbRuntimeFromJsDelivr.html)
- [closeDuckDbRuntime](/mapseekai/emap/api/functions/duckdb.closeDuckDbRuntime.html)
- [validateDuckDbSelectSql](/mapseekai/emap/api/functions/duckdb.validateDuckDbSelectSql.html)
- [queryGeoParquetWithDuckDb](/mapseekai/emap/api/functions/duckdb.queryGeoParquetWithDuckDb.html)
- [duckDbToolbox](/mapseekai/emap/api/variables/duckdb.duckDbToolbox.html)

## 可运行示例

- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)
- [DuckDB GeoParquet 查询](/mapseekai/emap/examples/duckdb-geoparquet-query/)
- [DuckDB overlay](/mapseekai/emap/examples/duckdb-overlay/)
- [DuckDB 查询](/mapseekai/emap/examples/duckdb-query/)
- [DuckDB 空间聚合连接](/mapseekai/emap/examples/duckdb-spatial-aggregate-join/)

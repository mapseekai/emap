---
id: duckdb
slug: /data/duckdb
title: DuckDB Processing Toolbox
api: ["AggregateOptions", "append", "area", "attributeFilter", "AttributeFilterOptions", "attributeJoin", "AttributeJoinOptions", "AttributeOptions", "boundary", "buffer", "BufferOptions", "centroid", "centroidX", "centroidY", "clip", "ClipOptions", "closeDuckDbRuntime", "collect", "convexHull", "createDuckDbGeoParquetQuerySource", "createDuckDbRuntimeFromJsDelivr", "CreateDuckDbRuntimeOptions", "densify", "DensifyOptions", "difference", "DifferenceOptions", "dissolve", "DuckDbAgentMetadata", "duckDbAttributeFilterLayer", "DuckDbAttributeFilterLayerOptions", "DuckDbAttributeFilterLayerResult", "DuckDbConnection", "duckDbGeoParquetQueryLayer", "DuckDbGeoParquetQueryLayerOptions", "DuckDbGeoParquetQueryLayerResult", "DuckDbGeoParquetQueryOptions", "DuckDbGeoParquetQuerySource", "DuckDbMapOpContext", "DuckDbMapOpSource", "DuckDbOperationError", "DuckDbOperationErrorKind", "duckDbOverlayLayer", "DuckDbOverlayLayerOptions", "DuckDbOverlayLayerResult", "DuckDbRuntime", "DuckDbSpatialExtensionUrls", "duckDbSpatialSummaryJoinLayer", "DuckDbSpatialSummaryJoinLayerOptions", "DuckDbSpatialSummaryJoinLayerResult", "duckDbToolbox", "DuckDbToolCategory", "DuckDbToolDefinition", "DuckDbToolExecutionContext", "DuckDbToolId", "DuckDbToolInput", "DuckDbToolObjectProperty", "DuckDbToolOutput", "DuckDbToolParameter", "DuckDbWasmModule", "envelope", "extractVertices", "GeometryOptions", "geometryType", "intersect", "IntersectOptions", "isEmpty", "isSimple", "isValid", "length", "lineToPolygon", "merge", "MergeOptions", "multipartToSinglepart", "near", "nearest", "NearestOptions", "NearOptions", "perimeter", "pointToLine", "PointToLineOptions", "polygonToLine", "queryGeoParquetWithDuckDb", "quoteSqlString", "repairGeometry", "RepairGeometryOptions", "reproject", "ReprojectOptions", "simplify", "SimplifyOptions", "simplifyPreserveTopology", "SpatialAggregation", "spatialFilter", "SpatialFilterOptions", "SpatialFilterPredicate", "spatialJoin", "SpatialJoinOptions", "SpatialJoinPredicate", "spatialRelation", "SpatialRelationOptions", "spatialSummaryJoin", "SpatialSummaryJoinOptions", "SpatialSummaryJoinPredicate", "SpatialSummaryJoinType", "SpatialSummaryOperation", "symmetricDifference", "SymmetricDifferenceOptions", "union", "UnionOptions", "ValidatedDuckDbSelectSql", "ValidatedDuckDbSelectSqlWithoutRowId", "ValidatedDuckDbSelectSqlWithRowId", "validateDuckDbSelectSql", "ValidateDuckDbSelectSqlOptions", "x", "y"]
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-query","duckdb-spatial-aggregate-join"]
stability: stable
verifiedVersion: 0.14.0
---

# DuckDB Processing Toolbox

`@mapseekai/emap/duckdb` 提供浏览器端 DuckDB-Wasm GIS 处理：GeoParquet 查询、缓冲区、叠加分析、空间连接、聚合及属性计算。这个可选子入口提供可组合的 Dataset 处理函数和可发现工具的 `duckDbToolbox`；处理函数返回新 Dataset。

```ts
import { createDuckDbRuntimeFromJsDelivr, closeDuckDbRuntime } from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr(); // 创建独立 DuckDB-Wasm 运行时
await closeDuckDbRuntime(runtime); // 应用关闭时释放运行时
```

## 核心方法

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `createDuckDbRuntimeFromJsDelivr()` | `CreateDuckDbRuntimeOptions` | 创建浏览器 DuckDB-Wasm 运行时。 |
| `buffer(input, options, runtime)` | `Dataset`, `BufferOptions`, `DuckDbRuntime` | 生成缓冲区 Dataset。 |
| `clip(input, reference, options, runtime)` / `dissolve(input, options, runtime)` | `Dataset`, `Dataset`, options, runtime | 裁剪数据或按字段合并几何。 |
| `closeDuckDbRuntime(runtime)` | `DuckDbRuntime \| null` | 关闭运行时。 |

## 更多运行时配置

安装可选依赖，从子入口导入；将独立运行时显式传入处理函数。

### `createDuckDbRuntimeFromJsDelivr`

构造器创建 jsDelivr DuckDB-Wasm 运行时；首次 GIS 操作由 `ensureSpatial()` 准备 spatial 扩展。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `duckdb` | `DuckDbWasmModule` | 动态导入 `@duckdb/duckdb-wasm` | 已加载的 DuckDB-Wasm 模块。 |
| `customExtensionRepository` | `string` | 未设置 | spatial 扩展仓库 URL。 |
| `spatialExtensionUrls` | `DuckDbSpatialExtensionUrls` | 未设置 | 自托管 spatial `.wasm` URL；与 `customExtensionRepository` 二选一。 |
| `workerFactory` | `(url: string) => Worker \| Promise<Worker>` | 浏览器 `Worker` | DuckDB Worker 构造器。 |
| `createObjectURL` | `(blob: Blob) => string` | `URL.createObjectURL` | Worker 包装脚本 URL 构造器。 |
| `revokeObjectURL` | `(url: string) => void` | `URL.revokeObjectURL` | 释放 Worker 包装脚本 URL。 |

`closeDuckDbRuntime(runtime)` 接受 `DuckDbRuntime | null`（默认 `null`）并调用 `close()`。

### `DuckDbRuntimeScope` 与 `duckDbPlugin`

`DuckDbRuntimeScope` 按需创建运行时；`duckDbPlugin(options)` 在 Cordis provider 生命周期中管理它。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `runtime` | `DuckDbRuntime` | 未设置 | 调用方提供的运行时。 |
| `create` | `() => Promise<DuckDbRuntime>` | `createDuckDbRuntimeFromJsDelivr` | 延迟运行时构造器。 |
| `owned` | `boolean` | 未提供 `runtime` 时为 `true` | 是否在 `dispose()` 时关闭；`runtime` 与 `create` 二选一。 |

## 更多 GIS 处理

处理函数可直接组合：

```ts
import { buffer, clip, dissolve, spatialJoin } from '@mapseekai/emap/duckdb';

const buffered = await buffer(roads, { distance: 20 }, runtime);
const clipped = await clip(buffered, boundary, {}, runtime);
const districts = await dissolve(clipped, { groupBy: ['district'] }, runtime);
const joined = await spatialJoin(
  districts,
  points,
  {
    predicate: 'contains',
  },
  runtime,
);
```

调用形式为 `(input, options, runtime)` 或 `(input, reference, options, runtime)`；`runtime` 为 `DuckDbRuntime | null`，默认 `null`。单输入工具共享：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `layer` | `string \| number` | `0` | 输入图层名或索引。 |
| `outputLayer` | `string` | `'layer'` | 结果图层名。 |
| `geometryColumn` | `string` | `'geometry'` | Arrow/WKB 几何列名。 |

### 工具族与关键参数

| 类别 | 工具 | 关键参数与使用场景 |
| --- | --- | --- |
| Overlay | `clip`、`intersect`、`difference` | `inputLayer`、`maskLayer`：`string \| number`，默认各为 `0`；`outputLayer`；`inputGeometryColumn`、`maskGeometryColumn`：`string`，默认各为 `'geometry'`。裁剪、相交或扣除；mask CRS 自动对齐。 |
| Overlay | `union`、`symmetricDifference` | 继承单输入参数；`union` 合并覆盖面，`symmetricDifference` 保留单方区域。 |
| Proximity | `buffer` | `distance: number` 必填且大于 `0`；`failOnGeographicCrs: boolean` 默认 `true`。继承单输入参数。 |
| Proximity | `near` | `inputLayer`、`referenceLayer`: `string \| number`，默认 `0`；`inputGeometryColumn`、`referenceGeometryColumn`: `string`，默认 `'geometry'`；`outputDistanceColumn: string` 默认 `'near_distance'`；`outputLayer`；`failOnGeographicCrs: boolean` 默认 `true`。 |
| Proximity | `nearest` | `nearestIdField?: string`；`outputNearestIdColumn: string` 默认 `'nearest_id'`；`outputDistanceColumn: string` 默认 `'nearest_distance'`；继承单输入参数。投影 CRS。 |
| Aggregate | `dissolve`、`collect` | `groupBy: readonly string[]` 默认 `[]`；全局聚合。`dissolve` 联合几何，`collect` 保留部件；继承单输入参数。 |
| Join | `attributeJoin` | `leftKey: string`、`rightKey: string` 必填；`joinType: 'left' \| 'inner'` 默认 `'left'`；继承单输入参数。 |
| Join | `spatialJoin` | `predicate` 默认 `'intersects'`，支持 `intersects`、`contains`、`within`、`touches`、`disjoint`、`overlaps`、`equals`、`crosses`、`covers`、`coveredBy`、`containsProperly`；`joinType: 'left' \| 'inner'` 默认 `'left'`。 |
| Join | `spatialSummaryJoin` | `predicate`、非空 `aggregations: readonly SpatialAggregation[]` 必填；`joinType` 默认 `'left'`；`targetLayer`、`joinLayer` 默认 `0`；`targetGeometryColumn`、`joinGeometryColumn` 默认 `'geometry'`；`outputLayer`。 |
| Geometry | `centroid`、`envelope`、`convexHull`、`boundary`、`multipartToSinglepart`、`extractVertices` | 继承 `layer`、`outputLayer`、`geometryColumn`；前四项保持要素数，后两项展开部件或顶点。 |
| Geometry | `simplify`、`simplifyPreserveTopology` | `tolerance: number` 必填且不小于 `0`；`failOnGeographicCrs: boolean` 默认 `true`；后者保拓扑。 |
| Geometry | `densify` | `maxSegmentLength: number` 必填且大于 `0`；继承单输入参数。 |
| Transform | `pointToLine` | `groupBy: readonly string[]` 默认 `[]`；`orderBy?: string` 控制点序；继承单输入参数。 |
| Transform | `lineToPolygon`、`polygonToLine` | `lineToPolygon.groupBy` 默认 `[]`；`polygonToLine` 继承单输入参数。 |
| Selection | `spatialFilter`、`spatialRelation` | `predicate` 支持拓扑关系和 `distanceWithin`；`spatialRelation` 还支持 `distance`、`mode: 'filter' \| 'attribute'`（默认 `'filter'`）；`distance: number` 在 `distanceWithin` 时必填且大于 `0`。均支持 `inputLayer`、`maskLayer`、`outputLayer`、`inputGeometryColumn`、`maskGeometryColumn`、`outputColumn`、`failOnGeographicCrs`。 |
| Data management | `merge`、`append`、`repairGeometry` | `merge`、`append` 按字段名合并；`repairGeometry` 用 `ST_MakeValid`；继承单输入参数。 |
| Data management | `reproject` | `targetCrs: string` 必填；`sourceCrs?: string` 默认读取 Dataset CRS；`alwaysXY: boolean` 默认 `true`。 |
| Attributes | `area`、`length`、`perimeter`、`geometryType`、`isValid`、`isEmpty`、`isSimple`、`x`、`y`、`centroidX`、`centroidY` | `outputColumn?: string` 默认依次为 `duckdb_area`、`duckdb_length`、`duckdb_perimeter`、`duckdb_geometry_type`、`duckdb_is_valid`、`duckdb_is_empty`、`duckdb_is_simple`、`duckdb_x`、`duckdb_y`、`duckdb_centroid_x`、`duckdb_centroid_y`；`failOnGeographicCrs: boolean` 默认 `true`。 |


### `attributeFilter` SQL 契约

`attributeFilter(dataset, options, runtime)` 保留几何，以 SQL 投影替换属性。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `sql` | `string` | 必填 | 对 `input` 的受限单条 `SELECT`；支持已有非几何列、`WHERE`、`ORDER BY`、`LIMIT`。 |
| `geometryColumn` | `string` | `'geometry'` | 输入几何列名。 |
| `inputLayer` | `string \| number` | `0` | 输入图层名或索引。 |
| `outputLayer` | `string` | 原输入图层名 | 结果图层名。 |
| `rowIdColumn` | `string` | `'__emap_rowid'` | 内部行标识列名；冲突时自动改名。 |

支持 `*` 或裸列/双引号列名；校验器要求一个 `SELECT` 和一个 `FROM input`。


## 更多工具箱

```ts
import { duckDbToolbox } from '@mapseekai/emap/duckdb';

const candidates = duckDbToolbox.search('count points in polygon');
const result = await duckDbToolbox.execute('buffer', {
  inputs: { input: roads },
  params: { distance: 50 },
  runtime,
});
```

| API / 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `list(category?)` | `DuckDbToolCategory` | 全部工具 | 按类别枚举工具。 |
| `get(idOrAlias)` / `require(idOrAlias)` | `string` | 必填 | 按 ID 或别名取得定义。 |
| `search(query, category?)` | `string`、`DuckDbToolCategory` | 查询必填 | 按元数据排序匹配工具。 |
| `execute(idOrAlias, context)` | `string`、`DuckDbToolExecutionContext` | 必填 | 输入、参数和运行时；执行前校验。 |

工具定义包含输入、参数、CRS/单位、输出、cost 和 agent 元数据。

### 取消一次工具运行

在 `DuckDbToolExecutionContext.signal` 传入调用方 signal；直接调用处理函数时传 `options.signal`：

```ts
const controller = new AbortController();
const work = duckDbToolbox.execute('buffer', {
  inputs: { input: roads }, params: { distance: 50 }, runtime,
  signal: controller.signal,
});
controller.abort();
try { await work; } catch (error) {
  if (error !== controller.signal.reason) throw error;
}
```

`signal.aborted` 表示逻辑取消；返回的 Promise 在 pending query 的取消确认、在途轮询/结果读取、临时表删除和连接关闭后结束，通常以 signal 的 reason 拒绝。应等待它结束再用新 controller 重试；清理失败会返回包含清理错误的异常，不能把该异常视为安全重试确认。

运行时连接的 `query(sql, signal?)` 在传 signal 时使用 DuckDB 的 pending query 接口。它在取消后停止后续轮询和消费，等待当前请求及取消确认并释放 Arrow reader。同一连接的查询/插入/关闭按调用顺序执行，旧 signal 不会取消下一条查询。普通取消只影响该次专用连接，其他连接和共享 runtime 继续可用。自定义 `DuckDbRuntime` 必须自行实现 `query` 的 signal 契约；忽略 signal 的实现只能由外层阻止结果返回。

共享 runtime 初始化和 spatial 扩展加载归 runtime 所有，单次取消会等待已开始的共享初始化，再跳过该次连接/查询；不会关闭整个数据库。Arrow 输入准备和结果转 Dataset 中的同步代码也不能由 signal 抢占。`runtime.close()` 用于运行时所有者释放数据库，不能用作普通查询取消。


## 更多 GeoParquet 查询

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `data` | `Uint8Array \| ArrayBuffer` | 必填 | GeoParquet 字节。 |
| `sql` | `string` | 必填 | 对 `input` 的受限单条 `SELECT`；投影几何列返回空间 Dataset。 |
| `geometryColumn` | `string` | 自动探测 | 覆盖几何列探测。 |
| `layerName` | `string` | `'layer'` | 结果图层名。 |
| `noTopology` | `boolean` | `false` | 是否构建共享弧拓扑。 |

```ts
import { queryGeoParquetWithDuckDb } from '@mapseekai/emap/duckdb';

const result = await queryGeoParquetWithDuckDb(
  bytes,
  {
    sql: 'SELECT geometry, name FROM input WHERE active = true',
  },
  runtime,
);
```

`validateDuckDbSelectSql(sql, options)` 使用同一校验器；`availableColumns`、`physicalTableName` 必填。GeoParquet 查询传入 `allowGeometryProjection: true`、`rowIdColumn: null`。

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

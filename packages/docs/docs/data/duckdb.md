---
id: duckdb
slug: /data/duckdb
title: DuckDB Processing Toolbox
api: ["AggregateOptions","append","area","attributeFilter","AttributeFilterOptions","attributeJoin","AttributeJoinOptions","AttributeOptions","boundary","buffer","BufferOptions","centroid","centroidX","centroidY","clip","ClipOptions","closeDuckDbRuntime","collect","convexHull","createDuckDbGeoParquetQuerySource","createDuckDbRuntimeFromJsDelivr","CreateDuckDbRuntimeOptions","densify","DensifyOptions","difference","DifferenceOptions","dissolve","DuckDbAgentMetadata","duckDbAttributeFilterLayer","DuckDbAttributeFilterLayerOptions","DuckDbAttributeFilterLayerResult","DuckDbConnection","duckDbGeoParquetQueryLayer","DuckDbGeoParquetQueryLayerOptions","DuckDbGeoParquetQueryLayerResult","DuckDbGeoParquetQueryOptions","DuckDbGeoParquetQuerySource","DuckDbMapOpContext","DuckDbMapOpSource","DuckDbOperationError","DuckDbOperationErrorKind","duckDbOverlayLayer","DuckDbOverlayLayerOptions","DuckDbOverlayLayerResult","DuckDbRuntime","DuckDbSpatialExtensionUrls","duckDbSpatialSummaryJoinLayer","DuckDbSpatialSummaryJoinLayerOptions","DuckDbSpatialSummaryJoinLayerResult","duckDbToolbox","DuckDbToolCategory","DuckDbToolDefinition","DuckDbToolExecutionContext","DuckDbToolId","DuckDbToolInput","DuckDbToolObjectProperty","DuckDbToolOutput","DuckDbToolParameter","DuckDbWasmModule","envelope","extractVertices","GeometryOptions","geometryType","getDuckDbRuntime","intersect","IntersectOptions","isEmpty","isSimple","isValid","length","lineToPolygon","merge","MergeOptions","multipartToSinglepart","near","nearest","NearestOptions","NearOptions","perimeter","pointToLine","PointToLineOptions","polygonToLine","queryGeoParquetWithDuckDb","quoteSqlString","repairGeometry","RepairGeometryOptions","reproject","ReprojectOptions","setDuckDbRuntime","simplify","SimplifyOptions","simplifyPreserveTopology","SpatialAggregation","spatialFilter","SpatialFilterOptions","SpatialFilterPredicate","spatialJoin","SpatialJoinOptions","SpatialJoinPredicate","spatialRelation","SpatialRelationOptions","spatialSummaryJoin","SpatialSummaryJoinOptions","SpatialSummaryJoinPredicate","SpatialSummaryJoinType","SpatialSummaryOperation","symmetricDifference","SymmetricDifferenceOptions","union","UnionOptions","ValidatedDuckDbSelectSql","ValidatedDuckDbSelectSqlWithoutRowId","ValidatedDuckDbSelectSqlWithRowId","validateDuckDbSelectSql","ValidateDuckDbSelectSqlOptions","x","y"]
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-spatial-aggregate-join","duckdb-query"]
stability: stable
verifiedVersion: 0.9.0
---

# DuckDB Processing Toolbox

`@mapseekai/emap/duckdb` 提供浏览器端 DuckDB-Wasm GIS Processing Toolbox。Processing 能力按 GIS 语义组织，而不是按 executor / registry 组织；每个工具同时包含执行函数和可供 UI、Workflow、Agent 使用的 `DuckDbToolDefinition`。

## 初始化

```ts
import {
  createDuckDbRuntimeFromJsDelivr,
  setDuckDbRuntime,
} from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr();
setDuckDbRuntime(runtime);
```

## 简化后的公共 API

```ts
import {
  buffer,
  clip,
  dissolve,
  spatialJoin,
  reproject,
} from '@mapseekai/emap/duckdb';

const buffered = await buffer(dataset, { distance: 20 });
const clipped = await clip(buffered, mask);
const dissolved = await dissolve(clipped, { groupBy: ['type'] });
const joined = await spatialJoin(dissolved, poi, { predicate: 'intersects' });
const wgs84 = await reproject(joined, { targetCrs: 'EPSG:4326' });
```

公共 API 不再要求使用 `xxxDatasetWithDuckDb` 形式。函数名直接对应 GIS 工具名称。

## Toolbox 分类

| 分类 | 工具 |
| --- | --- |
| Overlay | `clip` / `intersect` / `difference` / `union` / `symmetricDifference` |
| Proximity | `buffer` / `near` / `nearest` |
| Aggregate | `dissolve` / `collect` |
| Join | `attributeJoin` / `spatialJoin` / `spatialSummaryJoin` |
| Geometry | `centroid` / `envelope` / `convexHull` / `boundary` / `simplify` / `simplifyPreserveTopology` / `densify` / `multipartToSinglepart` / `extractVertices` |
| Transform | `pointToLine` / `lineToPolygon` / `polygonToLine` |
| Selection | `attributeFilter` / `spatialFilter` / `spatialRelation` |
| Data Management | `merge` / `append` / `reproject` / `repairGeometry` |
| Attributes | `area` / `length` / `perimeter` / `geometryType` / `isValid` / `isEmpty` / `isSimple` / `x` / `y` / `centroidX` / `centroidY` |

### Overlay

```ts
const clipped = await clip(parcels, district);
const overlap = await intersect(parcels, floodplain);
const erased = await difference(parcels, exclusion);
const coverage = await union(a, b);
const changedArea = await symmetricDifference(a, b);
```

`clip` / `intersect` / `difference` 保留 input 属性。`union` 和 `symmetricDifference` 当前是 coverage 几何语义，不是 QGIS 完整双属性 overlay。

### Proximity

```ts
const buffered = await buffer(roads, { distance: 50 });
const distances = await near(buildings, roads);
const nearestRoad = await nearest(buildings, roads, { nearestIdField: 'road_id' });
```

距离类工具默认要求 projected CRS。`near` 和 `nearest` 默认同时拒绝未知 CRS；请先声明正确坐标系或重投影，不要把坐标单位直接解释为米。

`nearest` 保留输入行顺序。等距候选按参考图层原始行号稳定选择；空几何不匹配任意候选，最近 ID 和距离均为 `null`。内部行号不会覆盖同名业务字段。输出 ID、距离字段名必须互不重复，且不能与输入字段冲突（按 DuckDB 的大小写不敏感规则检查）；冲突时请显式指定其他输出字段名。

### Aggregate

```ts
const districts = await dissolve(parcels, { groupBy: ['district'] });
const groups = await collect(points, { groupBy: ['category'] });
```

### Join

```ts
const byId = await attributeJoin(parcels, owners, {
  leftKey: 'owner_id',
  rightKey: 'id',
});

const matches = await spatialJoin(zones, points, {
  predicate: 'contains',
});

const summary = await spatialSummaryJoin(zones, points, {
  predicate: 'contains',
  aggregations: [
    { operation: 'count', outputColumn: 'point_count' },
    { operation: 'sum', field: 'sales', outputColumn: 'sales_total' },
  ],
});
```

`spatialJoin` 返回普通一对多空间连接；`spatialSummaryJoin` 用于 count / sum / avg / min / max 汇总。

### Geometry / Transform

```ts
const centers = await centroid(polygons);
const simple = await simplifyPreserveTopology(polygons, { tolerance: 2 });
const dense = await densify(lines, { maxSegmentLength: 10 });
const single = await multipartToSinglepart(multipart);
const vertices = await extractVertices(lines);
const route = await pointToLine(points, { orderBy: 'seq' });
const areas = await lineToPolygon(boundaryLines);
const outlines = await polygonToLine(polygons);
```

`densify` 使用 emap/Mapshaper ArcCollection 的浏览器端实现，因为当前 DuckDB-Wasm Spatial 版本没有可用的 `ST_Segmentize`；它仍作为统一 Toolbox 工具暴露。

### Selection

```ts
const active = await attributeFilter(dataset, {
  sql: 'SELECT geometry, name FROM input WHERE active = true',
});

const inside = await spatialFilter(parcels, district, {
  predicate: 'within',
});
```

`attributeFilter` 的 SQL 是受限单条 `SELECT`；高级空间谓词/attribute mode 可使用 `spatialRelation`。

### Data Management

```ts
const merged = await merge(a, b);
const appended = await append(target, incoming);
const projected = await reproject(dataset, { targetCrs: 'EPSG:3857' });
const repaired = await repairGeometry(dataset);
```

所有 Processing API 都返回新 Dataset，不原地修改调用方输入。`reproject` 保留空几何记录及属性，不把重投影隐式变成空几何清理；全部空几何或空输入也保留原图层几何类型。

## Agent / Workflow 接口

每个工具定义包含：

- `id` / `category` / `title` / `description`
- 输入槽位与 geometry 要求
- 参数类型、必填、默认值、枚举、数值范围
- CRS 与单位要求
- 输出 geometry / cardinality / attribute 语义
- `cost`
- `agent.summary` / `whenToUse` / `avoidWhen` / `keywords` / `examples`
- `execute(context)`

Agent 可以直接做工具发现和执行：

```ts
import { duckDbToolbox } from '@mapseekai/emap/duckdb';

const candidates = duckDbToolbox.search('count points in polygon');
// candidates[0].id === 'spatialSummaryJoin'

const result = await duckDbToolbox.execute('buffer', {
  inputs: { input: dataset },
  params: { distance: 50 },
  runtime,
});
```

`duckDbToolbox` 是 Agent / UI / Workflow 的唯一 Toolbox 公共入口，统一提供 `tools`、`list`、`get`、`require`、`search` 和 `execute`。Alias 也可以解析，例如 `intersection` → `intersect`、`makeValid` → `repairGeometry`。

## Source / Map 适配与安全写回

四个公开 `duckDb*Layer` 适配函数都要求显式填写 `output.sourceId`。同一源集合必须复用一个 `DuckDbMapOpContext`，`getSource()` 返回稳定对象，不能在每次调用时重新包装数据源。

```ts
import {
  duckDbAttributeFilterLayer,
  type DuckDbMapOpContext,
  type DuckDbMapOpSource,
} from '@mapseekai/emap/duckdb';

const sources = new Map<string, DuckDbMapOpSource>();
sources.set('input', { getDataset: () => dataset });
const context: DuckDbMapOpContext = {
  getSource: (id) => sources.get(id),
  setSourceDataset(id, result) {
    sources.set(id, { getDataset: () => result });
  },
};

const result = await duckDbAttributeFilterLayer(context, {
  src: 'input',
  sql: 'SELECT * FROM input',
  output: { sourceId: 'result' },
});
if (!result.ok && result.error.kind === 'stale-operation') {
  // 输入、输出或任务代次已变化；旧结果没有被写回。
}
```

计算可以异步，但 `setSourceDataset()` 必须同步完成写入，返回 `undefined`，不能是 `async` 函数或安排延迟写入。宿主需要的异步显示、加载工作应与这一步提交分开。

提交前会检查输入与输出源身份、Dataset 引用、`editVersion`、`attributeVersion`、CRS，以及可选字节和 GeoParquet 查询源引用。同一输出目标采用最新请求优先，不同输出目标仍可并发。通过外部代码修改 Dataset 时必须维护版本计数；替换字节或查询源时应提供新的稳定引用。

## 内部架构

```text
src/duckdb/
├── core/
├── overlay/
├── proximity/
├── aggregate/
├── join/
├── geometry/
├── transform/
├── selection/
├── data-management/
├── attributes/
├── geoparquet/
├── toolbox.ts
└── index.ts
```

分类目录中的 `index.ts` 只负责 re-export；参数校验、SQL、执行函数和 ToolDefinition 放在对应功能文件中。公共 pipeline、runner、ToolDefinition 等抽象集中在 `core/`。

根目录的旧 `*-registry.ts`、`*-executor.ts`、`processing-toolbox.ts` 兼容转发层已删除；`src/duckdb/` 下的分类文件是唯一实现。

## GeoParquet

GeoParquet 查询属于数据访问能力，不进入 Processing Toolbox：

```ts
const result = await queryGeoParquetWithDuckDb(bytes, {
  sql: 'SELECT geometry, name FROM input WHERE active = true',
});
```

## Breaking Changes

本轮 DuckDB 重构删除旧公共长命名，改为 GIS 工具名：

- `bufferDatasetWithDuckDb` → `buffer`
- `intersectionDatasetWithDuckDb` / `intersectDatasetWithDuckDb` → `intersect`
- `queryDatasetWithDuckDb` / `attributeFilterDatasetWithDuckDb` → `attributeFilter`
- `spatialAggregateJoinDatasetWithDuckDb` / `spatialSummaryJoinDatasetWithDuckDb` → `spatialSummaryJoin`
- `makeValidDatasetWithDuckDb` / `repairGeometryDatasetWithDuckDb` → `repairGeometry`
- 其他 `xxxDatasetWithDuckDb` 同样简化为 `xxx`
- `DUCKDB_TOOLBOX`、`listDuckDbTools`、`getDuckDbTool`、`requireDuckDbTool`、`searchDuckDbTools`、`executeDuckDbTool` 不再单独导出，统一使用 `duckDbToolbox.*`
- 删除无实际消费者的 `duckDbBufferLayer`、`duckDbGeometryLayer`、`duckDbRelationLayer`、`duckDbAttributeLayer`；保留真正用于 source/map 适配的 `duckDbAttributeFilterLayer`、`duckDbGeoParquetQueryLayer`、`duckDbOverlayLayer`、`duckDbSpatialSummaryJoinLayer`
- `DuckDbToolInputSpec`、`DuckDbToolParameterSpec`、`DuckDbToolObjectPropertySpec`、`DuckDbToolOutputSpec` 去掉 `Spec` 后缀，更名为 `DuckDbToolInput`、`DuckDbToolParameter`、`DuckDbToolObjectProperty`、`DuckDbToolOutput`

- `DuckDbToolId` 现在是实际工具 ID 的字面量联合类型，不再接受任意字符串。
- 四个 LayerOptions 的 `output` 从可选改为必填；`DuckDbMapOpContext.setSourceDataset` 从可异步改为同步提交契约。调用方须按上文迁移，避免旧结果覆盖新数据。
- DuckDB 只提供已发布的 ESM 子入口 `@mapseekai/emap/duckdb`，不生成未发布的 IIFE 文件。

完整变更记录见项目根目录 `CHANGELOG.md`。

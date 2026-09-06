---
id: duckdb
slug: /data/duckdb
title: DuckDB Processing Toolbox
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-spatial-aggregate-join","duckdb-query"]
stability: stable
verifiedVersion: 0.8.1
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

距离类工具默认要求 projected CRS。

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
const simple = await simplify(polygons, { tolerance: 2, preserveTopology: true });
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

所有 Processing API 都返回新 Dataset，不原地修改调用方输入。

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
import {
  duckDbToolbox,
  searchDuckDbTools,
} from '@mapseekai/emap/duckdb';

const candidates = searchDuckDbTools('count points in polygon');
// candidates[0].id === 'spatialSummaryJoin'

const result = await duckDbToolbox.execute('buffer', {
  inputs: { input: dataset },
  params: { distance: 50 },
  runtime,
});
```

Alias 也可以解析，例如 `intersection` → `intersect`、`makeValid` → `repairGeometry`。

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

完整变更记录见项目根目录 `CHANGELOG.md`。

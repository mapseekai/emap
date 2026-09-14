---
id: duckdb
slug: /data/duckdb
title: DuckDB Processing Toolbox
api: ["AggregateOptions","append","area","attributeFilter","AttributeFilterOptions","attributeJoin","AttributeJoinOptions","AttributeOptions","boundary","buffer","BufferOptions","centroid","centroidX","centroidY","clip","ClipOptions","closeDuckDbRuntime","collect","convexHull","createDuckDbGeoParquetQuerySource","createDuckDbRuntimeFromJsDelivr","CreateDuckDbRuntimeOptions","densify","DensifyOptions","difference","DifferenceOptions","dissolve","DuckDbAgentMetadata","duckDbAttributeFilterLayer","DuckDbAttributeFilterLayerOptions","DuckDbAttributeFilterLayerResult","DuckDbConnection","duckDbGeoParquetQueryLayer","DuckDbGeoParquetQueryLayerOptions","DuckDbGeoParquetQueryLayerResult","DuckDbGeoParquetQueryOptions","DuckDbGeoParquetQuerySource","DuckDbMapOpContext","DuckDbMapOpSource","DuckDbOperationError","DuckDbOperationErrorKind","duckDbOverlayLayer","DuckDbOverlayLayerOptions","DuckDbOverlayLayerResult","DuckDbRuntime","DuckDbSpatialExtensionUrls","duckDbSpatialSummaryJoinLayer","DuckDbSpatialSummaryJoinLayerOptions","DuckDbSpatialSummaryJoinLayerResult","duckDbToolbox","DuckDbToolCategory","DuckDbToolDefinition","DuckDbToolExecutionContext","DuckDbToolId","DuckDbToolInput","DuckDbToolObjectProperty","DuckDbToolOutput","DuckDbToolParameter","DuckDbWasmModule","envelope","extractVertices","GeometryOptions","geometryType","intersect","IntersectOptions","isEmpty","isSimple","isValid","length","lineToPolygon","merge","MergeOptions","multipartToSinglepart","near","nearest","NearestOptions","NearOptions","perimeter","pointToLine","PointToLineOptions","polygonToLine","queryGeoParquetWithDuckDb","quoteSqlString","repairGeometry","RepairGeometryOptions","reproject","ReprojectOptions","simplify","SimplifyOptions","simplifyPreserveTopology","SpatialAggregation","spatialFilter","SpatialFilterOptions","SpatialFilterPredicate","spatialJoin","SpatialJoinOptions","SpatialJoinPredicate","spatialRelation","SpatialRelationOptions","spatialSummaryJoin","SpatialSummaryJoinOptions","SpatialSummaryJoinPredicate","SpatialSummaryJoinType","SpatialSummaryOperation","symmetricDifference","SymmetricDifferenceOptions","union","UnionOptions","ValidatedDuckDbSelectSql","ValidatedDuckDbSelectSqlWithoutRowId","ValidatedDuckDbSelectSqlWithRowId","validateDuckDbSelectSql","ValidateDuckDbSelectSqlOptions","x","y"]
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-query","duckdb-spatial-aggregate-join"]
stability: stable
verifiedVersion: 0.9.1
---

# DuckDB Processing Toolbox

`@mapseekai/emap/duckdb` is an optional browser-side DuckDB-Wasm GIS entry point. It provides GeoParquet queries, standalone Dataset processing functions, and `duckDbToolbox` for UI, workflow, or agent use. Processing functions return new datasets and do not mutate their input datasets.

## Install and set up the runtime

Install the optional dependency containing DuckDB-Wasm and import the subpath. Create a runtime and pass it explicitly to processing functions. Each workspace owns an independent runtime.

```ts
import {
  createDuckDbRuntimeFromJsDelivr,
  closeDuckDbRuntime,
} from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr();

// When the application closes DuckDB:
await closeDuckDbRuntime(runtime);
```

## GIS processing

Processing functions use short GIS names and compose directly:

```ts
import { buffer, clip, dissolve, spatialJoin } from '@mapseekai/emap/duckdb';

const buffered = await buffer(roads, { distance: 20 }, runtime);
const clipped = await clip(buffered, boundary, {}, runtime);
const districts = await dissolve(clipped, { groupBy: ['district'] }, runtime);
const joined = await spatialJoin(districts, points, {
  predicate: 'contains',
}, runtime);
```

| Category | Tools |
| --- | --- |
| Overlay | `clip`, `intersect`, `union`, `difference`, `symmetricDifference` |
| Proximity | `buffer`, `near`, `nearest` |
| Aggregate | `dissolve`, `collect` |
| Join | `attributeJoin`, `spatialJoin`, `spatialSummaryJoin` |
| Geometry | `centroid`, `envelope`, `convexHull`, `boundary`, `simplify`, `simplifyPreserveTopology`, `densify`, `multipartToSinglepart`, `extractVertices` |
| Transform | `pointToLine`, `lineToPolygon`, `polygonToLine` |
| Selection | `attributeFilter`, `spatialFilter`, `spatialRelation` |
| Data management | `merge`, `append`, `reproject`, `repairGeometry` |
| Attributes | `area`, `length`, `perimeter`, `geometryType`, `isValid`, `isEmpty`, `isSimple`, `x`, `y`, `centroidX`, `centroidY` |

Distance tools use Dataset coordinate units. `near` and `nearest` require a known projected CRS by default. `spatialJoin` creates a one-to-many spatial join; `spatialSummaryJoin` supplies count, sum, avg, min, and max aggregation.

## Toolbox

`duckDbToolbox` exposes `tools`, `list()`, `get()`, `require()`, `search()`, and `execute()`. Use it to build UI, workflows, and agents from tool IDs or search terms:

```ts
import { duckDbToolbox } from '@mapseekai/emap/duckdb';

const candidates = duckDbToolbox.search('count points in polygon');
const result = await duckDbToolbox.execute('buffer', {
  inputs: { input: roads },
  params: { distance: 50 },
  runtime,
});
```

Each tool definition describes its input geometry, parameters, CRS/unit requirements, output semantics, cost, and agent metadata.

## GeoParquet queries

`queryGeoParquetWithDuckDb()` queries GeoParquet bytes. Its SQL is a restricted single `SELECT` against the `input` table: select provided columns and use supported filtering, ordering, and limiting clauses. `validateDuckDbSelectSql()` validates the same query contract before execution.

```ts
import { queryGeoParquetWithDuckDb } from '@mapseekai/emap/duckdb';

const result = await queryGeoParquetWithDuckDb(bytes, {
  sql: 'SELECT geometry, name FROM input WHERE active = true',
}, runtime);
```

Query access is GeoParquet data access, not part of the Processing Toolbox.

## API

- [createDuckDbRuntimeFromJsDelivr](/mapseekai/emap/api/functions/duckdb.createDuckDbRuntimeFromJsDelivr.html)
- [closeDuckDbRuntime](/mapseekai/emap/api/functions/duckdb.closeDuckDbRuntime.html)
- [validateDuckDbSelectSql](/mapseekai/emap/api/functions/duckdb.validateDuckDbSelectSql.html)
- [queryGeoParquetWithDuckDb](/mapseekai/emap/api/functions/duckdb.queryGeoParquetWithDuckDb.html)
- [duckDbToolbox](/mapseekai/emap/api/variables/duckdb.duckDbToolbox.html)

## Runnable examples

- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)
- [DuckDB GeoParquet query](/mapseekai/emap/examples/duckdb-geoparquet-query/)
- [DuckDB overlay](/mapseekai/emap/examples/duckdb-overlay/)
- [DuckDB query](/mapseekai/emap/examples/duckdb-query/)
- [DuckDB spatial aggregate join](/mapseekai/emap/examples/duckdb-spatial-aggregate-join/)

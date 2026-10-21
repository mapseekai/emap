---
id: duckdb
slug: /data/duckdb
title: DuckDB Processing Toolbox
api: ["AggregateOptions", "append", "area", "attributeFilter", "AttributeFilterOptions", "attributeJoin", "AttributeJoinOptions", "AttributeOptions", "boundary", "buffer", "BufferOptions", "centroid", "centroidX", "centroidY", "clip", "ClipOptions", "closeDuckDbRuntime", "collect", "convexHull", "createDuckDbGeoParquetQuerySource", "createDuckDbRuntimeFromJsDelivr", "CreateDuckDbRuntimeOptions", "densify", "DensifyOptions", "difference", "DifferenceOptions", "dissolve", "DuckDbAgentMetadata", "duckDbAttributeFilterLayer", "DuckDbAttributeFilterLayerOptions", "DuckDbAttributeFilterLayerResult", "DuckDbConnection", "duckDbGeoParquetQueryLayer", "DuckDbGeoParquetQueryLayerOptions", "DuckDbGeoParquetQueryLayerResult", "DuckDbGeoParquetQueryOptions", "DuckDbGeoParquetQuerySource", "DuckDbMapOpContext", "DuckDbMapOpSource", "DuckDbOperationError", "DuckDbOperationErrorKind", "duckDbOverlayLayer", "DuckDbOverlayLayerOptions", "DuckDbOverlayLayerResult", "DuckDbRuntime", "DuckDbSpatialExtensionUrls", "duckDbSpatialSummaryJoinLayer", "DuckDbSpatialSummaryJoinLayerOptions", "DuckDbSpatialSummaryJoinLayerResult", "duckDbToolbox", "DuckDbToolCategory", "DuckDbToolDefinition", "DuckDbToolExecutionContext", "DuckDbToolId", "DuckDbToolInput", "DuckDbToolObjectProperty", "DuckDbToolOutput", "DuckDbToolParameter", "DuckDbWasmModule", "envelope", "extractVertices", "GeometryOptions", "geometryType", "intersect", "IntersectOptions", "isEmpty", "isSimple", "isValid", "length", "lineToPolygon", "merge", "MergeOptions", "multipartToSinglepart", "near", "nearest", "NearestOptions", "NearOptions", "perimeter", "pointToLine", "PointToLineOptions", "polygonToLine", "queryGeoParquetWithDuckDb", "quoteSqlString", "repairGeometry", "RepairGeometryOptions", "reproject", "ReprojectOptions", "simplify", "SimplifyOptions", "simplifyPreserveTopology", "SpatialAggregation", "spatialFilter", "SpatialFilterOptions", "SpatialFilterPredicate", "spatialJoin", "SpatialJoinOptions", "SpatialJoinPredicate", "spatialRelation", "SpatialRelationOptions", "spatialSummaryJoin", "SpatialSummaryJoinOptions", "SpatialSummaryJoinPredicate", "SpatialSummaryJoinType", "SpatialSummaryOperation", "symmetricDifference", "SymmetricDifferenceOptions", "union", "UnionOptions", "ValidatedDuckDbSelectSql", "ValidatedDuckDbSelectSqlWithoutRowId", "ValidatedDuckDbSelectSqlWithRowId", "validateDuckDbSelectSql", "ValidateDuckDbSelectSqlOptions", "x", "y"]
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-query","duckdb-spatial-aggregate-join"]
stability: stable
verifiedVersion: unreleased
---

# DuckDB Processing Toolbox

`@mapseekai/emap/duckdb` provides browser-side DuckDB-Wasm GIS processing: GeoParquet queries, buffers, overlays, spatial joins, aggregation, and attribute calculations. This optional entry point exposes composable Dataset functions and the discoverable `duckDbToolbox`; processing functions return new Datasets.

```ts
import { createDuckDbRuntimeFromJsDelivr, closeDuckDbRuntime } from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr(); // create an independent DuckDB-Wasm runtime
await closeDuckDbRuntime(runtime); // release the runtime when the application closes
```

## Core methods

| Method | Parameters | Description |
| --- | --- | --- |
| `createDuckDbRuntimeFromJsDelivr()` | `CreateDuckDbRuntimeOptions` | Create a browser DuckDB-Wasm runtime. |
| `buffer(input, options, runtime)` | `Dataset`, `BufferOptions`, `DuckDbRuntime` | Produce a buffered Dataset. |
| `clip(input, reference, options, runtime)` / `dissolve(input, options, runtime)` | `Dataset`, `Dataset`, options, runtime | Clip data or merge geometry by field. |
| `closeDuckDbRuntime(runtime)` | `DuckDbRuntime \| null` | Close the runtime. |

## More runtime configuration

Install the optional dependency, import the subpath, and pass an independent runtime to processing functions.

### `createDuckDbRuntimeFromJsDelivr`

This constructor creates a jsDelivr DuckDB-Wasm runtime; `ensureSpatial()` prepares the spatial extension on first GIS operation.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `duckdb` | `DuckDbWasmModule` | Dynamic import of `@duckdb/duckdb-wasm` | Loaded DuckDB-Wasm module. |
| `customExtensionRepository` | `string` | Unset | Spatial extension repository URL. |
| `spatialExtensionUrls` | `DuckDbSpatialExtensionUrls` | Unset | Self-hosted spatial `.wasm` URLs; exclusive with `customExtensionRepository`. |
| `workerFactory` | `(url: string) => Worker \| Promise<Worker>` | Browser `Worker` | DuckDB Worker constructor. |
| `createObjectURL` | `(blob: Blob) => string` | `URL.createObjectURL` | Worker-wrapper script URL constructor. |
| `revokeObjectURL` | `(url: string) => void` | `URL.revokeObjectURL` | Releases the Worker-wrapper URL. |

`closeDuckDbRuntime(runtime)` accepts `DuckDbRuntime | null` (default `null`) and calls `close()`.

### `DuckDbRuntimeScope` and `duckDbPlugin`

`DuckDbRuntimeScope` lazily creates a runtime; `duckDbPlugin(options)` manages one in the Cordis provider lifecycle.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `runtime` | `DuckDbRuntime` | Unset | Caller-provided runtime. |
| `create` | `() => Promise<DuckDbRuntime>` | `createDuckDbRuntimeFromJsDelivr` | Lazy runtime constructor. |
| `owned` | `boolean` | `true` when `runtime` is absent | Controls closing on `dispose()`; choose either `runtime` or `create`. |

## More GIS processing

Processing functions compose directly:

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

Call `(input, options, runtime)` or `(input, reference, options, runtime)`; `runtime` is `DuckDbRuntime | null`, defaulting to `null`. Single-input tools share:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `layer` | `string \| number` | `0` | Input layer name or index. |
| `outputLayer` | `string` | `'layer'` | Result layer name. |
| `geometryColumn` | `string` | `'geometry'` | Arrow/WKB geometry-column name. |

### Tool families and key parameters

| Category | Tools | Key parameters and usage |
| --- | --- | --- |
| Overlay | `clip`, `intersect`, `difference` | `inputLayer`, `maskLayer`: `string \| number`, default `0`; `outputLayer`; geometry columns default `'geometry'`. Clips, intersects, or subtracts; mask CRS aligns. |
| Overlay | `union`, `symmetricDifference` | Inherits single-input options; `union` combines coverage, `symmetricDifference` keeps exclusive areas. |
| Proximity | `buffer` | Required positive `distance: number`; `failOnGeographicCrs: boolean` defaults to `true`. Inherits single-input options. |
| Proximity | `near` | `inputLayer`, `referenceLayer`: `string \| number`, default `0`; `inputGeometryColumn`, `referenceGeometryColumn`: `string`, default `'geometry'`; `outputDistanceColumn: string` defaults to `'near_distance'`; `outputLayer`; `failOnGeographicCrs: boolean` defaults to `true`. |
| Proximity | `nearest` | `nearestIdField?: string`; `outputNearestIdColumn: string` defaults to `'nearest_id'`; `outputDistanceColumn: string` defaults to `'nearest_distance'`; inherits single-input options. Projected CRS. |
| Aggregate | `dissolve`, `collect` | `groupBy: readonly string[]` defaults to `[]`; global aggregate. `dissolve` unions geometry; `collect` retains parts; inherits single-input options. |
| Join | `attributeJoin` | Required `leftKey: string`, `rightKey: string`; `joinType: 'left' \| 'inner'` defaults to `'left'`; inherits single-input options. |
| Join | `spatialJoin` | `predicate` defaults to `'intersects'`: `intersects`, `contains`, `within`, `touches`, `disjoint`, `overlaps`, `equals`, `crosses`, `covers`, `coveredBy`, `containsProperly`; `joinType: 'left' \| 'inner'` defaults to `'left'`. |
| Join | `spatialSummaryJoin` | Required `predicate`, nonempty `aggregations: readonly SpatialAggregation[]`; `joinType` defaults to `'left'`; `targetLayer`, `joinLayer` default `0`; `targetGeometryColumn`, `joinGeometryColumn` default `'geometry'`; `outputLayer`. |
| Geometry | `centroid`, `envelope`, `convexHull`, `boundary`, `multipartToSinglepart`, `extractVertices` | Inherits `layer`, `outputLayer`, `geometryColumn`; first four preserve count, last two expand parts or vertices. |
| Geometry | `simplify`, `simplifyPreserveTopology` | Required nonnegative `tolerance: number`; `failOnGeographicCrs: boolean` defaults to `true`; latter preserves topology. |
| Geometry | `densify` | Required positive `maxSegmentLength: number`; inherits single-input options. |
| Transform | `pointToLine` | `groupBy: readonly string[]` defaults to `[]`; `orderBy?: string` orders points; inherits single-input options. |
| Transform | `lineToPolygon`, `polygonToLine` | `lineToPolygon.groupBy` defaults to `[]`; `polygonToLine` inherits single-input options. |
| Selection | `spatialFilter`, `spatialRelation` | `predicate` accepts topological relations and `distanceWithin`; `spatialRelation` also accepts `distance`, `mode: 'filter' \| 'attribute'` (default `'filter'`); `distance: number` is required and positive for `distanceWithin`. Both support `inputLayer`, `maskLayer`, `outputLayer`, `inputGeometryColumn`, `maskGeometryColumn`, `outputColumn`, `failOnGeographicCrs`. |
| Data management | `merge`, `append`, `repairGeometry` | `merge`, `append` combine by field name; `repairGeometry` uses `ST_MakeValid`; inherit single-input options. |
| Data management | `reproject` | Required `targetCrs: string`; `sourceCrs?: string` defaults to Dataset CRS; `alwaysXY: boolean` defaults to `true`. |
| Attributes | `area`, `length`, `perimeter`, `geometryType`, `isValid`, `isEmpty`, `isSimple`, `x`, `y`, `centroidX`, `centroidY` | `outputColumn?: string` defaults respectively to `duckdb_area`, `duckdb_length`, `duckdb_perimeter`, `duckdb_geometry_type`, `duckdb_is_valid`, `duckdb_is_empty`, `duckdb_is_simple`, `duckdb_x`, `duckdb_y`, `duckdb_centroid_x`, `duckdb_centroid_y`; `failOnGeographicCrs: boolean` defaults to `true`. |


### `attributeFilter` SQL contract

`attributeFilter(dataset, options, runtime)` retains geometry and replaces attributes with an SQL projection.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `sql` | `string` | Required | Restricted single `SELECT` over `input`; supports existing non-geometry columns, `WHERE`, `ORDER BY`, and `LIMIT`. |
| `geometryColumn` | `string` | `'geometry'` | Input geometry-column name. |
| `inputLayer` | `string \| number` | `0` | Input layer name or index. |
| `outputLayer` | `string` | Input layer name | Result layer name. |
| `rowIdColumn` | `string` | `'__emap_rowid'` | Internal row-ID column; renamed on conflict. |

Supports `*` or bare/double-quoted columns; validator requires one `SELECT` and `FROM input`.


## More toolbox

```ts
import { duckDbToolbox } from '@mapseekai/emap/duckdb';

const candidates = duckDbToolbox.search('count points in polygon');
const result = await duckDbToolbox.execute('buffer', {
  inputs: { input: roads },
  params: { distance: 50 },
  runtime,
});
```

| API / Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `list(category?)` | `DuckDbToolCategory` | Every tool | Lists tools by category. |
| `get(idOrAlias)` / `require(idOrAlias)` | `string` | Required | Gets a definition by ID or alias. |
| `search(query, category?)` | `string`, `DuckDbToolCategory` | Query required | Ranks matching tools by metadata. |
| `execute(idOrAlias, context)` | `string`, `DuckDbToolExecutionContext` | Required | Inputs, parameters, and runtime; validates before execution. |

Tool definitions include inputs, parameters, CRS/units, outputs, cost, and agent metadata.

### Cancel one tool run

Pass the caller signal as `DuckDbToolExecutionContext.signal`, or `options.signal` when calling a processing function directly:

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

`signal.aborted` indicates logical cancellation. The returned Promise finishes after pending-query cancellation is acknowledged, in-flight polling/result reads finish, temporary tables are dropped and the connection closes. It normally rejects with the signal's reason. Await it before retrying with a new controller. A cleanup failure includes the cleanup error and must not be treated as confirmation that retry is safe.

Runtime connections use DuckDB's pending-query API for `query(sql, signal?)` when a signal is supplied. Cancellation stops further polling and consumption, waits for the current request and cancellation acknowledgement, and releases the Arrow reader and unread remote stream. Queries, inserts and close calls on one connection run in order, so an old signal cannot cancel the next query. Cleanup preserves that connection's temporary tables, session settings and caller-owned transaction state; subsequent queries can use a new signal. Ordinary cancellation affects only that operation's connection; other connections and the shared runtime remain usable. Custom `DuckDbRuntime` implementations must implement the query signal contract themselves; outer checks can only suppress results when an implementation ignores the signal.

Shared runtime initialization and spatial-extension loading belong to the runtime. A cancelled operation waits for shared initialization already in progress, then skips its connection/query without closing the database. Synchronous Arrow preparation and Dataset conversion cannot be preempted by a signal either. `runtime.close()` releases the database for its owner and is not a per-query cancel API.


## More GeoParquet queries

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `Uint8Array \| ArrayBuffer` | Required | GeoParquet bytes. |
| `sql` | `string` | Required | Restricted single `SELECT` over `input`; project geometry for a spatial Dataset. |
| `geometryColumn` | `string` | Auto-detected | Overrides geometry-column detection. |
| `layerName` | `string` | `'layer'` | Result layer name. |
| `noTopology` | `boolean` | `false` | Builds shared-arc topology. |

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

`validateDuckDbSelectSql(sql, options)` uses the same validator; `availableColumns` and `physicalTableName` are required. GeoParquet calls it with `allowGeometryProjection: true`, `rowIdColumn: null`.

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

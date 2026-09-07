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

`@mapseekai/emap/duckdb` provides a browser-side DuckDB-Wasm GIS processing toolbox. Processing code is organized by GIS category rather than by registry/executor layers. Every tool owns both its execution function and a `DuckDbToolDefinition` that UI, workflow and Agent callers can consume.

## Setup

```ts
import { createDuckDbRuntimeFromJsDelivr, setDuckDbRuntime } from '@mapseekai/emap/duckdb';
const runtime = await createDuckDbRuntimeFromJsDelivr();
setDuckDbRuntime(runtime);
```

## Short canonical API

```ts
import { buffer, clip, dissolve, spatialJoin, reproject } from '@mapseekai/emap/duckdb';
const buffered = await buffer(dataset, { distance: 20 });
const clipped = await clip(buffered, mask);
const dissolved = await dissolve(clipped, { groupBy: ['type'] });
const joined = await spatialJoin(dissolved, poi, { predicate: 'intersects' });
const wgs84 = await reproject(joined, { targetCrs: 'EPSG:4326' });
```

Public processing functions now use GIS tool names directly instead of `xxxDatasetWithDuckDb` names.

## Categories

| Category | Tools |
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

### Agent / workflow discovery

Each tool definition contains input slots, geometry constraints, parameter schema, CRS/unit requirements, output semantics, cost guidance and Agent-oriented metadata (`summary`, `whenToUse`, `avoidWhen`, `keywords`, `examples`).

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

`duckDbToolbox` is the single public Toolbox entry point for Agent/UI/workflow callers, exposing `tools`, `list`, `get`, `require`, `search`, and `execute`. Aliases are resolved too, for example `intersection` → `intersect` and `makeValid` → `repairGeometry`.

## Notes

- `spatialJoin` is a normal one-to-many spatial join; `spatialSummaryJoin` performs count/sum/avg/min/max aggregation.
- Distance tools default to projected CRS requirements. `near` and `nearest` also reject unknown CRS by default. Distances use dataset coordinate units, which are not necessarily meters.
- `nearest` preserves input row order, breaks equal-distance ties by reference row order, and leaves null/empty geometries unmatched with null ID and distance. Generated row IDs cannot collide with business attributes. Output ID/distance names must be distinct from one another and from input fields, using case-insensitive comparison; choose different output names on conflict.
- `densify` uses the emap/Mapshaper ArcCollection implementation because the current DuckDB-Wasm Spatial runtime does not expose a usable `ST_Segmentize`.
- `union` and `symmetricDifference` currently use coverage geometry semantics, not full QGIS-style dual-attribute overlay semantics.
- Processing functions return new datasets and do not mutate caller-owned inputs. `reproject` retains null-geometry records and attributes, and preserves the input geometry type for all-null or empty inputs.
- GeoParquet query access remains outside the Processing Toolbox.

## Source / map adapters and safe writeback

All four public `duckDb*Layer` adapters require an explicit `output.sourceId`. Reuse one `DuckDbMapOpContext` for a source collection. `getSource()` must return stable source objects, not freshly created wrappers on every call.

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
  // Inputs, output, or request generation changed; the old result was not committed.
}
```

Computation is asynchronous, but `setSourceDataset()` must complete synchronously and return `undefined`. It cannot be an `async` function or schedule a deferred write. Keep asynchronous display/loading work separate from this commit.

Before committing, the adapter checks input/output source identity, dataset identity, `editVersion`, `attributeVersion`, CRS, and optional byte/query-source references. The latest request wins for a shared output, while independent outputs can run concurrently. External dataset mutations must maintain version counters; byte or query-source replacement must expose new stable references.

## Internal layout

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

Category `index.ts` files are re-export-only. Validation, SQL, execution functions and ToolDefinitions live with the corresponding tool files. Shared pipeline/runners and Agent definition contracts live under `core/`.

The legacy root `*-registry.ts`, `*-executor.ts` and `processing-toolbox.ts` compatibility forwarders were removed; the category files under `src/duckdb/` are the only implementation.

## Breaking changes

The old long processing names were removed from the public DuckDB entry point. Examples:

- `bufferDatasetWithDuckDb` → `buffer`
- `intersectionDatasetWithDuckDb` / `intersectDatasetWithDuckDb` → `intersect`
- `queryDatasetWithDuckDb` / `attributeFilterDatasetWithDuckDb` → `attributeFilter`
- `spatialAggregateJoinDatasetWithDuckDb` / `spatialSummaryJoinDatasetWithDuckDb` → `spatialSummaryJoin`
- `makeValidDatasetWithDuckDb` / `repairGeometryDatasetWithDuckDb` → `repairGeometry`
- other `xxxDatasetWithDuckDb` helpers follow the same `xxx` simplification
- `DUCKDB_TOOLBOX`, `listDuckDbTools`, `getDuckDbTool`, `requireDuckDbTool`, `searchDuckDbTools`, and `executeDuckDbTool` are no longer exported separately; use `duckDbToolbox.*`
- removed the unused `duckDbBufferLayer`, `duckDbGeometryLayer`, `duckDbRelationLayer`, and `duckDbAttributeLayer` adapters; the source/map adapters with real consumers remain `duckDbAttributeFilterLayer`, `duckDbGeoParquetQueryLayer`, `duckDbOverlayLayer`, and `duckDbSpatialSummaryJoinLayer`
- `DuckDbToolInputSpec`, `DuckDbToolParameterSpec`, `DuckDbToolObjectPropertySpec`, and `DuckDbToolOutputSpec` drop the `Spec` suffix: `DuckDbToolInput`, `DuckDbToolParameter`, `DuckDbToolObjectProperty`, `DuckDbToolOutput`

- `DuckDbToolId` is now a literal union of actual tool IDs, not an arbitrary string.
- All four LayerOptions require `output`, and `DuckDbMapOpContext.setSourceDataset` is now a synchronous commit contract. Migrate callers as shown above.
- The DuckDB distribution uses only the ESM subpath `@mapseekai/emap/duckdb`; the unshipped IIFE is no longer built.

See the root `CHANGELOG.md` for the full migration note.

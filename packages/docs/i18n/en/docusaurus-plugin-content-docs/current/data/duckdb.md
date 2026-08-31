---
id: duckdb
slug: /data/duckdb
title: DuckDB
api: ["areaDatasetWithDuckDb","boundaryDatasetWithDuckDb","bufferDatasetWithDuckDb","centroidDatasetWithDuckDb","centroidXDatasetWithDuckDb","centroidYDatasetWithDuckDb","closeDuckDbRuntime","containsAttributeDatasetWithDuckDb","containsDatasetWithDuckDb","overlapsDatasetWithDuckDb","overlapsAttributeDatasetWithDuckDb","equalsDatasetWithDuckDb","equalsAttributeDatasetWithDuckDb","crossesDatasetWithDuckDb","crossesAttributeDatasetWithDuckDb","coversDatasetWithDuckDb","coversAttributeDatasetWithDuckDb","coveredByDatasetWithDuckDb","coveredByAttributeDatasetWithDuckDb","containsProperlyDatasetWithDuckDb","containsProperlyAttributeDatasetWithDuckDb","convexHullDatasetWithDuckDb","createDuckDbGeoParquetQuerySource","createDuckDbRuntimeFromJsDelivr","CreateDuckDbRuntimeOptions","DuckDbSpatialExtensionUrls","differenceDatasetWithDuckDb","disjointAttributeDatasetWithDuckDb","disjointDatasetWithDuckDb","distanceDatasetWithDuckDb","distanceWithinAttributeDatasetWithDuckDb","distanceWithinDatasetWithDuckDb","DUCKDB_ATTRIBUTE_OPERATION_SPECS","DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS","duckDbAttributeLayer","DuckDbAttributeLayerOptions","DuckDbAttributeLayerResult","DuckDbAttributeOperationId","DuckDbAttributeOperationOptions","DuckDbAttributeOperationSpec","DuckDbAttributeOptions","duckDbBufferLayer","DuckDbBufferLayerOptions","DuckDbBufferLayerResult","DuckDbBufferOptions","DuckDbConnection","duckDbGeometryLayer","DuckDbGeometryLayerOptions","DuckDbGeometryLayerResult","DuckDbGeometryOperationSpec","duckDbGeoParquetQueryLayer","DuckDbGeoParquetQueryLayerOptions","DuckDbGeoParquetQueryLayerResult","DuckDbGeoParquetQueryOptions","DuckDbGeoParquetQuerySource","DuckDbMapOpContext","DuckDbMapOpSource","DuckDbNamedRelationOperationSpec","DuckDbOperationError","DuckDbOperationErrorKind","DuckDbOverlayHelperOptions","duckDbOverlayLayer","DuckDbOverlayLayerOptions","DuckDbOverlayLayerResult","DuckDbOverlayOperationId","DuckDbOverlayOperationSpec","DuckDbOverlayOptions","duckDbQueryLayer","DuckDbQueryLayerOptions","DuckDbQueryLayerResult","DuckDbQueryOptions","DuckDbRelationAttributeDistanceOperationSpec","DuckDbRelationAttributeDistanceWithinOperationSpec","DuckDbRelationAttributePredicateOperationSpec","DuckDbRelationFilterDistanceWithinOperationSpec","DuckDbRelationFilterPredicateOperationSpec","DuckDbRelationHelperOptions","duckDbRelationLayer","DuckDbRelationLayerOptions","DuckDbRelationLayerResult","DuckDbRelationMode","DuckDbRelationOperationId","DuckDbRelationOperationSpec","DuckDbRelationOptions","DuckDbRelationOutputKind","DuckDbRuntime","DuckDbSimplifyOptions","DuckDbSpatialAggregateJoinPredicate","DuckDbSpatialAggregateJoinType","DuckDbSpatialAggregateOperation","DuckDbSpatialAggregation","DuckDbSpatialAggregateJoinOptions","spatialAggregateJoinDatasetWithDuckDb","DuckDbSpatialAggregateJoinLayerOptions","DuckDbSpatialAggregateJoinLayerResult","duckDbSpatialAggregateJoinLayer","DuckDbUnaryGeometryOperationId","DuckDbUnaryGeometryOptions","DuckDbWasmModule","Emap","envelopeDatasetWithDuckDb","geometryTypeDatasetWithDuckDb","getDuckDbAttributeOperationSpec","getDuckDbOverlayOperationSpec","getDuckDbRelationOperationSpec","getDuckDbRuntime","getDuckDbUnaryGeometryOperationSpec","intersectionDatasetWithDuckDb","intersectsAttributeDatasetWithDuckDb","intersectsDatasetWithDuckDb","isEmptyDatasetWithDuckDb","isSimpleDatasetWithDuckDb","isValidDatasetWithDuckDb","lengthDatasetWithDuckDb","makeValidDatasetWithDuckDb","normalizeDuckDbBufferOptions","perimeterDatasetWithDuckDb","processAttributeWithDuckDb","processGeometryWithDuckDb","processOverlayWithDuckDb","processRelationWithDuckDb","queryDatasetWithDuckDb","queryGeoParquetWithDuckDb","resolveAttributeOutputColumn","resolveRelationOutputColumn","runRelationOperation","setDuckDbRuntime","simplifyDatasetWithDuckDb","simplifyPreserveTopologyDatasetWithDuckDb","touchesAttributeDatasetWithDuckDb","touchesDatasetWithDuckDb","ValidatedDuckDbSelectSql","ValidatedDuckDbSelectSqlWithoutRowId","ValidatedDuckDbSelectSqlWithRowId","validateDuckDbSelectSql","ValidateDuckDbSelectSqlOptions","withinAttributeDatasetWithDuckDb","withinDatasetWithDuckDb","xDatasetWithDuckDb","yDatasetWithDuckDb"]
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-spatial-aggregate-join","duckdb-query"]
stability: stable
verifiedVersion: 0.5.0
---

# DuckDB

`@mapseekai/emap/duckdb` is an optional browser DuckDB-Wasm entry for restricted
SQL and spatial functions. Core maps do not load it; only applications that
import the subpath pay its download and initialization cost.

## Install and load

```bash
pnpm add @duckdb/duckdb-wasm
```

It is an optional Emap dependency. Install it explicitly when the package
manager skips optional dependencies.

Load lazily:

```ts
const duckdb = await import('@mapseekai/emap/duckdb');
```

`@mapseekai/emap/duckdb` is a `package.json` export subpath. Configure a modern
TypeScript resolver before importing it; see
[Installation](../getting-started/installation.md) for browser-bundler, native
Node ESM, and legacy-resolver requirements.


## Initialize the runtime

```ts
const runtime = await duckdb.createDuckDbRuntimeFromJsDelivr();
duckdb.setDuckDbRuntime(runtime);
```

Applications that already own DuckDB-Wasm may inject an adapter through
`setDuckDbRuntime(...)`. GeoParquet byte queries require
`registerFileBuffer`; `dropFile` is optional cleanup.

By default `ensureSpatial()` downloads the spatial extension from DuckDB's
extension repository via `INSTALL spatial`. Self-hosting the extension files
skips the remote install — the runtime fetches the URL matching the selected
bundle platform once and loads it from DuckDB's in-memory filesystem:

```ts
const runtime = await duckdb.createDuckDbRuntimeFromJsDelivr({
  spatialExtensionUrls: {
    eh: '/duckdb-ext/eh/spatial.duckdb_extension.wasm',
    mvp: '/duckdb-ext/mvp/spatial.duckdb_extension.wasm',
    // Only needed when DuckDB-Wasm exposes a COI bundle.
    coi: '/duckdb-ext/coi/spatial.duckdb_extension.wasm',
  },
});
```

The runtime selects a URL using DuckDB-Wasm's actual selected bundle key
(`mvp`, `eh`, or optional `coi`); it does not parse the WASM URL filename. The
download URL may use signed/query parameters or any basename. The runtime
always registers and loads a fixed internal virtual file named
`spatial.duckdb_extension.wasm`.

Extension files must exactly match the selected DuckDB-Wasm bundle and version.
When no URL is configured for the selected bundle, `ensureSpatial()` fails
instead of silently falling back to the remote install. `spatialExtensionUrls`
and `customExtensionRepository` are mutually exclusive; runtime creation fails
when both are provided.

Close a runtime that will not be reused:

```ts
await duckdb.closeDuckDbRuntime();
```

## Dataset helpers

The first argument is a `MapshaperDataset`; the second is operation options:

```ts
const dataset = source.getDataset();
if (!dataset) throw new Error('Source has no dataset');

const buffered = await duckdb.bufferDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  distance: 25,
  outputLayer: 'parcels_buffer',
});
```

`queryDatasetWithDuckDb({ runtime, source, sql })` is not the current signature.
Configure the runtime globally and pass the dataset separately.

## Geometry and attribute helpers

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

const withArea = await duckdb.areaDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  outputColumn: 'area_m2',
});
```

Geometry helpers include centroid, envelope, convex hull, boundary, simplify,
simplify-preserve-topology, and make-valid. Attribute helpers preserve geometry
and append scalar columns.

## Relations and overlay

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

Overlay unions mask geometry and preserves input attributes only. Input and
mask must already use the same CRS.

DuckDB evaluates every relation as `ST_Function(inputGeometry, maskGeometry)`.
`covers` means the input covers a mask feature; `coveredBy` means the input is
covered by a mask feature; `containsProperly` means the input properly contains
a mask feature. All six predicates are topological and allow geographic CRS.

| Operation id | DuckDB function | Filter helper | Attribute helper | Default output column |
| --- | --- | --- | --- | --- |
| `overlaps` | `ST_Overlaps` | `overlapsDatasetWithDuckDb` | `overlapsAttributeDatasetWithDuckDb` | `duckdb_overlaps` |
| `equals` | `ST_Equals` | `equalsDatasetWithDuckDb` | `equalsAttributeDatasetWithDuckDb` | `duckdb_equals` |
| `crosses` | `ST_Crosses` | `crossesDatasetWithDuckDb` | `crossesAttributeDatasetWithDuckDb` | `duckdb_crosses` |
| `covers` | `ST_Covers` | `coversDatasetWithDuckDb` | `coversAttributeDatasetWithDuckDb` | `duckdb_covers` |
| `coveredBy` | `ST_CoveredBy` | `coveredByDatasetWithDuckDb` | `coveredByAttributeDatasetWithDuckDb` | `duckdb_covered_by` |
| `containsProperly` | `ST_ContainsProperly` | `containsProperlyDatasetWithDuckDb` | `containsProperlyAttributeDatasetWithDuckDb` | `duckdb_contains_properly` |

## Spatial aggregate joins

`spatialAggregateJoinDatasetWithDuckDb(targetDataset, joinDataset, options)` appends
statistics from spatially matched join features without changing the target features.
Use it to count POIs or summarize sales and scores by administrative area; it does not
copy raw join fields or construct output geometry.

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

`targetLayer` and `joinLayer` select a layer from each dataset; omit either one to use
that dataset's first layer. The result contains only the selected target layer and
preserves its geometry, shapes, shared arcs, topology, attributes, CRS, info, and target
order. Neither input dataset is mutated.

`predicate` supports `intersects`, `contains`, `within`, `touches`, `overlaps`, `equals`,
`crosses`, `covers`, `coveredBy`, and `containsProperly`. Direction is always target
first and join second: `contains` means the target contains the join feature, while
`within` means the target is within it; `covers` means the target covers the join feature,
while `coveredBy` means the target is covered by it.

`joinType` defaults to `left`, which emits one row for every target feature; `inner` keeps
only targets with at least one matched join feature. Both preserve target-relative order.
Null target geometry is unmatched, so it remains only in `left`; null join geometry is
ignored.

Each `aggregations` entry uses `count`, `sum`, `avg`, `min`, or `max`. `count` accepts no
`field`; every other operation requires an existing, non-empty join field. `sum` and
`avg` require numeric fields, and `min` and `max` require DuckDB-orderable scalar fields.
Non-count aggregates ignore null field values and produce null when every value in a
matched group is null. In `left` mode an unmatched target receives `0` for count and
`null` for every other aggregate.

`outputColumn` is trimmed first, then must be non-empty, unique within the request, and
absent from target attributes and the target geometry column. A collision is an error;
the helper never suffixes a name or overwrites target data.

The map operation is `duckDbSpatialAggregateJoinLayer(ctx, options)`: it reads the target
source from `src`, the aggregate source from `join`, and writes to `output.sourceId`.
Although `output` is optional in its type, runtime validation requires a non-empty
`output.sourceId`:

```ts
await duckDbSpatialAggregateJoinLayer(ctx, {
  src: 'zones',
  join: 'points',
  predicate: 'contains',
  aggregations: [{ operation: 'count', outputColumn: 'poi_count' }],
  output: { sourceId: 'zone_statistics' },
});
```

This helper does not support `disjoint`, distance or nearest queries, arbitrary SQL,
direct GeoParquet input, raw join-field copying, or output-geometry construction. See the
[runnable spatial aggregate join example](/mapseekai/emap/examples/duckdb-spatial-aggregate-join/).

## Restricted SELECT

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

The selected layer is registered as logical table `input`. The validator
supports scalar projection, simple `WHERE`, `ORDER BY`, and integer `LIMIT`.
It rejects multiple statements, mutation, joins, other tables, and calculated
output geometry before execution.

Use `validateDuckDbSelectSql` to preflight the same contract.

## Query GeoParquet bytes

```ts
const result = await duckdb.queryGeoParquetWithDuckDb(bytes, {
  layerName: 'active_points',
  sql: 'SELECT geometry, name FROM input WHERE active = true',
});
```

The projection must retain a detectable geometry column. Do not call
`read_parquet(...)` directly; the helper registers bytes and exposes `input`.

## Add results to a map

Helpers return datasets and do not implicitly replace a source:

```ts
const output = new TopologySource('buffered');
output.setDataset(buffered);

await map.addSource('buffered', output);
map.setExtent(output.getExtent());
```

Choose explicitly between a new source and replacing an existing one. Dataset
helpers alone do not create map history; use the Emap adapter/operation surface
when history is required.

## CRS and errors

Area, length, perimeter, distance, and buffer use dataset units. Distance-like
helpers reject geographic CRS by default. Set `failOnGeographicCrs: false` only
when degree-based behavior is intentional.

```ts
try {
  await duckdb.queryDatasetWithDuckDb(dataset, options);
} catch (error) {
  if (error instanceof duckdb.DuckDbOperationError) {
    console.error(error.kind, error.message);
  }
}
```

`DuckDbOperationError.kind` distinguishes runtime, SQL validation, spatial
extension, and execution failures.

## API

- [queryDatasetWithDuckDb](/mapseekai/emap/api/functions/duckdb.queryDatasetWithDuckDb.html)
- [bufferDatasetWithDuckDb](/mapseekai/emap/api/functions/duckdb.bufferDatasetWithDuckDb.html)
- [createDuckDbRuntimeFromJsDelivr](/mapseekai/emap/api/functions/duckdb.createDuckDbRuntimeFromJsDelivr.html)
- [DuckDbOperationError](/mapseekai/emap/api/classes/duckdb.DuckDbOperationError.html)

## Runnable examples

- [DuckDB query](/mapseekai/emap/examples/duckdb-query/)
- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)
- [Overlay](/mapseekai/emap/examples/duckdb-overlay/)
- [GeoParquet query](/mapseekai/emap/examples/duckdb-geoparquet-query/)

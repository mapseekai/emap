# DuckDB Spatial Aggregate Join Design

**Date:** 2026-08-11

**Status:** Approved in conversation

**Branch dependency:** This feature is stacked on
`feature/duckdb-additional-relation-predicates` at
`b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c`. Before final publication, rebase
onto `master` after the predicate branch lands, or keep the pull request base
set to that predicate branch.

## Context

The optional `@mapseekai/emap/duckdb` entry already provides unary geometry
operations, scalar attribute calculations, binary relation filters and boolean
attributes, distance operations, overlays, and guarded SELECT queries. The
relation pipeline answers whether a target feature matches at least one mask
feature, but it cannot summarize the matching records. There is no typed API
for questions such as:

- How many points fall inside each administrative area?
- What are the sum and average sales for the points inside each district?
- What are the minimum and maximum observed values among features touching a
  target feature?

The existing generic query API can express these questions with caller-written
SQL, but that bypasses the stable layer, CRS, field-validation, output-schema,
and error contracts expected from a first-class emap operation.

DuckDB Spatial has a dedicated spatial join operator for supported joins whose
condition is a single spatial predicate. The new capability should preserve
that query shape, aggregate inside DuckDB-Wasm, and return only one enriched
record per selected target feature.

## Goals

- Add a typed, target-preserving spatial aggregate join for two in-memory emap
  datasets and selected layers.
- Support the ten join-appropriate topological predicates already exposed by
  the stacked predicate branch:
  - `intersects`
  - `contains`
  - `within`
  - `touches`
  - `overlaps`
  - `equals`
  - `crosses`
  - `covers`
  - `coveredBy`
  - `containsProperly`
- Support any non-empty list of structured `count`, `sum`, `avg`, `min`, and
  `max` aggregations in one operation.
- Make predicate direction explicit as `predicate(target, join)`.
- Support `left` and `inner` result modes, with `left` as the default.
- Preserve the selected target layer's feature order, shapes, shared arcs,
  topology, attributes, and CRS; only aggregate columns and the optional
  output layer name change.
- Provide dataset-level and map-operation entry points through the DuckDB
  package barrel.
- Verify real DuckDB-Wasm results and confirm with `EXPLAIN` that supported
  fixture queries use `SPATIAL_JOIN`.
- Document the API in Chinese and English and provide a runnable administrative
  area statistics example.

## Non-goals

- No `disjoint` aggregate join. Pairwise disjoint matches commonly approach a
  Cartesian product and cannot use the intersection-based spatial join
  strategy. A target with no intersections is represented by
  `predicate: 'intersects'`, `joinType: 'left'`, and a match count of zero.
- No `distanceWithin`, nearest-neighbor, top-K, or shortest-line join.
- No direct GeoParquet, remote URL, arbitrary DuckDB relation, or caller SQL
  input. Both inputs are loaded emap datasets in this version.
- No arbitrary aggregate expression, user-provided DuckDB function name, or
  raw SQL fragment.
- No direct copying of unaggregated join fields.
- No overlay, dissolve, union, or output geometry construction.
- No UI panel or command-language integration.
- No manual R-tree index management or general spatial performance framework.

## Approaches Considered

### Add a dedicated spatial aggregate join operation family (selected)

Create a separate dataset operation and map-operation wrapper while reusing
the existing DuckDB runtime, Arrow conversion, CRS alignment, error model, and
source integration. This gives the new output-cardinality and aggregation
rules a focused type and SQL contract without changing existing relation
behavior. It also leaves a clear extension point for a later GeoParquet input
adapter or nearest-neighbor operation.

### Extend the existing relation pipeline with an aggregate mode

Adding `aggregate` to the relation operation's current `filter | attribute`
mode would reuse more orchestration code, but it would combine boolean,
distance, multi-column aggregation, output-schema, and target-reconstruction
semantics in one discriminated union. The resulting branches would make the
existing relation API harder to reason about and test.

### Wrap the generic DuckDB query operation

Generating or accepting a caller SELECT around `queryDatasetWithDuckDb` would
reduce initial code, but the query API is intentionally centered on validated
caller SQL and a single input table. It does not provide a typed two-layer join
contract, aggregation field validation, predicate direction, or a predictable
result schema.

## Public API

The DuckDB entry exports the following types:

```ts
export type DuckDbSpatialAggregateJoinPredicate =
  | 'intersects'
  | 'contains'
  | 'within'
  | 'touches'
  | 'overlaps'
  | 'equals'
  | 'crosses'
  | 'covers'
  | 'coveredBy'
  | 'containsProperly';

export type DuckDbSpatialAggregateJoinType = 'left' | 'inner';

export type DuckDbSpatialAggregateOperation =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max';

export type DuckDbSpatialAggregation =
  | {
      operation: 'count';
      outputColumn: string;
      field?: never;
    }
  | {
      operation: Exclude<DuckDbSpatialAggregateOperation, 'count'>;
      field: string;
      outputColumn: string;
    };

export interface DuckDbSpatialAggregateJoinOptions {
  predicate: DuckDbSpatialAggregateJoinPredicate;
  aggregations: readonly DuckDbSpatialAggregation[];
  joinType?: DuckDbSpatialAggregateJoinType;
  targetLayer?: string | number;
  joinLayer?: string | number;
  targetGeometryColumn?: string;
  joinGeometryColumn?: string;
  outputLayer?: string;
}
```

The dataset helper is:

```ts
export function spatialAggregateJoinDatasetWithDuckDb(
  targetDataset: MapshaperDataset,
  joinDataset: MapshaperDataset,
  opts: DuckDbSpatialAggregateJoinOptions,
  runtime?: DuckDbRuntime | null,
): Promise<MapshaperDataset>;
```

The map-operation wrapper is:

```ts
export interface DuckDbSpatialAggregateJoinLayerOptions
  extends DuckDbSpatialAggregateJoinOptions {
  src: string;
  join: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export type DuckDbSpatialAggregateJoinLayerResult = OpResult<{
  sourceId: string;
  dataset: MapshaperDataset;
}>;

export function duckDbSpatialAggregateJoinLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbSpatialAggregateJoinLayerOptions,
): Promise<DuckDbSpatialAggregateJoinLayerResult>;
```

Example:

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

`predicate` is required so directional operations are never selected by an
implicit default. `joinType` defaults to `left`. Every `outputColumn` is
required so the output schema is explicit and stable.

## Predicate Direction

The target geometry is always the first DuckDB argument and the join geometry
is always the second:

```sql
ST_Function(target_geometry, join_geometry)
```

This ordering is observable for directional predicates:

- `contains` means the target contains the join feature.
- `within` means the target is within the join feature.
- `covers` means the target covers the join feature.
- `coveredBy` means the target is covered by the join feature.
- `containsProperly` means the target properly contains the join feature.

The names `target` and `join` must be used consistently in types,
documentation, errors, and examples; this operation does not reuse the
relation API's `input` and `mask` terminology.

## Aggregation and Output Semantics

`count` counts matched join rows and does not accept a field. Multiple matches
from the same join layer are counted independently. `sum`, `avg`, `min`, and
`max` require a field from the selected join layer. Join fields are not copied
to the result except through a requested aggregate.

DuckDB null semantics apply to aggregate fields:

- `sum`, `avg`, `min`, and `max` ignore null field values.
- If every matched value for an aggregate is null, its result is null.
- A target with no matches receives zero for every requested `count` and null
  for every other aggregate in `left` mode.

The result dataset contains one layer: the selected target layer with its
original attributes, followed by aggregate columns in the order given by
`aggregations`. Other layers from the target dataset are not copied, matching
the existing selected-layer DuckDB operation convention.
`outputColumn` values are trimmed before use. The resulting names must be
non-empty, unique within the request, and absent from the target attribute and
geometry column names. A collision is a validation error; names are never
silently suffixed or allowed to overwrite target data. Aggregate `field`
values must be non-empty after trimming but are matched to join attributes by
their exact supplied names so quoted identifiers remain usable.

`left` mode emits every target feature. `inner` mode emits only target features
with at least one matched join row. Both modes retain target-relative order.
An empty target produces an empty result. An empty join produces every target
with zero/null aggregate values in `left` mode and an empty result in `inner`
mode.

Null target geometries are treated as unmatched: `left` preserves them with
zero/null aggregate values and `inner` removes them. Null join geometries do
not participate in matching.

## Architecture and Data Flow

The implementation adds a focused
`src/duckdb/duckdb-spatial-aggregate-join-op.ts` module. It owns the public
types, validation, dataset helper, target row-id handling, DuckDB lifecycle,
and target-preserving output reconstruction. A pure
`buildSpatialAggregateJoinSql` builder is added to `src/duckdb/duckdb-sql.ts`.
`src/duckdb/map-op.ts` adds the source-level wrapper and result types, and
`src/duckdb/index.ts` exports the new surface.

The existing relation operation files and their filter/attribute semantics are
not modified to implement this feature.

The data flow is:

```text
target dataset + join dataset
  -> resolve selected layers
  -> align the join dataset CRS to the target dataset CRS
  -> add a collision-free internal row id to target records
  -> convert the selected layers to WKB Arrow tables
  -> load DuckDB Spatial and insert both temporary tables
  -> run one spatial inner join and group by target row id
  -> read aggregate rows keyed by target row id
  -> merge aggregates into original target records according to joinType
  -> reuse target shapes, arcs, topology, feature order, and CRS
  -> drop temporary tables and close the connection
```

The target row id is internal and cannot leak into the output. Its name is
made unique against all target attribute names, the target geometry name, and
every requested aggregate output name. The SQL result contains the row id and
aggregate columns only; target geometry is not returned from DuckDB and is not
reconstructed from WKB. The output follows the existing query operation's
target-preserving pattern and the existing Arrow record conversion for DuckDB
scalar values. Both input datasets remain unchanged; the operation returns a
new one-layer dataset and a new target attribute table.

## SQL Shape and Spatial Join Optimization

The builder produces a query equivalent to:

```sql
WITH target_valid AS (
  SELECT *
  FROM target_table
  WHERE target_geometry IS NOT NULL
),
join_valid AS (
  SELECT *
  FROM join_table
  WHERE join_geometry IS NOT NULL
)
SELECT
  t.__emap_rowid,
  COUNT(*) AS poi_count,
  SUM(j.sales) AS sales_total,
  AVG(j.score) AS score_avg
FROM target_valid AS t
INNER JOIN join_valid AS j
  ON ST_Contains(t.geometry, j.geometry)
GROUP BY t.__emap_rowid
ORDER BY t.__emap_rowid;
```

The exact implementation quotes every identifier. Null-geometry filters live
in input CTEs rather than the `ON` clause. The `ON` clause contains exactly one
registered spatial predicate and no additional comparison, arithmetic, or
function condition. The aggregation query is always an inner join; JavaScript
reconstruction applies `left` or `inner` output semantics from the presence of
an aggregate row. This preserves a single optimized query shape for both API
join types.

Production execution does not run `EXPLAIN`. A DuckDB-Wasm integration test
runs `EXPLAIN` on representative generated SQL and requires `SPATIAL_JOIN` in
the physical plan. If the pinned DuckDB-Wasm runtime cannot produce that plan,
the test must fail and trigger an explicit runtime-version or query-shape
decision rather than silently accepting a slower cross product.

## Validation and SQL Safety

Validation occurs before opening a DuckDB connection where possible:

- Both selected layers must exist and be convertible through the existing WKB
  Arrow geometry path.
- `aggregations` must contain at least one item.
- `count` rejects a `field`; all other operations require a non-empty field.
- Every aggregate field must exist in the selected join layer.
- `sum` and `avg` require numeric Arrow field types.
- `min` and `max` require DuckDB-orderable scalar Arrow field types; geometry,
  list, struct, map, and other nested values are rejected.
- Aggregate operations, predicates, and join types must be registered enum
  values at runtime, even when JavaScript bypasses TypeScript.
- Output column requirements and collisions follow the rules above.

The SQL builder accepts only validated structured options. Predicate and
aggregate enums map through fixed registries to DuckDB function names and SQL
keywords. Table and column identifiers are quoted with the existing identifier
quoting convention. No caller value becomes a raw SQL function name,
expression, clause, or statement.

## CRS and Geometry Preservation

The join dataset is aligned to the target dataset with the existing
`alignSecondaryDatasetCrs` contract before Arrow conversion. These predicates
do not interpret coordinate values as linear units, so geographic CRS inputs
are allowed. A CRS that cannot be resolved or aligned fails through the
existing validation/conversion error path.

The returned dataset inherits the target dataset CRS and info. Geometry is
never computed by this operation. Reusing the selected target layer's shapes
and the target dataset's arcs ensures shared-arc topology, null shapes, and
coordinate values remain unchanged.

## Error Handling and Cleanup

The operation uses the existing `DuckDbOperationError` kinds:

- Invalid options, selectors, fields, field types, or output schema:
  `validation`.
- Missing runtime: `runtime-unavailable`.
- Spatial extension load failure: `spatial-extension-unavailable`.
- Arrow input or aggregate-result conversion failure: `conversion-failed`.
- DuckDB execution or cleanup failure: `query-failed`.

Errors preserve their original cause. Two collision-free temporary table names
are allocated per call. Both tables are dropped and the connection is closed
in `finally`, following the existing DuckDB operation pattern. A cleanup error
is surfaced only when no earlier operation error is already being propagated.
There is no fallback to mapshaper, JavaScript geometry predicates, or caller
SQL.

The map-operation wrapper maps `DuckDbOperationError` through the existing
`duckDbErrorToOpResult` behavior. It reads `src` as the target source and
`join` as the aggregate source. Although `output` remains optional in the
interface for consistency with existing DuckDB map-operation types, runtime
validation requires a non-empty `output.sourceId` and writes the resulting
dataset to that source.

## Operation Effect Classification

This design adds a standalone DuckDB map-operation helper, not a new Emap
command-language operation, so it does not add a `COMMAND_EFFECTS` entry in
`src/map/ops/_runner.ts`. If the feature is later wired into that runner, it
must be classified as `shape-count`: `inner` may remove target features even
though `left` changes attributes only.

## Testing Strategy

Implementation follows red-green-refactor. Each production behavior starts
with a focused failing test.

### SQL builder tests

- Assert all ten predicates map to the correct fixed `ST_*` function and use
  target geometry as the first argument.
- Assert one query can contain ordered `count`, `sum`, `avg`, `min`, and `max`
  outputs.
- Assert table, geometry, aggregate-field, row-id, and output identifiers are
  quoted correctly, including embedded quotes and SQL-looking names.
- Assert null-geometry filters occur in input CTEs and the `ON` clause contains
  exactly one spatial predicate.
- Assert `GROUP BY` and `ORDER BY` use only the internal target row id.
- Assert rejected predicate, operation, and raw identifier/function injection
  paths cannot reach generated SQL.

### Dataset operation unit tests

- Use a fake runtime to assert spatial loading, two Arrow table inserts, query
  dispatch, table cleanup, and connection closure.
- Assert all ten predicates reach their correct SQL mapping.
- Assert multi-aggregation output order and values.
- Assert `left` preserves all target records, including null shapes, and fills
  zero/null defaults for unmatched targets.
- Assert `inner` keeps only matched row ids in target-relative order.
- Assert original target shapes, arcs, topology, CRS, info, and attributes are
  preserved and the internal row id is absent.
- Assert target and join layer selectors use the requested layers.
- Assert every validation and error-classification rule, including cleanup
  precedence.

### DuckDB-Wasm integration tests

- Execute every supported predicate against fixtures with discriminating
  positive and negative cases.
- Cover directional behavior for `contains`, `within`, `covers`, `coveredBy`,
  and `containsProperly`.
- Use one target with multiple matched join records and assert
  `count/sum/avg/min/max` together.
- Cover null aggregate values, all-null aggregate groups, null geometry, empty
  inputs, zero matches, `left`, and `inner`.
- Run `EXPLAIN` against representative generated SQL and assert the plan
  contains `SPATIAL_JOIN`.
- Add the new integration test file to the root `test:duckdb` script's explicit
  file list so prepublish verification cannot omit it.

### Map operation, exports, docs, and example tests

- Assert `src` and `join` source lookup, missing-source errors, output source
  selection, success writes, and DuckDB error mapping.
- Assert the new function and public types are exported from
  `@mapseekai/emap/duckdb` and remain excluded from the core bundle as
  appropriate for the existing optional entry.
- Add a runnable example with polygon administrative areas and point records,
  displaying match count and sales sum/average output.
- Update Chinese and English DuckDB guides with the API, supported predicate
  list, direction, null rules, example, and explicit non-goals.
- Regenerate TypeDoc output with the repository command; generated files are
  not edited manually.

## Verification

Completion requires fresh successful runs of:

1. Focused SQL builder, dataset operation, map-operation, export, and example
   tests.
2. The complete DuckDB-Wasm integration suite, including the `EXPLAIN` plan
   assertion.
3. TypeScript type checking and formatting checks.
4. Production build.
5. The full Vitest suite.
6. Documentation, i18n, runnable-example, and generated API checks required by
   the repository.
7. GitNexus
   `detect_changes({ scope: 'compare', base_ref: 'feature/duckdb-additional-relation-predicates' })`
   before each implementation commit or final commit review, with no
   unexpected affected flow. The final shell diff is also checked against the
   exact stack-base commit
   `b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c`.

The three documentation catalog failures already tracked by MAP-155
(`ArrowDotPathOptions`, `LineDashStyle`, and `VisibleLayerLookup`) may be
recorded only if they reproduce against the exact stack base. Any additional
documentation failure blocks completion. No generated API file may contain a
linked-worktree path.

## Success Criteria

- A caller can enrich a selected target layer with any ordered combination of
  `count`, `sum`, `avg`, `min`, and `max` values from spatially matched features
  in a selected join layer.
- All ten supported predicates have explicit target-first semantics through
  both dataset and map-operation APIs.
- `left` and `inner` results, null behavior, field validation, and output
  schema follow this document exactly.
- Target geometry, shared topology, CRS, attributes, feature order, and null
  shapes are unchanged except for the documented inner filtering and aggregate
  columns.
- Generated SQL contains one safe spatial join predicate and the installed
  DuckDB-Wasm runtime demonstrates a `SPATIAL_JOIN` plan.
- Temporary DuckDB resources are cleaned up on success and failure.
- The public API, runnable example, Chinese and English guides, and generated
  API documentation are synchronized.
- Existing DuckDB relation, overlay, query, and geometry operations retain
  their behavior and pass regression tests.

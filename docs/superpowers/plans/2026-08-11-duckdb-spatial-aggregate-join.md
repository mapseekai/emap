# DuckDB Spatial Aggregate Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a typed DuckDB-Wasm spatial aggregate join that enriches a selected target layer with ordered count, sum, average, minimum, and maximum values from spatially matched join features.

**Architecture:** Add a dedicated operation family rather than extending relation filters. A closed SQL builder emits one target-first spatial INNER JOIN grouped by a collision-free target row id; a dataset operation validates both selected layers, aligns CRS, runs DuckDB Spatial, and reconstructs left or inner output from the original target geometry and attributes. A thin map-operation wrapper, optional DuckDB barrel export, real DuckDB-Wasm tests, a runnable two-input example, and bilingual generated documentation complete the surface.

**Tech Stack:** TypeScript, Vitest, Apache Arrow 21.1, DuckDB-Wasm 1.33.1-dev57.0, DuckDB Spatial, Rollup, Vite, TypeDoc, Docusaurus.

## Global Constraints

- Work only in /Users/zhang/code/emap/.worktrees/duckdb-spatial-aggregate-join on branch feature/duckdb-spatial-aggregate-join.
- The stack base is feature/duckdb-additional-relation-predicates at b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c. Keep the pull request based on that branch until it lands, or rebase afterward.
- The public dataset helper is spatialAggregateJoinDatasetWithDuckDb(targetDataset, joinDataset, opts, runtime?).
- The public map-operation helper is duckDbSpatialAggregateJoinLayer(ctx, opts).
- Use target and join terminology everywhere. The DuckDB predicate order is always predicate(targetGeometry, joinGeometry).
- Supported predicates are exactly intersects, contains, within, touches, overlaps, equals, crosses, covers, coveredBy, and containsProperly.
- Supported aggregate operations are exactly count, sum, avg, min, and max. No caller string may become a raw SQL function, expression, condition, or clause.
- Supported result modes are left and inner; left is the default. SQL always uses INNER JOIN and JavaScript reconstruction applies the result mode.
- Preserve selected target order, attributes, shapes, shared arcs, topology, CRS, and info. Return one selected target layer only. Never mutate either input dataset.
- A left result uses 0 for unmatched counts and null for unmatched non-count aggregates. Inner output contains only target row ids returned by DuckDB, in target-relative order.
- Null target geometry is unmatched; null join geometry is ignored. The SQL ON clause contains exactly one registered spatial predicate.
- Every outputColumn is trimmed, non-empty, unique, and absent from all selected target attribute names and the target geometry column. Never suffix an aggregate output name.
- A count aggregation rejects field. Other operations require a non-empty exact join field name. sum and avg accept Arrow numeric scalars; min and max accept only supported orderable Arrow scalars.
- The internal row-id name is collision-free against target attributes, target geometry, and requested output names, and never appears in output.
- Do not add disjoint, distanceWithin, nearest-neighbor, GeoParquet direct input, arbitrary SQL, raw join-field copying, overlay geometry, UI panels, R-tree management, or a fallback implementation.
- Do not modify src/duckdb/duckdb-relation-op.ts, src/duckdb/duckdb-relation-ops.ts, or src/map/ops/_runner.ts. If this helper is later added to the command runner, classify it as shape-count.
- The browser-only production path must not import Node.js APIs. Node-only imports remain confined to integration tests.
- Before editing any existing function, class, method, type, constant, or registry, run GitNexus upstream impact analysis for that symbol and report direct callers, affected processes, and risk. Stop and warn if risk is HIGH or CRITICAL.
- Refresh GitNexus from this linked worktree before implementation. After
  list_repos confirms registration, query, context, and impact calls use
  repo: '/Users/zhang/code/emap/.worktrees/duckdb-spatial-aggregate-join'.
  detect_changes calls use
  worktree: '/Users/zhang/code/emap/.worktrees/duckdb-spatial-aggregate-join'
  and the registered repo when its schema permits. The root repository index is
  behind this stacked branch.
- Before every commit, stage the intended files first, then run GitNexus
  detect_changes with scope: 'staged' and the explicit worktree, then run
  rtk git diff --cached --check. Before final handoff, compare GitNexus against
  feature/duckdb-additional-relation-predicates.
- Follow red-green-refactor for every behavior change: add focused tests, observe the intended failure, implement only that contract, and rerun the focused tests.
- Prefix every repository shell command with rtk. In this worktree invoke pnpm as
  rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm because the bare
  Corepack path has already reproduced an EPERM failure.
- Build the root DuckDB bundle before tests that inspect dist/emap-duckdb.mjs.
- Generate packages/docs/static/api/** with the repository TypeDoc command. Never hand-edit generated API files.
- The only accepted docs:check-api baseline exceptions are MAP-155 reflections ArrowDotPathOptions, LineDashStyle, and VisibleLayerLookup, and only when reproduced at the exact stack base. Any other documentation failure blocks completion.
- Track implementation in the existing emap Multica issue MAP-160. Post a
  progress comment after every task commit and move it to in_review only after
  Task 7 succeeds. Use /opt/homebrew/bin/multica through rtk; do not create a
  duplicate issue.

---

## File Map

| File | Responsibility in this change |
| --- | --- |
| src/duckdb/duckdb-sql.ts | Add the closed spatial aggregate SQL vocabulary and pure grouped-join builder. |
| src/duckdb/duckdb-spatial-aggregate-join-op.ts | Own public types, runtime validation, selected-layer conversion, DuckDB lifecycle, and target-preserving reconstruction. |
| src/duckdb/duckdb-spatial-aggregate-join-op.test.ts | Cover SQL safety, validation, lifecycle, reconstruction, selectors, nulls, and failures with a fake runtime. |
| src/duckdb/map-op.ts | Add the two-source map-operation wrapper and result types. |
| src/duckdb/map-op.test.ts | Verify source lookup, option forwarding, output writes, and error mapping. |
| src/duckdb/index.ts | Export the new optional DuckDB operation module. |
| src/duckdb/duckdb-spatial-aggregate-join.integration.test.ts | Execute all predicates and aggregate semantics in real DuckDB-Wasm and assert SPATIAL_JOIN. |
| package.json | Include the new integration test in test:duckdb. |
| packages/examples/examples/duckdb-spatial-aggregate-join/index.html | Provide a runnable administrative-area and point-sales aggregate example. |
| packages/examples/public/fixtures/duckdb-spatial-aggregate-points.geojson | Supply deterministic point sales and score records for the example. |
| docs-meta/examples.ts | Register localized catalog metadata and the two fixtures. |
| packages/examples/vite.config.ts | Register the example route. |
| packages/examples/src/fixture-manifest.ts | Bind target and join fixtures to separate upload controls. |
| test/docs/example-catalog.test.ts | Pin the new catalog id and fixture association. |
| test/docs/example-runtime.test.ts | Verify two-input fixture injection. |
| test/examples/duckdb-new-features.test.ts | Verify imports, API entrypoints, options, and rendering flow. |
| packages/docs/docs/data/duckdb.md | Document the API, semantics, and example in Chinese. |
| packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/duckdb.md | Keep the English guide and API catalog synchronized. |
| packages/docs/docs/data/operations.md | Add the example to the Chinese operations guide's reverse example catalog. |
| packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/operations.md | Keep the English operations example catalog synchronized. |
| packages/docs/static/api/** | TypeDoc-generated API output; regenerate mechanically. |

## Task 0: Refresh Code Intelligence for the Feature Worktree

**Files:**

- Analyze only; no tracked file changes.

- [ ] **Step 1: Refresh the linked-worktree GitNexus index**

Run from /Users/zhang/code/emap/.worktrees/duckdb-spatial-aggregate-join:

~~~bash
rtk node /Users/zhang/code/emap/.gitnexus/run.cjs analyze
~~~

Expected: the emap index records the current feature HEAD. If the command
reports a stale or unavailable runner, resolve that before any production edit
rather than falling back to structural text search.

- [ ] **Step 2: Confirm registration and use the correct per-tool locator**

Call list_repos and confirm the linked worktree is registered. In Tasks 1–7 use:

~~~text
query/context/impact:
  repo: '/Users/zhang/code/emap/.worktrees/duckdb-spatial-aggregate-join'

detect_changes:
  worktree: '/Users/zhang/code/emap/.worktrees/duckdb-spatial-aggregate-join'
~~~

Do not pass worktree to context or impact because those schemas do not accept
it. Do not use the stale root index for impact or staged-change decisions.

- [ ] **Step 3: Record the implementation start in Multica**

Run:

~~~bash
rtk proxy /opt/homebrew/bin/multica issue comment add MAP-160 --content "Implementation started from the approved design and detailed worktree plan. GitNexus will be refreshed before the first production edit." --output json
~~~

## Task 1: Build a Closed, Injection-Safe Spatial Aggregate SQL Builder

**Files:**

- Modify: src/duckdb/duckdb-sql.ts
- Create: src/duckdb/duckdb-spatial-aggregate-join-op.test.ts

**Interfaces:**

- Produces: SpatialAggregateJoinDuckDbFunction, SpatialAggregateSqlOperation, BuildSpatialAggregateJoinAggregation, BuildSpatialAggregateJoinSqlOptions, and buildSpatialAggregateJoinSql.
- Consumed later by: spatialAggregateJoinDatasetWithDuckDb and the real EXPLAIN integration test.

- [ ] **Step 1: Inspect the existing SQL-builder context and run impact analysis before touching shared symbols**

Use GitNexus context for quoteIdentifier, assertSafeDuckDbFunction, buildRelationFilterSql, and buildOverlaySql. Adding new exports must not change the behavior of those symbols. If implementation requires changing any one of them, run upstream impact first and record the callers and risk before editing.

- [ ] **Step 2: Add focused RED tests for every fixed mapping and the exact query shape**

Create src/duckdb/duckdb-spatial-aggregate-join-op.test.ts with a buildSpatialAggregateJoinSql describe block. Define this table:

~~~ts
const PREDICATE_FUNCTIONS = [
  'ST_Intersects',
  'ST_Contains',
  'ST_Within',
  'ST_Touches',
  'ST_Overlaps',
  'ST_Equals',
  'ST_Crosses',
  'ST_Covers',
  'ST_CoveredBy',
  'ST_ContainsProperly',
] as const;
~~~

For every case, build SQL with target table target, join table join, row id __emap_rowid, geometry columns target geometry and join geometry, and one count output match_count. Assert:

- target_valid and join_valid CTEs filter their respective quoted geometry
  columns with IS NOT NULL;
- the join is INNER JOIN;
- the ON clause is exactly the selected function with t target geometry first and j join geometry second;
- GROUP BY and ORDER BY contain only t.__emap_rowid;
- COUNT(*) is aliased to match_count;
- no WHERE or AND predicate is added to the ON clause.

Add one mixed aggregate test in request order:

~~~ts
[
  { operation: 'count', outputColumn: 'match count' },
  { operation: 'sum', field: 'sales value', outputColumn: 'sales total' },
  { operation: 'avg', field: 'score', outputColumn: 'score average' },
  { operation: 'min', field: 'sales value', outputColumn: 'sales min' },
  { operation: 'max', field: 'sales value', outputColumn: 'sales max' },
]
~~~

Assert the SELECT expressions appear in that order as COUNT(*), SUM(j."sales value"), AVG(j."score"), MIN(j."sales value"), and MAX(j."sales value").

Add a quoting test using table, geometry, row-id, field, and output names containing spaces and embedded double quotes. Assert doubled quote escaping in every position.

Add runtime-bypass safety tests that cast these invalid values through unknown:

- duckDbFunction: ST_Buffer;
- duckDbFunction: ST_Contains); DROP TABLE target; --;
- operation: median;
- an empty aggregations array.

The builder must throw before returning SQL. Also assert that a field value resembling SQL remains a quoted identifier and cannot add a second statement.

- [ ] **Step 3: Run the new test to verify RED**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run src/duckdb/duckdb-spatial-aggregate-join-op.test.ts --reporter=dot
~~~

Expected: module import or named export failure because buildSpatialAggregateJoinSql does not exist.

- [ ] **Step 4: Add the closed SQL types and registries**

Append these lower-level types to src/duckdb/duckdb-sql.ts:

~~~ts
export type SpatialAggregateJoinDuckDbFunction =
  | 'ST_Intersects'
  | 'ST_Contains'
  | 'ST_Within'
  | 'ST_Touches'
  | 'ST_Overlaps'
  | 'ST_Equals'
  | 'ST_Crosses'
  | 'ST_Covers'
  | 'ST_CoveredBy'
  | 'ST_ContainsProperly';

export type SpatialAggregateSqlOperation = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface BuildSpatialAggregateJoinAggregation {
  operation: SpatialAggregateSqlOperation;
  field?: string;
  outputColumn: string;
}

export interface BuildSpatialAggregateJoinSqlOptions {
  targetTableName: string;
  joinTableName: string;
  targetGeometryColumn: string;
  joinGeometryColumn: string;
  targetRowIdColumn: string;
  duckDbFunction: SpatialAggregateJoinDuckDbFunction;
  aggregations: readonly BuildSpatialAggregateJoinAggregation[];
}
~~~

Use a Set containing all ten exact ST_* names and a Record mapping count, sum, avg, min, and max to COUNT, SUM, AVG, MIN, and MAX. Do not reuse the broad SAFE_DUCKDB_FUNCTION regex as the only guard: syntactically valid but unregistered names such as ST_Buffer must fail.

- [ ] **Step 5: Implement buildSpatialAggregateJoinSql with the approved physical-plan shape**

The generated SQL must be structurally equivalent to:

~~~sql
WITH target_valid AS (
  SELECT *
  FROM "target table"
  WHERE "target geometry" IS NOT NULL
),
join_valid AS (
  SELECT *
  FROM "join table"
  WHERE "join geometry" IS NOT NULL
)
SELECT
  t."__emap_rowid",
  COUNT(*) AS "match_count",
  SUM(j."sales") AS "sales_total"
FROM target_valid AS t
INNER JOIN join_valid AS j
  ON ST_Contains(t."target geometry", j."join geometry")
GROUP BY t."__emap_rowid"
ORDER BY t."__emap_rowid"
~~~

Implementation rules:

- quote every identifier with the existing quoteIdentifier helper;
- validate the exact function and aggregate operation registries at runtime;
- reject an empty aggregation list;
- render count only as COUNT(*);
- require a field for every non-count builder aggregation and reject a field on count;
- keep null filters in the two CTEs;
- emit one and only one expression after ON;
- never interpolate joinType because it is not part of SQL generation.

- [ ] **Step 6: Run focused GREEN checks**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run src/duckdb/duckdb-spatial-aggregate-join-op.test.ts --reporter=dot
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run typecheck
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run format:check
~~~

Expected: all builder tests pass, TypeScript accepts only the closed unions, and formatting reports no diff.

- [ ] **Step 7: Review scope and commit Task 1**

Review and stage only the Task 1 files:

~~~bash
rtk git diff --check
rtk git diff -- src/duckdb/duckdb-sql.ts src/duckdb/duckdb-spatial-aggregate-join-op.test.ts
rtk git add src/duckdb/duckdb-sql.ts src/duckdb/duckdb-spatial-aggregate-join-op.test.ts
~~~

Run GitNexus detect_changes with scope: 'staged' and the explicit feature
worktree. Confirm only the new SQL builder and tests are affected. Then run:

~~~bash
rtk git diff --cached --check
rtk git commit -m "Add DuckDB spatial aggregate join SQL builder"
~~~

Record the completed batch:

~~~bash
rtk proxy /opt/homebrew/bin/multica issue comment add MAP-160 --content "Task 1 complete: committed the closed spatial aggregate SQL vocabulary, exact identifier quoting, fixed predicate/function allowlist, ordered aggregates, and focused builder tests." --output json
~~~

## Task 2: Implement Dataset Validation, DuckDB Lifecycle, and Target-Preserving Reconstruction

**Files:**

- Create: src/duckdb/duckdb-spatial-aggregate-join-op.ts
- Modify: src/duckdb/duckdb-spatial-aggregate-join-op.test.ts

**Interfaces:**

- Produces: DuckDbSpatialAggregateJoinPredicate, DuckDbSpatialAggregateJoinType, DuckDbSpatialAggregateOperation, DuckDbSpatialAggregation, DuckDbSpatialAggregateJoinOptions, and spatialAggregateJoinDatasetWithDuckDb.
- Reuses without modifying: toArrowTable, recordsFromArrowTable,
  alignSecondaryDatasetCrs, getDefaultMapshaperAdapter, DuckDbOperationError,
  getDuckDbRuntime, DuckDbRuntime, and buildSpatialAggregateJoinSql.

- [ ] **Step 1: Inspect reused symbols and lock the no-refactor boundary**

Use GitNexus context for toArrowTable, recordsFromArrowTable,
alignSecondaryDatasetCrs, queryDatasetWithDuckDb, and processOverlayWithDuckDb.
Reproduce the proven target-row-id and cleanup patterns locally in the new
module; do not refactor duckdb-query-op.ts or duckdb-overlay-op.ts as part of
this feature. Do not call inheritPrimaryDatasetCrs: this operation rebuilds
directly from the target and must preserve info.prj, info.wkt1, and other target
metadata byte-for-byte rather than normalizing CRS metadata.

- [ ] **Step 2: Add RED tests for the public type contract and successful lifecycle**

Expand the new test file with compile-time satisfies declarations for the approved public options:

~~~ts
const validOptions = {
  predicate: 'contains',
  joinType: 'left',
  aggregations: [
    { operation: 'count', outputColumn: 'match_count' },
    { operation: 'sum', field: 'sales', outputColumn: 'sales_total' },
  ],
} satisfies DuckDbSpatialAggregateJoinOptions;
~~~

Add a fake DuckDbRuntime and DuckDbConnection patterned after duckdb-overlay-op.test.ts. The fake must record ensureSpatial, connect, two inserts, aggregate query, both DROP TABLE statements, and close.

Use a three-feature target dataset with ids A, B, C, a join dataset with numeric sales and score fields, and a fake result table containing aggregate rows for target row ids 0 and 2. Assert:

- ensureSpatial precedes connect;
- target and join tables have distinct emap_duckdb_spatial_aggregate_target_* and emap_duckdb_spatial_aggregate_join_* names;
- the target Arrow table includes the internal row id;
- the join Arrow table does not include the internal row id;
- the query contains the requested predicate and ordered aggregate expressions;
- both tables are dropped and the connection closes;
- output layer name changes only when outputLayer is supplied;
- target ids and original fields remain first, aggregate properties follow in request order;
- left result records are A, B, C with B defaults of count 0 and non-count null;
- shapes and nested coordinate/path arrays are cloned rather than aliased;
- arcs, geometry_type, layer id, dataset info, and CRS values are preserved;
- neither source dataset gains output columns or the internal row id.

- [ ] **Step 3: Add RED tests for left, inner, null, selector, and collision semantics**

Add focused cases for:

- default joinType behaves as left;
- inner keeps only returned row ids and target-relative order even if DuckDB result rows arrive out of order;
- a null target shape is preserved with defaults in left and removed in inner;
- null join geometry is present in the inserted table but excluded by generated SQL;
- empty target returns an empty selected target layer;
- a truly schema-less zero-row join supports a count-only request and returns
  all target rows with zero in left and no rows in inner;
- a join with typed sales/score attributes but only null geometries produces
  count 0 and null non-count defaults in left and no rows in inner;
- targetLayer and joinLayer select the named or indexed non-default layer;
- targetGeometryColumn and joinGeometryColumn are passed independently;
- empty targetGeometryColumn or joinGeometryColumn falls back to geometry,
  matching toArrowTable's existing opts.geometryColumn || 'geometry'
  normalization;
- an existing __emap_rowid target attribute causes a deterministic suffixed internal name;
- the internal name also avoids the target geometry name and all requested outputs;
- output columns are appended in request order and never overwrite target fields.

For the empty-input cases, still require a non-null DuckDb runtime for API
consistency. A completely schema-less zero-row Mapshaper DataTable retains no
field names or Arrow types, so it supports count only; a non-count request
against it fails exact-field validation. Represent zero valid join candidates
for non-count requests with typed attribute rows whose geometry is null.
Short-circuit before connection only after all applicable validation. Non-empty
inputs follow the normal Arrow and DuckDB path.

- [ ] **Step 4: Add RED tests for every validation rule before connection**

Table-drive runtime-bypass inputs and assert DuckDbOperationError kind validation, the expected field, zero insert/query calls, and no output mutation:

- missing target or join layer, including out-of-range numeric selectors;
- no target or join geometry type on a non-empty layer;
- empty aggregations;
- unknown predicate, joinType, or aggregate operation;
- non-object aggregation entries;
- blank outputColumn after trimming;
- duplicate trimmed output columns;
- output collision with any target attribute or targetGeometryColumn;
- count with field;
- sum, avg, min, or max with a missing or blank field;
- exact join field not found;
- sum or avg on Utf8, Bool, Date, List, Struct, or geometry;
- min or max on List, Struct, Map, geometry, or another nested Arrow type;
- an exact join key named ' sales ' succeeds when field is also ' sales ';
  trimming is used only to reject all-whitespace fields and must not normalize
  a real field name to sales;
- duplicate, missing, out-of-range, fractional, negative, or unsafe-bigint result row ids;
- missing requested aggregate result columns.

Use these exact validation fields:

- predicate and joinType for invalid top-level enums;
- aggregations for a missing/empty array;
- aggregations[i] for a non-object entry;
- aggregations[i].operation, aggregations[i].outputColumn, and
  aggregations[i].field for per-entry failures;
- targetLayer and joinLayer for selector failures;
- targetGeometryColumn and joinGeometryColumn only if a supplied geometry alias
  is otherwise invalid after normalization.

Malformed result rows or missing result columns are conversion-failed and do
not set field.

Numeric Arrow types are Int, Float, and Decimal. Orderable scalar types are Int, Float, Decimal, Utf8, Bool, Date, Time, Timestamp, and Duration. Use Apache Arrow DataType predicates rather than string matching type names.

emap's normal dataset-to-Arrow conversion JSON-encodes object and array
attributes as Utf8, so it cannot naturally produce List, Struct, or Map fields.
For those rejection tests, import the dataset-to-table module namespace and use
vi.spyOn(datasetToTable, 'toArrowTable'). Save the real implementation, return
the real target WKB Table for the target call, return a crafted Apache Arrow
join Table for the join call, and restore the spy after each case. Do not add a
production injection seam or change the production signature. Test the
geometry Binary field directly as another non-orderable rejection case.

- [ ] **Step 5: Add RED tests for error classification and cleanup precedence**

Cover:

- runtime null becomes runtime-unavailable;
- ensureSpatial rejection becomes spatial-extension-unavailable;
- target conversion, join conversion, CRS alignment, or result decoding failure becomes conversion-failed and preserves cause;
- connect, insert, or query rejection becomes query-failed;
- a successful query followed by either DROP or close failure becomes query-failed with cleanup wording;
- when query and cleanup both fail, the primary query-failed error and cause win;
- when the first DROP fails, the second DROP and close are still attempted;
- when both DROP operations fail, the first cleanup error is retained.

- [ ] **Step 6: Run the expanded test file to verify RED**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run src/duckdb/duckdb-spatial-aggregate-join-op.test.ts --reporter=dot
~~~

Expected: imports for the public options and spatialAggregateJoinDatasetWithDuckDb fail because the new module is not implemented.

- [ ] **Step 7: Add the public types and fixed predicate registry**

Create src/duckdb/duckdb-spatial-aggregate-join-op.ts with exactly:

~~~ts
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

export type DuckDbSpatialAggregateOperation = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type DuckDbSpatialAggregation =
  | { operation: 'count'; outputColumn: string; field?: never }
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
~~~

Add a satisfies-checked Record that maps the ten public predicate ids to the ten lower-level ST_* names. Runtime lookups must reject unknown own or inherited keys; do not cast arbitrary strings directly into SQL types.

- [ ] **Step 8: Implement validation and Arrow preparation before opening a connection**

Use small module-private helpers with these responsibilities:

- resolveSelectedLayer(dataset, selector, field, role): return both layer and
  numeric index; use
  resolveLayerInList from src/map/layer-registry.ts for string selectors,
  numeric indexing with explicit bounds checks for number selectors, and the
  first layer when omitted; produce a validation error naming targetLayer or
  joinLayer. Never copy a layers.find lookup.
- collectLayerFieldNames(layer): combine layer.data?.getFields?.() with keys
  from every layer.data?.getRecords?.() record;
- normalizeAggregations(opts, targetFields, targetGeometryColumn): validate and return trimmed output names while preserving exact field names and request order;
- uniqueInternalRowIdName(reserved): start with __emap_rowid and add _1, _2, and so on until collision-free;
- createTargetInputDataset: clone target records into a one-layer dataset and append integer row ids without mutating the input;
- validateAggregationFieldTypes(joinTable, joinGeometryColumn, aggregations): use table.schema.fields and Apache Arrow DataType predicates;
- cloneShape/rebuildShapes: recursively clone selected target shape arrays for retained row ids;
- aggregateRowsByTargetId: decode recordsFromArrowTable, require
  Number.isSafeInteger for every number/bigint-converted row id, check
  0 <= id < target feature count, reject duplicates, and build a Map keyed by
  row id.

Validation order:

1. normalize geometry aliases with opts.targetGeometryColumn || 'geometry' and
   opts.joinGeometryColumn || 'geometry', then validate the options object,
   predicate, joinType, aggregation structure, output names, and layer selectors;
2. require a DuckDb runtime;
3. align join CRS to target CRS;
4. create the row-id target dataset and convert both selected layers with toArrowTable using WKB;
5. validate aggregate field presence and Arrow scalar types;
6. call ensureSpatial;
7. open a connection.

The target working dataset contains one selected layer, so pass layer: 0 to
toArrowTable. After CRS alignment, pass the saved numeric join-layer index, not
the original string selector. This preserves canonical unnamed selectors such
as layer-1, which resolveLayerInList supports but toArrowTable's private string
resolver does not.

For an empty target, still convert and validate a non-empty join table whenever
sum, avg, min, or max is requested; target emptiness must not hide an invalid
join field or type. For an empty join, count-only requests may short-circuit,
but every non-count request fails field validation because no exact typed join
field is available. Preserve zero-row target metadata as far as Mapshaper's
DataTable permits and do not connect only after all applicable validation has
completed.

- [ ] **Step 9: Implement the DuckDB lifecycle and reconstruction**

The exported function signature is:

~~~ts
export async function spatialAggregateJoinDatasetWithDuckDb(
  targetDataset: MapshaperDataset,
  joinDataset: MapshaperDataset,
  opts: DuckDbSpatialAggregateJoinOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset>
~~~

Execution must:

1. allocate target and join table names only for the current call;
2. insert the target Arrow table first and join Arrow table second;
3. call buildSpatialAggregateJoinSql with the normalized aggregations and mapped ST_* function;
4. decode only the internal row id and aggregate result columns;
5. reconstruct output by iterating original target row ids, never result-row order;
6. merge source attributes first and aggregate values second;
7. use 0/null defaults only when no result row exists;
8. retain all target rows for left and only result-map keys for inner;
9. build a new DataTable and one new selected layer;
10. return a spread of targetDataset with one output layer and
    info: targetDataset.info ? { ...targetDataset.info } : undefined; retain the
    original target arcs reference and do not normalize CRS metadata;
11. drop both temporary tables and close in finally.

Wrap failures with the approved DuckDbOperationError kinds and messages containing DuckDB spatial aggregate join. Track primaryError exactly as the existing overlay path does so cleanup never masks a primary failure.

- [ ] **Step 10: Run focused GREEN checks and adjacent regressions**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run src/duckdb/duckdb-spatial-aggregate-join-op.test.ts src/duckdb/duckdb-query-op.test.ts src/duckdb/duckdb-overlay-op.test.ts --reporter=dot
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run typecheck
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run format:check
~~~

Expected: all new lifecycle, validation, reconstruction, and cleanup cases pass; existing query and overlay target-preservation patterns remain green.

- [ ] **Step 11: Review scope and commit Task 2**

Review and stage only the Task 2 files:

~~~bash
rtk git diff --check
rtk git diff -- src/duckdb/duckdb-spatial-aggregate-join-op.ts src/duckdb/duckdb-spatial-aggregate-join-op.test.ts
rtk git add src/duckdb/duckdb-spatial-aggregate-join-op.ts src/duckdb/duckdb-spatial-aggregate-join-op.test.ts
~~~

Run GitNexus detect_changes with scope: 'staged' and the explicit feature
worktree. Confirm the new operation depends only on expected DuckDB, Arrow,
layer-registry, CRS, adapter, and mapshaper-type symbols. Then run:

~~~bash
rtk git diff --cached --check
rtk git commit -m "Add DuckDB spatial aggregate join dataset operation"
~~~

Record the completed batch:

~~~bash
rtk proxy /opt/homebrew/bin/multica issue comment add MAP-160 --content "Task 2 complete: committed dataset validation, CRS alignment, Arrow conversion, target row-id reconstruction, left/inner semantics, input preservation, DuckDB lifecycle, cleanup precedence, and focused tests." --output json
~~~

## Task 3: Expose the Map Operation and Optional DuckDB Barrel

**Files:**

- Modify: src/duckdb/map-op.ts
- Modify: src/duckdb/map-op.test.ts
- Modify: src/duckdb/index.ts
- Modify: src/duckdb/duckdb-spatial-aggregate-join-op.test.ts

**Interfaces:**

- Produces: DuckDbSpatialAggregateJoinLayerOptions, DuckDbSpatialAggregateJoinLayerResult, and duckDbSpatialAggregateJoinLayer.
- Uses existing private map-op helpers readInputDataset, outputSourceId, duckDbErrorToOpResult, and DuckDbLayerSuccess.

- [ ] **Step 1: Run upstream impact before editing shared map-op and barrel symbols**

Run GitNexus upstream impact for DuckDbMapOpContext, DuckDbLayerSuccess, readInputDataset, outputSourceId, duckDbErrorToOpResult, and the src/duckdb/index.ts export surface. Report risk and direct callers. Stop before editing if any result is HIGH or CRITICAL.

- [ ] **Step 2: Add RED map-operation tests**

Import duckDbSpatialAggregateJoinLayer and its option/result types into map-op.test.ts. Add a describe block that verifies:

- src reads the target dataset and join reads the join dataset;
- missing src returns Err.notFound for source;
- missing join returns Err.notFound for source;
- a present join source without a dataset returns validation with field join;
- missing output.sourceId returns the existing validation error;
- a successful fake aggregate query stores the returned dataset under exactly the requested source id;
- targetLayer, joinLayer, predicate, aggregations, joinType, geometry columns, and outputLayer reach the dataset operation;
- a DuckDbOperationError maps to operation duckdb-spatial-aggregate-join with its kind, field, message, and cause;
- failure never writes an output dataset.

Use two sources in FakeContext. For the normal fixture, build the fake result
table with __emap_rowid; the internal name is determined by target-field
collisions and is unrelated to the global temporary-table sequence. Add one
separate collision case whose result table uses the expected suffixed row-id
name.

In duckdb-spatial-aggregate-join-op.test.ts, add a runtime import assertion that the dataset helper is importable from ./index. Type-only imports cannot prove the emitted browser export, so the example bundle test in Task 5 will provide the final runtime check.

- [ ] **Step 3: Run focused tests to verify RED**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run src/duckdb/map-op.test.ts src/duckdb/duckdb-spatial-aggregate-join-op.test.ts --reporter=dot
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run typecheck
~~~

Expected: the map helper, map option/result types, and barrel export are missing.

- [ ] **Step 4: Add the map-operation types and wrapper**

Import spatialAggregateJoinDatasetWithDuckDb and DuckDbSpatialAggregateJoinOptions in map-op.ts. Add:

~~~ts
export interface DuckDbSpatialAggregateJoinLayerOptions
  extends DuckDbSpatialAggregateJoinOptions {
  src: string;
  join: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export type DuckDbSpatialAggregateJoinLayerResult = OpResult<DuckDbLayerSuccess>;
~~~

Implement duckDbSpatialAggregateJoinLayer in the same order as duckDbRelationLayer:

1. read src with the default field;
2. read join with field join;
3. require output.sourceId;
4. call spatialAggregateJoinDatasetWithDuckDb(target.dataset, join.dataset, opts, opts.runtime);
5. await setSourceDataset;
6. return okValue;
7. map errors with operation duckdb-spatial-aggregate-join.

Do not route through runRelationOperation and do not add an operation switch.

- [ ] **Step 5: Export the dataset module**

Add exactly this line to src/duckdb/index.ts beside the other operation exports:

~~~ts
export * from './duckdb-spatial-aggregate-join-op';
~~~

Do not export it from the core src/index.ts entry; DuckDB remains an optional browser bundle.

- [ ] **Step 6: Run GREEN checks and build the optional entry**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run src/duckdb/map-op.test.ts src/duckdb/duckdb-spatial-aggregate-join-op.test.ts --reporter=dot
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run typecheck
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run build
~~~

Expected: map-op tests pass and dist/emap-duckdb.mjs exports both functions at runtime.

- [ ] **Step 7: Review scope and commit Task 3**

Review and stage only the Task 3 files:

~~~bash
rtk git diff --check
rtk git diff -- src/duckdb/map-op.ts src/duckdb/map-op.test.ts src/duckdb/index.ts src/duckdb/duckdb-spatial-aggregate-join-op.test.ts
rtk git add src/duckdb/map-op.ts src/duckdb/map-op.test.ts src/duckdb/index.ts src/duckdb/duckdb-spatial-aggregate-join-op.test.ts
~~~

Run GitNexus detect_changes with scope: 'staged' and the explicit feature
worktree. Confirm no command-runner process is affected. Then run:

~~~bash
rtk git diff --cached --check
rtk git commit -m "Expose DuckDB spatial aggregate join map operation"
~~~

Record the completed batch:

~~~bash
rtk proxy /opt/homebrew/bin/multica issue comment add MAP-160 --content "Task 3 complete: committed the src/join map-operation wrapper, output/error behavior, optional DuckDB barrel exports, bundle build, and map-op tests." --output json
~~~

## Task 4: Prove Semantics and SPATIAL_JOIN with Real DuckDB-Wasm

**Files:**

- Create: src/duckdb/duckdb-spatial-aggregate-join.integration.test.ts
- Modify: package.json

**Interfaces:**

- Executes: spatialAggregateJoinDatasetWithDuckDb and buildSpatialAggregateJoinSql against the pinned blocking DuckDB-Wasm runtime.
- Extends: the explicit root test:duckdb integration-file chain.

- [ ] **Step 1: Inspect the pinned blocking runtime pattern**

Use src/duckdb/duckdb-relation.integration.test.ts as the template for createRequire, blocking bundles, NODE_RUNTIME, Arrow IPC insertion, one shared runtime, spatial extension loading, and afterAll termination. Do not introduce a second DuckDB package or browser production dependency.

- [ ] **Step 2: Add a table-driven real predicate acceptance test**

Create the integration file with the existing DUCKDB_WASM_INTEGRATION === '1' describe gate. Reuse square, line, point, fixtureDataset, and records-style helpers locally.

For every case, create two target features and one join feature, request count as match_count in left mode, and assert counts [1, 0]:

| Predicate | Positive target | Negative target | Join feature |
| --- | --- | --- | --- |
| intersects | square 0,0–10,10 | square 20,20–30,30 | square 5,5–15,15 |
| contains | square 0,0–10,10 | square 20,20–30,30 | point 5,5 |
| within | point 5,5 | point 20,20 | square 0,0–10,10 |
| touches | square 0,0–10,10 | overlapping square 15,0–25,10 | square 10,0–20,10 |
| overlaps | square 0,0–10,10 | containing square 0,0–20,20 | square 5,5–15,15 |
| equals | square 0,0–10,10 | square 5,5–15,15 | square 0,0–10,10 |
| crosses | horizontal line 0,5–10,5 | endpoint-touching line 0,0–5,0 | vertical line 5,0–5,10 |
| covers | square 0,0–10,10 | square 20,20–30,30 | boundary point 0,5 |
| coveredBy | boundary point 0,5 | point 20,20 | square 0,0–10,10 |
| containsProperly | square 0,0–10,10 | square 1,0–9,10 | interior line 1,5–9,5 |

The touches negative still intersects by overlap. The overlaps negative contains
the join polygon. The crosses negative touches at an endpoint. Thus those
negative rows distinguish each predicate from a wider intersecting relation.
The covers and coveredBy boundary cases distinguish them from contains and
within. Both containsProperly targets contain the join line under ordinary
ST_Contains, but the negative target shares both line endpoints with its
boundary and therefore is not a proper containment.

- [ ] **Step 3: Add real multi-aggregate, join-mode, null, and empty-input cases**

Build projected EPSG:3857 fixtures:

- target zones A, B, and C are disjoint polygons in that order;
- A contains two join points with sales 10/20 and score 2/4;
- B contains no point;
- C contains one join point whose sales and score are null;
- add one null-geometry join record and one outside point;
- add a null-geometry target D for a separate left/inner assertion.

In one contains call request:

~~~ts
[
  { operation: 'count', outputColumn: 'match_count' },
  { operation: 'sum', field: 'sales', outputColumn: 'sales_total' },
  { operation: 'avg', field: 'score', outputColumn: 'score_avg' },
  { operation: 'min', field: 'sales', outputColumn: 'sales_min' },
  { operation: 'max', field: 'sales', outputColumn: 'sales_max' },
]
~~~

Assert left records:

- A: 2, 30, 3, 10, 20;
- B: 0, null, null, null, null;
- C: 1, null, null, null, null;
- D: 0, null, null, null, null.

Assert inner returns only A and C in target order. The C row proves count counts matched rows while the other functions ignore null values. Assert output geometry, ids, CRS, and original target attributes remain unchanged.

Add a second call whose join rows retain numeric sales/score fields but every
geometry is null. Assert all target rows receive 0/null defaults in left and
inner returns no rows. This is the non-count zero-valid-candidate case without
pretending a schema-less zero-row DataTable can expose Arrow field types.

Construct explicit zero-row point and polygon datasets with geometry_type, shapes: [], an empty adapter DataTable, and EPSG:3857 info. Use count-only requests to assert:

- empty target gives zero output rows;
- empty join plus left gives all targets with 0;
- empty join plus inner gives zero output rows.

- [ ] **Step 4: Add a physical-plan assertion**

After ensureSpatial, manually:

1. create target and join Arrow tables whose target contains __emap_rowid;
2. insert both into a dedicated blocking connection;
3. call buildSpatialAggregateJoinSql for ST_Contains and count;
4. execute exactly await conn.query('EXPLAIN ' + sql);
5. convert the result with recordsFromArrowTable;
6. join every scalar cell into one plan string;
7. assert the plan matches /SPATIAL_JOIN/i;
8. drop both tables and close in finally.

Do not run EXPLAIN in production code. A missing SPATIAL_JOIN is a test failure requiring an explicit query-shape or pinned-runtime decision.

- [ ] **Step 5: Run the new integration file before changing the package script**

Run:

~~~bash
rtk run 'DUCKDB_WASM_INTEGRATION=1 /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run src/duckdb/duckdb-spatial-aggregate-join.integration.test.ts --reporter=dot'
~~~

Expected: all acceptance cases pass if Tasks 1–3 satisfy the contract. Treat any semantic or plan mismatch as RED and fix the smallest relevant production behavior before continuing; do not weaken fixture discrimination or the SPATIAL_JOIN assertion.

- [ ] **Step 6: Add the file to test:duckdb and prove it cannot be skipped**

Append this command to the existing test:duckdb chain in package.json:

~~~text
DUCKDB_WASM_INTEGRATION=1 vitest run src/duckdb/duckdb-spatial-aggregate-join.integration.test.ts
~~~

Keep every existing integration file in the script. Then run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run test:duckdb
~~~

Expected: buffer, attribute, relation, query, GeoParquet query, overlay, and spatial aggregate join integrations all execute successfully.

- [ ] **Step 7: Review scope and commit Task 4**

Review and stage only the Task 4 files:

~~~bash
rtk git diff --check
rtk git diff -- package.json src/duckdb/duckdb-spatial-aggregate-join.integration.test.ts
rtk git add package.json src/duckdb/duckdb-spatial-aggregate-join.integration.test.ts
~~~

Run GitNexus detect_changes with scope: 'staged' and the explicit feature
worktree. Confirm the only production-adjacent change is the package script and
that the integration test imports no Node API into runtime modules. Then run:

~~~bash
rtk git diff --cached --check
rtk git commit -m "Verify DuckDB spatial aggregate joins in Wasm"
~~~

Record the completed batch:

~~~bash
rtk proxy /opt/homebrew/bin/multica issue comment add MAP-160 --content "Task 4 complete: committed real DuckDB-Wasm coverage for ten predicates, all five aggregates, left/inner/null/empty behavior, SPATIAL_JOIN EXPLAIN, and test:duckdb registration." --output json
~~~

## Task 5: Add the Runnable Administrative-Area Aggregate Example

**Files:**

- Create: packages/examples/examples/duckdb-spatial-aggregate-join/index.html
- Create: packages/examples/public/fixtures/duckdb-spatial-aggregate-points.geojson
- Modify: docs-meta/examples.ts
- Modify: packages/examples/vite.config.ts
- Modify: packages/examples/src/fixture-manifest.ts
- Modify: test/docs/example-catalog.test.ts
- Modify: test/docs/example-runtime.test.ts
- Modify: test/examples/duckdb-new-features.test.ts

**Interfaces:**

- Demonstrates both spatialAggregateJoinDatasetWithDuckDb and duckDbSpatialAggregateJoinLayer.
- Reuses: task-7-mask.geojson as target administrative areas and a new point-sales fixture as the join dataset.

- [ ] **Step 1: Run impact analysis for the existing example registries**

Run GitNexus upstream impact for examples, fixtureManifest, and the Vite routeIds registry before editing them. Report the catalog, build-input, fixture-loading, and docs consumers. Stop if risk is HIGH or CRITICAL.

- [ ] **Step 2: Add RED catalog, fixture-loader, and source-contract tests**

In test/docs/example-catalog.test.ts:

- insert duckdb-spatial-aggregate-join between duckdb-query and duckdb-spatial-ops in expectedIds;
- assert its fixtures equal fixtures/task-7-mask.geojson and fixtures/duckdb-spatial-aggregate-points.geojson.

In test/docs/example-runtime.test.ts, add a case with #target-file and #join-file controls. Call autoLoadExampleFixtures('duckdb-spatial-aggregate-join', document) and assert the controls receive task-7-mask.geojson and duckdb-spatial-aggregate-points.geojson respectively, in separate change events.

In test/examples/duckdb-new-features.test.ts:

- add readExample('duckdb-spatial-aggregate-join') to duckDbExamples and the named examples object;
- assert imports contain spatialAggregateJoinDatasetWithDuckDb and duckDbSpatialAggregateJoinLayer;
- assert the HTML contains predicate: 'contains', both left and inner options, all five aggregate descriptors, targetLayer, joinLayer, src, join, and output.sourceId;
- assert it renders the result dataset and reports match_count, sales_total, score_avg, sales_min, and sales_max;
- keep the generic exported-name test covering this new HTML.

- [ ] **Step 3: Run tests to verify RED**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run build
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run test/docs/example-catalog.test.ts test/docs/example-runtime.test.ts test/examples/duckdb-new-features.test.ts --reporter=dot
~~~

Expected: the catalog id, fixture binding, and example file are missing.

- [ ] **Step 4: Create the deterministic point-sales fixture**

Add a GeoJSON FeatureCollection at packages/examples/public/fixtures/duckdb-spatial-aggregate-points.geojson with these four point features and properties:

| id | Coordinates | sales | score | Expected relation to target polygons |
| --- | --- | ---: | ---: | --- |
| west-only | -122.42, 37.765 | 10 | 2 | inside mask-a only |
| overlap | -122.392, 37.79 | 20 | 4 | inside mask-a and mask-b |
| east-only | -122.36, 37.80 | 30 | 6 | inside mask-b only |
| outside | -122.33, 37.84 | 40 | 8 | inside neither |

For predicate contains, the expected example result is:

- mask-a: count 2, sum 30, avg 3, min 10, max 20;
- mask-b: count 2, sum 50, avg 5, min 20, max 30.

- [ ] **Step 5: Register every hard-coded example surface**

In docs-meta/examples.ts:

- add a duckDbSpatialAggregatePointsFixture constant beside the existing
  task7 fixtures;
- add a unique Chinese and English description;
- add recipe id duckdb-spatial-aggregate-join in the DuckDB group;
- use Chinese title DuckDB 空间聚合连接 and English title DuckDB spatial aggregate join;
- use docs DuckDB and operations references;
- set API to spatialAggregateJoinDatasetWithDuckDb;
- set feature flags duckdb, spatial, join, aggregate, and basemap (the recipe
  helper will also add its category and id tags);
- set fixtures to task7MaskFixture and the new fixture string;
- make the success text state that each target polygon displays count and sales statistics.

In packages/examples/vite.config.ts, add the route id at the same relative position.

In packages/examples/src/fixture-manifest.ts, add a dedicated branch:

~~~ts
if (id === 'duckdb-spatial-aggregate-join') {
  return [
    { selector: '#target-file', paths: filePaths.slice(0, 1) },
    { selector: '#join-file', paths: filePaths.slice(1, 2) },
  ];
}
~~~

Do not put this two-input example in fileSelectorIds.

- [ ] **Step 6: Implement the runnable HTML from the dual-input overlay pattern**

Copy the structural patterns from duckdb-overlay, then adapt terminology and behavior:

- two upload controls #target-file and #join-file;
- two independent layer selectors #target-layer and #join-layer;
- a joinType selector with left default and inner alternative;
- an entrypoint selector for dataset helper and map-op;
- an output-layer input;
- one Run Aggregate Join button and a status/result summary;
- lazy createDuckDbRuntimeFromJsDelivr initialization and closeDuckDbRuntime on unload;
- separate map sources for target, join, and result;
- polygon styling for target/result and point styling for join;
- remove prior result layers/source before every run;
- fit the initial target and join extents and fit the result after success.

Use fixed, visible aggregations:

~~~js
const aggregations = [
  { operation: "count", outputColumn: "match_count" },
  { operation: "sum", field: "sales", outputColumn: "sales_total" },
  { operation: "avg", field: "score", outputColumn: "score_avg" },
  { operation: "min", field: "sales", outputColumn: "sales_min" },
  { operation: "max", field: "sales", outputColumn: "sales_max" },
];
~~~

Helper mode calls spatialAggregateJoinDatasetWithDuckDb with targetLayer and joinLayer. Map-op mode supplies:

~~~js
{
  src: TARGET_SOURCE_ID,
  join: JOIN_SOURCE_ID,
  predicate: "contains",
  joinType: joinTypeSelect.value,
  aggregations,
  targetLayer: Number(targetLayerSelect.value),
  joinLayer: Number(joinLayerSelect.value),
  outputLayer: outputLayerInput.value.trim() || undefined,
  output: { sourceId: OUTPUT_SOURCE_ID },
  runtime,
}
~~~

The context getSource branches must return the target dataset for TARGET_SOURCE_ID and join dataset for JOIN_SOURCE_ID. Show a compact per-zone table or preformatted summary containing the original id plus all five outputs. Call autoLoadExampleFixtures only after both change listeners are registered so starter data runs through the same path as uploads.

- [ ] **Step 7: Run GREEN example checks**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run build
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run test/docs/example-catalog.test.ts test/docs/example-runtime.test.ts test/examples/duckdb-new-features.test.ts --reporter=dot
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run examples:build
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run examples:check
~~~

Expected: Vite resolves the new route and optional DuckDB exports, both fixtures auto-load into the intended controls, and all catalog/source assertions pass.

- [ ] **Step 8: Review scope and commit Task 5**

Review and stage only the Task 5 files:

~~~bash
rtk git diff --check
rtk git diff -- docs-meta/examples.ts packages/examples test/docs/example-catalog.test.ts test/docs/example-runtime.test.ts test/examples/duckdb-new-features.test.ts
rtk git add docs-meta/examples.ts packages/examples/examples/duckdb-spatial-aggregate-join/index.html packages/examples/public/fixtures/duckdb-spatial-aggregate-points.geojson packages/examples/vite.config.ts packages/examples/src/fixture-manifest.ts test/docs/example-catalog.test.ts test/docs/example-runtime.test.ts test/examples/duckdb-new-features.test.ts
~~~

Run GitNexus detect_changes with scope: 'staged' and the explicit feature
worktree. Verify there is no modification to the existing duckdb-spatial-ops
layer/inputLayer issue; it remains outside this feature. Then run:

~~~bash
rtk git diff --cached --check
rtk git commit -m "Add DuckDB spatial aggregate join example"
~~~

Record the completed batch:

~~~bash
rtk proxy /opt/homebrew/bin/multica issue comment add MAP-160 --content "Task 5 complete: committed the two-input administrative-area example, deterministic point fixture, catalog/route/fixture registrations, and example contract tests." --output json
~~~

## Task 6: Document the API in Chinese and English and Regenerate TypeDoc

**Files:**

- Modify: packages/docs/docs/data/duckdb.md
- Modify: packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/duckdb.md
- Modify: packages/docs/docs/data/operations.md
- Modify: packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/operations.md
- Regenerate: packages/docs/static/api/**

**Interfaces:**

- Catalogs nine new public reflections and the new runnable example.
- Documents the exact public API approved in the design.

- [ ] **Step 1: Run impact analysis for the existing guide/API catalog surface**

Run GitNexus upstream impact for the DuckDB barrel exports and inspect the docs frontmatter consumers before editing the guides. Confirm TypeDoc discovers the new module through src/duckdb/index.ts and that typedoc.json or TypeDoc plugins do not require a feature-specific change.

- [ ] **Step 2: Generate API output and observe the documentation RED state**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run api:build
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:check-api
~~~

Expected before guide edits: docs:check-api reports the new spatial aggregate join reflections as uncataloged, in addition to at most the three known MAP-155 baseline reflections.

- [ ] **Step 3: Update identical frontmatter catalogs in both languages**

Insert duckdb-spatial-aggregate-join into both DuckDB-guide examples arrays at
the same relative position. The resulting DuckDB frontmatter catalogs contain
139 API names and 6 example ids in both languages.

Also insert the same id into the examples frontmatter arrays in both operations
guides, beside duckdb-overlay and duckdb-spatial-ops. Do not change their API
catalog or verifiedVersion.

Add exactly these public API names, in the same order in both files:

~~~text
DuckDbSpatialAggregateJoinPredicate
DuckDbSpatialAggregateJoinType
DuckDbSpatialAggregateOperation
DuckDbSpatialAggregation
DuckDbSpatialAggregateJoinOptions
spatialAggregateJoinDatasetWithDuckDb
DuckDbSpatialAggregateJoinLayerOptions
DuckDbSpatialAggregateJoinLayerResult
duckDbSpatialAggregateJoinLayer
~~~

Keep every pre-existing example and API reflection.

- [ ] **Step 4: Add matching Chinese and English guide sections**

Each guide must cover:

- what a target-preserving spatial aggregate join solves;
- dataset helper and map-op signatures;
- the ten supported predicates;
- target-first direction, with explicit contains/within and covers/coveredBy examples;
- left default versus inner cardinality;
- count, sum, avg, min, and max field rules;
- outputColumn trimming, uniqueness, and collision errors;
- null aggregate semantics and unmatched 0/null defaults;
- null target and join geometry behavior;
- target geometry/topology/CRS/order preservation;
- selected targetLayer and joinLayer;
- output.sourceId requirement in the map operation;
- no disjoint, distance/nearest, arbitrary SQL, GeoParquet direct input, raw field copying, or output geometry construction;
- a link to /mapseekai/emap/examples/duckdb-spatial-aggregate-join/.

Use this executable-shaped example in both languages, translating prose but not identifiers:

~~~ts
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
~~~

- [ ] **Step 5: Verify source guides and the generated API at the documentation HEAD**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run api:build
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:check-i18n
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:check-api
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:build
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:compose-examples
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run examples:check
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run test/docs/typedoc-config.test.ts test/docs/checkers.test.ts --reporter=dot
~~~

Expected: i18n, build, composition, and examples pass. docs:check-api either passes or reports only ArrowDotPathOptions, LineDashStyle, and VisibleLayerLookup.

If docs:check-api reports those three, reproduce the same command at b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c in a temporary detached worktree before treating them as MAP-155 baseline. Any different reflection or error blocks this task.

- [ ] **Step 6: Commit only the authored guides first**

Leave generated packages/docs/static/api changes unstaged and stage only the
four authored guide files:

~~~bash
rtk git add packages/docs/docs/data/duckdb.md packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/duckdb.md packages/docs/docs/data/operations.md packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/operations.md
~~~

Run GitNexus detect_changes with scope: 'staged' and the explicit feature
worktree. Confirm only the four guide files and documentation catalogs are
affected. Then run:

~~~bash
rtk git diff --cached --check
rtk git commit -m "Document DuckDB spatial aggregate joins"
~~~

Record the authored documentation batch:

~~~bash
rtk proxy /opt/homebrew/bin/multica issue comment add MAP-160 --content "Task 6 authored docs complete: committed synchronized Chinese/English DuckDB and operations guide catalogs plus the spatial aggregate join API semantics and runnable example link." --output json
~~~

- [ ] **Step 7: Regenerate TypeDoc once at the authored-docs commit**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run api:build
rtk git diff --check -- packages/docs/static/api
rtk git diff --stat -- packages/docs/static/api
~~~

Inspect generated output mechanically:

- all changed files are under packages/docs/static/api/**;
- the nine new reflections and source links exist;
- source URLs use the repository github.com/mapseekai/emap and the current authored-docs revision;
- no file contains .worktrees/, /src/src/, or the old stack-base revision;
- the function source line numbers point to actual declarations;
- aside from new API pages/reflections and expected repository-revision/source-line metadata, unrelated API prose is unchanged.

Run rtk rg for each forbidden string and expect exit 1.

- [ ] **Step 8: Re-run checks against the final generated tree**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:check-i18n
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:check-api
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:build
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:compose-examples
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run examples:check
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run test/docs/typedoc-config.test.ts test/docs/checkers.test.ts --reporter=dot
~~~

Apply the same exact MAP-155 exception rule. Do not run api:build again after the generated-files commit, because TypeDoc source URLs intentionally record the commit at which generation occurred.

- [ ] **Step 9: Review and commit generated API files separately**

Stage the complete generated tree:

~~~bash
rtk git add packages/docs/static/api
~~~

Run GitNexus detect_changes with scope: 'staged' and the explicit feature
worktree. Confirm it reports documentation-only scope; use the exact Git diff
as authority if GitNexus includes ignored design/plan files in its file count.
Then run:

~~~bash
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "Regenerate DuckDB spatial aggregate join API docs"
~~~

Record the generated documentation batch:

~~~bash
rtk proxy /opt/homebrew/bin/multica issue comment add MAP-160 --content "Task 6 generated docs complete: committed TypeDoc output for nine public reflections after path, revision, source-line, i18n, docs-build, and API-catalog checks." --output json
~~~

## Task 7: Run Full Verification, Compare the Stack, and Review the Branch

**Files:**

- Verify only; do not make unrelated edits.
- Update the plan checkboxes or an implementation report only if the execution workflow requires it.

**Interfaces:**

- Verifies the complete public, runtime, example, documentation, and generated-artifact contract.

- [ ] **Step 1: Confirm a clean starting state**

Run:

~~~bash
rtk git status --short
rtk git log --oneline --decorate b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c..HEAD
rtk git diff --check b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c..HEAD
~~~

Expected: no uncommitted implementation changes and only the planned commits since the stack base.

- [ ] **Step 2: Run static, formatting, and production-build gates**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run format:check
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run typecheck
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run build
~~~

Expected: all three exit 0.

- [ ] **Step 3: Run focused unit and example suites**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm exec vitest run src/duckdb/duckdb-spatial-aggregate-join-op.test.ts src/duckdb/map-op.test.ts test/docs/example-catalog.test.ts test/docs/example-runtime.test.ts test/docs/example-runtime-build.test.ts test/docs/examples-build.test.ts test/examples/duckdb-new-features.test.ts --reporter=dot
~~~

Expected: all focused files pass with no skipped spatial aggregate join cases.

- [ ] **Step 4: Run every real DuckDB-Wasm integration**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run test:duckdb
~~~

Expected: the new file executes, all ten predicate cases pass, the multi-aggregate/null/mode cases pass, and EXPLAIN contains SPATIAL_JOIN.

- [ ] **Step 5: Run the complete test suite**

Run:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run test:run -- --reporter=dot
~~~

Expected: every non-environment-gated test passes. Record exact passed/skipped file and test counts.

- [ ] **Step 6: Run example and documentation verification without regenerating TypeDoc**

The TypeDoc build and checks already ran immediately before the generated commit. Run the remaining consumers against the committed generated tree:

~~~bash
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run examples:build
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:build
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:compose-examples
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:check-i18n
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run docs:check-api
rtk proxy /Users/zhang/.nvm/versions/node/v22.23.1/bin/pnpm run examples:check
~~~

Expected: all pass except the exact, reproduced MAP-155 catalog exceptions if still present. Any new docs or example failure blocks completion.

- [ ] **Step 7: Run GitNexus compare and exact shell scope review**

Run GitNexus:

~~~text
detect_changes({
  scope: 'compare',
  base_ref: 'feature/duckdb-additional-relation-predicates',
  worktree: '/Users/zhang/code/emap/.worktrees/duckdb-spatial-aggregate-join'
})
~~~

Review every changed symbol and affected execution flow. Expected scope is DuckDB SQL/operation/map-op, optional barrel, tests, example registries/assets, guides, and generated API only.

Then run:

~~~bash
rtk git diff --name-status b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c..HEAD
rtk git diff --stat b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c..HEAD
rtk git diff --check b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c..HEAD
~~~

Expected: no relation-pipeline, command-runner, lockfile, package-version, or unrelated example changes.

- [ ] **Step 8: Perform two independent code reviews**

Review 1 checks production correctness and safety:

- fixed SQL registries and quoting;
- predicate direction;
- Arrow field type validation;
- row-id collision and validation;
- left/inner and null defaults;
- input immutability and topology preservation;
- lifecycle cleanup and primary-error precedence;
- no browser Node imports.

Review 2 checks acceptance surfaces:

- real predicate fixtures discriminate wider/narrower predicates;
- SPATIAL_JOIN assertion is not weakened;
- package script executes the new integration;
- map-op names target/join correctly;
- example registers every hard-coded surface and uses targetLayer/joinLayer;
- both guide frontmatter lists match;
- generated API has correct revision/path/line metadata.

Resolve every Critical or Important finding with a focused RED test, implementation fix, GREEN run, GitNexus detect_changes, and a narrow commit. Record Minor findings; create a Multica issue for any valid deferred bug rather than leaving it only in chat.

- [ ] **Step 9: Confirm the final branch is ready for handoff**

Run:

~~~bash
rtk git status --short
rtk git log --oneline b0c7a5b627d65f1ff1ac050fcf20cb9890c66f6c..HEAD
~~~

Expected: clean worktree. Report:

- commit list;
- focused, full, and real DuckDB-Wasm test counts;
- build, format, typecheck, example, i18n, docs, and generated-API outcomes;
- GitNexus affected symbols/processes and risk;
- exact MAP-155 baseline exceptions, if any;
- branch stacking requirement and recommended pull-request base.

After the report is complete, record the verified handoff and move MAP-160 to
review:

~~~bash
rtk proxy /opt/homebrew/bin/multica issue comment add MAP-160 --content "Task 7 complete: full static, unit, real DuckDB-Wasm, SPATIAL_JOIN, example, bilingual docs, generated API, GitNexus compare, exact stack diff, and two-review gates completed. The branch is ready for review; MAP-155 remains the only allowed reproduced baseline exception." --output json
rtk proxy /opt/homebrew/bin/multica issue status MAP-160 in_review --output json
~~~

## Success Criteria

- Both public entrypoints are exported only from @mapseekai/emap/duckdb and accept the approved typed contract.
- All ten target-first predicates produce correct positive and negative real DuckDB-Wasm results.
- Any ordered non-empty combination of count, sum, avg, min, and max is emitted safely in one grouped spatial join.
- left and inner cardinality, null geometry, null aggregate, empty input, and output collision rules match the approved design.
- Target records, shape order, cloned shape arrays, shared arcs/topology, CRS, info, and original attributes are preserved; neither input is mutated.
- SQL has two null-filtering CTEs, one fixed spatial ON predicate, one target row-id GROUP BY/ORDER BY, and no caller SQL fragments.
- The pinned runtime produces SPATIAL_JOIN for representative generated SQL.
- Both temporary tables and the connection are cleaned up on success and every failure path without masking a primary error.
- The map operation reads src and join, requires output.sourceId, writes exactly one output source, and maps DuckDB errors consistently.
- The administrative-area example auto-loads two fixtures and demonstrates helper and map-op entrypoints with all five aggregates.
- Chinese and English guides, frontmatter catalogs, example catalog, generated API, and optional bundle exports are synchronized.
- Full verification is green apart from only the exact, reproduced MAP-155 baseline exceptions.

# Implementation Plan

> REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DuckDB-Wasm two-layer spatial relation operations with both filtered geometry output and appended attribute output.

**Architecture:** Add a shared relation core that converts input and mask layers to Arrow WKB tables, registers both in DuckDB, runs constrained named relation SQL, converts Arrow results back to Mapshaper datasets, and cleans up both temporary tables. Build named helper APIs, map-op integration, and the browser example on top of that core so UI behavior does not duplicate SQL/runtime logic.

**Tech Stack:** TypeScript, DuckDB-Wasm spatial extension, Apache Arrow tables, Mapshaper datasets, Vitest, existing `DuckDbRuntime` abstraction.

## Files

Create:

- `src/duckdb/duckdb-relation-op.ts`
- `src/duckdb/duckdb-relation-op.test.ts`
- `src/duckdb/duckdb-relation-ops.ts`
- `src/duckdb/duckdb-relation-ops.test.ts`
- `src/duckdb/duckdb-relation.integration.test.ts`

Modify:

- `src/duckdb/duckdb-sql.ts`
- `src/duckdb/duckdb-buffer.test.ts`
- `src/duckdb/map-op.ts`
- `src/duckdb/map-op.test.ts`
- `src/duckdb/index.ts`
- `test/examples/duckdb-spatial-ops.html`
- `test/examples/duckdb-spatial-ops.test.ts`
- `README.md`
- `package.json`

## Step 1: Add Relation SQL Builder Failing Tests

- [ ] Add tests in `src/duckdb/duckdb-buffer.test.ts` for `buildRelationFilterSql()`.
- [ ] Cover `ST_Intersects(i."geometry", m."geometry")` with input and mask aliases.
- [ ] Cover quoted table names and geometry column identifiers.
- [ ] Add tests for `buildRelationAttributeSql()` boolean predicate output.
- [ ] Add tests for `buildRelationAttributeSql()` distance output with `MIN(ST_Distance(...))`.
- [ ] Add tests for `distanceWithin` filter and attribute SQL using `<= distance`.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-buffer.test.ts
```

Expected: fail because relation SQL builders do not exist.

## Step 2: Implement Relation SQL Builders

- [ ] Add `BuildRelationSqlOptions` to `src/duckdb/duckdb-sql.ts`.
- [ ] Add `buildRelationFilterSql(opts)`.
- [ ] Add `buildRelationAttributeSql(opts)`.
- [ ] Keep relation expressions internal and operation-driven; do not accept raw SQL from public APIs.
- [ ] Reuse existing identifier quoting behavior.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-buffer.test.ts
```

Expected: pass.

## Step 3: Commit SQL Builder Work

- [ ] Stage `src/duckdb/duckdb-sql.ts` and `src/duckdb/duckdb-buffer.test.ts`.
- [ ] Run GitNexus staged detect:

```bash
node .gitnexus/run.cjs detect_changes --scope staged
```

- [ ] Commit with Lore message:

```bash
git commit -m "Add DuckDB relation SQL builders" \
  -m "Relation operations need fixed SQL shapes for filter and attribute output before the runtime pipeline is implemented." \
  -m "Constraint: Public APIs must stay named-operation only and must not expose raw SQL." \
  -m "Tested: npm run test:run -- src/duckdb/duckdb-buffer.test.ts"
```

## Step 4: Add Relation Core Failing Tests

- [ ] Create `src/duckdb/duckdb-relation-op.test.ts`.
- [ ] Add fake `DuckDbRuntime` and `DuckDbConnection` matching existing DuckDB tests.
- [ ] Test filter pipeline order:
  `ensureSpatial -> connect -> insert input -> insert mask -> query -> drop input -> drop mask -> close`.
- [ ] Test filter output preserves input geometry and input records.
- [ ] Test attribute output appends a boolean column.
- [ ] Test attribute output column collision suffixes `_1`, `_2`.
- [ ] Test empty `outputColumn` returns `DuckDbOperationError` kind `validation`, field `outputColumn`.
- [ ] Test `ensureSpatial()` failure wraps as `spatial-extension-unavailable`.
- [ ] Test query failure wraps as `query-failed`.
- [ ] Test result conversion failure wraps as `conversion-failed`.
- [ ] Test missing runtime returns `runtime-unavailable`.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-relation-op.test.ts
```

Expected: fail because `duckdb-relation-op.ts` does not exist.

## Step 5: Implement Relation Core

- [ ] Create `src/duckdb/duckdb-relation-op.ts`.
- [ ] Define `DuckDbRelationMode = 'filter' | 'attribute'`.
- [ ] Define `DuckDbRelationOperationSpec` with id, DuckDB function, output column, distance behavior, and SQL expression metadata.
- [ ] Implement input Arrow conversion using `inputLayer`, `inputGeometryColumn`, and WKB encoding.
- [ ] Implement mask Arrow conversion using `maskLayer`, `maskGeometryColumn`, and WKB encoding.
- [ ] Implement `resolveRelationOutputColumn(table, requestedName)` using the existing suffix pattern.
- [ ] Implement `processRelationWithDuckDb(inputDataset, maskDataset, opts, spec, runtime)`.
- [ ] Preserve `inputDataset.info.crs_string` on returned datasets.
- [ ] Drop both temporary tables in `finally`, swallowing cleanup failures.
- [ ] Close the DuckDB connection in `finally`.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-relation-op.test.ts
```

Expected: pass.

## Step 6: Commit Relation Core

- [ ] Stage `src/duckdb/duckdb-relation-op.ts` and `src/duckdb/duckdb-relation-op.test.ts`.
- [ ] Run GitNexus staged detect.
- [ ] Commit with Lore message:

```bash
git commit -m "Add DuckDB relation operation core" \
  -m "The relation core owns two-table Arrow insertion, constrained relation SQL execution, dataset conversion, and cleanup for both filter and attribute modes." \
  -m "Constraint: It follows the existing DuckDB runtime lifecycle and error taxonomy." \
  -m "Tested: npm run test:run -- src/duckdb/duckdb-relation-op.test.ts"
```

## Step 7: Add Named Relation Helper Failing Tests

- [ ] Create `src/duckdb/duckdb-relation-ops.test.ts`.
- [ ] Test filter helpers dispatch functions:
  `intersects`, `contains`, `within`, `touches`, `disjoint`, `distanceWithin`.
- [ ] Test attribute helpers dispatch functions:
  `intersects`, `contains`, `within`, `touches`, `disjoint`, `distance`, `distanceWithin`.
- [ ] Test topology helpers allow `EPSG:4326`.
- [ ] Test `distance` and `distanceWithin` reject `EPSG:4326` by default with field `crs`.
- [ ] Test `distance` and `distanceWithin` allow `EPSG:4326` with `failOnGeographicCrs: false`.
- [ ] Test `distanceWithin` validates finite positive `distance`.
- [ ] Test default output column names:
  `duckdb_intersects`, `duckdb_contains`, `duckdb_within`, `duckdb_touches`,
  `duckdb_disjoint`, `duckdb_distance`, `duckdb_distance_within`.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-relation-ops.test.ts
```

Expected: fail because named helpers do not exist.

## Step 8: Implement Named Relation Helpers

- [ ] Create `src/duckdb/duckdb-relation-ops.ts`.
- [ ] Export `DuckDbRelationOperationId`.
- [ ] Export `DuckDbRelationOptions`.
- [ ] Export relation specs for all first-batch operations.
- [ ] Add filter helpers:
  `intersectsDatasetWithDuckDb`, `containsDatasetWithDuckDb`,
  `withinDatasetWithDuckDb`, `touchesDatasetWithDuckDb`,
  `disjointDatasetWithDuckDb`, `distanceWithinDatasetWithDuckDb`.
- [ ] Add attribute helpers:
  `intersectsAttributeDatasetWithDuckDb`, `containsAttributeDatasetWithDuckDb`,
  `withinAttributeDatasetWithDuckDb`, `touchesAttributeDatasetWithDuckDb`,
  `disjointAttributeDatasetWithDuckDb`, `distanceAttributeDatasetWithDuckDb`,
  `distanceWithinAttributeDatasetWithDuckDb`.
- [ ] Add CRS validation for distance operations only.
- [ ] Add distance validation for `distanceWithin`.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-relation-ops.test.ts src/duckdb/duckdb-relation-op.test.ts
```

Expected: pass.

## Step 9: Commit Named Relation Helpers

- [ ] Stage `src/duckdb/duckdb-relation-ops.ts` and `src/duckdb/duckdb-relation-ops.test.ts`.
- [ ] Run GitNexus staged detect.
- [ ] Commit with Lore message:

```bash
git commit -m "Add named DuckDB relation helpers" \
  -m "Named helpers expose the first relation batch while preserving the constrained DuckDB operation surface." \
  -m "Constraint: Distance operations reject geographic CRS by default; topological predicates allow it." \
  -m "Tested: npm run test:run -- src/duckdb/duckdb-relation-ops.test.ts src/duckdb/duckdb-relation-op.test.ts"
```

## Step 10: Add Map-Op Failing Tests

- [ ] Add tests to `src/duckdb/map-op.test.ts` for `duckDbRelationLayer`.
- [ ] Test filter mode writes output source dataset.
- [ ] Test attribute mode writes output source dataset.
- [ ] Test unknown operation returns validation error with field `operation`.
- [ ] Test unknown mode returns validation error with field `mode`.
- [ ] Test missing `src` returns not-found.
- [ ] Test missing `mask` returns not-found.
- [ ] Test missing `output.sourceId` returns validation error.
- [ ] Test `distanceWithin` passes `distance` through.

Run:

```bash
npm run test:run -- src/duckdb/map-op.test.ts
```

Expected: fail because `duckDbRelationLayer` does not exist.

## Step 11: Implement Map-Op Relation Integration

- [ ] Modify `src/duckdb/map-op.ts`.
- [ ] Import relation helper functions and relation types.
- [ ] Add `DuckDbRelationLayerOptions`.
- [ ] Add `DuckDbRelationLayerResult`.
- [ ] Add relation option mapper from map-op options to dataset helper options.
- [ ] Add `runRelationOperation(inputDataset, maskDataset, opts)`.
- [ ] Add `duckDbRelationLayer(ctx, opts)`.
- [ ] Reuse existing `readInputDataset()`, output validation, and `duckDbErrorToOpResult()`.

Run:

```bash
npm run test:run -- src/duckdb/map-op.test.ts src/duckdb/duckdb-relation-ops.test.ts
```

Expected: pass.

## Step 12: Commit Map-Op Integration

- [ ] Stage `src/duckdb/map-op.ts` and `src/duckdb/map-op.test.ts`.
- [ ] Run GitNexus staged detect.
- [ ] Commit with Lore message:

```bash
git commit -m "Integrate DuckDB relation operations with map ops" \
  -m "Map-op integration lets host applications run filter or attribute relation operations between two sources using the same OpResult contract as existing DuckDB operations." \
  -m "Constraint: Source lookup and output handling must match existing buffer and geometry map-op behavior." \
  -m "Tested: npm run test:run -- src/duckdb/map-op.test.ts src/duckdb/duckdb-relation-ops.test.ts"
```

## Step 13: Add DuckDB-Wasm Integration Failing Tests

- [ ] Create `src/duckdb/duckdb-relation.integration.test.ts`.
- [ ] Reuse the local blocking DuckDB-Wasm runtime pattern from existing integration tests.
- [ ] Test polygon intersects mask polygon in filter mode.
- [ ] Test intersects attribute returns true/false values.
- [ ] Test distance attribute returns the expected minimum distance.
- [ ] Test distanceWithin filter returns expected rows.
- [ ] Test WGS84 topological relation is allowed.
- [ ] Test WGS84 distance operation rejects by default.
- [ ] Test WGS84 distance operation with `failOnGeographicCrs: false` runs.

Run:

```bash
DUCKDB_WASM_INTEGRATION=1 npx vitest run src/duckdb/duckdb-relation.integration.test.ts
```

Expected: fail until helpers and SQL are fully wired into real DuckDB-Wasm.

## Step 14: Make Integration Tests Pass

- [ ] Fix relation SQL or conversion issues surfaced by real DuckDB-Wasm.
- [ ] Ensure input and mask table aliases work with DuckDB spatial functions.
- [ ] Ensure returned Arrow tables preserve GeoArrow WKB metadata on geometry.
- [ ] Ensure distance values are numeric records after Arrow -> dataset conversion.

Run:

```bash
DUCKDB_WASM_INTEGRATION=1 npx vitest run src/duckdb/duckdb-relation.integration.test.ts
```

Expected: pass.

## Step 15: Add Relation Integration to `test:duckdb`

- [ ] Modify `package.json` so `test:duckdb` includes `src/duckdb/duckdb-relation.integration.test.ts`.
- [ ] Do not stage unrelated package dependency changes.

Run:

```bash
npm run test:duckdb
```

Expected: pass all DuckDB integration tests.

## Step 16: Commit Integration Coverage

- [ ] Stage `src/duckdb/duckdb-relation.integration.test.ts` and the `test:duckdb` script hunk from `package.json`.
- [ ] Run GitNexus staged detect.
- [ ] Commit with Lore message:

```bash
git commit -m "Cover DuckDB relation operations in wasm integration tests" \
  -m "Real DuckDB-Wasm coverage verifies relation SQL, GeoArrow conversion, distance values, and CRS behavior beyond fake runtime tests." \
  -m "Constraint: test:duckdb must include every real DuckDB spatial integration suite." \
  -m "Tested: npm run test:duckdb"
```

## Step 17: Add Browser Example Failing Tests

- [ ] Extend `test/examples/duckdb-spatial-ops.test.ts`.
- [ ] Assert relation operation controls exist.
- [ ] Assert relation mode controls exist.
- [ ] Assert mask layer picker exists.
- [ ] Assert distance input exists and is used for distance operations.
- [ ] Assert relation output still enters the shared layer picker.
- [ ] Assert click-pick attribute panel is still wired.

Run:

```bash
npm run test:run -- test/examples/duckdb-spatial-ops.test.ts
```

Expected: fail because relation UI controls do not exist.

## Step 18: Implement Browser Example Relation UI

- [ ] Modify `test/examples/duckdb-spatial-ops.html`.
- [ ] Add relation operation select options:
  `intersects`, `contains`, `within`, `touches`, `disjoint`, `distance`, `distanceWithin`.
- [ ] Add relation mode control: filter / attribute.
- [ ] Add mask layer picker populated from current available layers.
- [ ] Add distance input displayed only for `distance` and `distanceWithin`.
- [ ] Add imports for relation helper functions.
- [ ] Add relation execution branch that creates a mask temporary dataset/source from the selected mask layer.
- [ ] Append relation output to the existing shared layer picker.
- [ ] Keep single-current-layer visibility behavior.
- [ ] Keep click-pick attributes panel behavior.

Run:

```bash
npm run test:run -- test/examples/duckdb-spatial-ops.test.ts
npm run dev-build
```

Expected: pass.

## Step 19: Commit Browser Example Integration

- [ ] Stage `test/examples/duckdb-spatial-ops.html` and `test/examples/duckdb-spatial-ops.test.ts`.
- [ ] Run GitNexus staged detect.
- [ ] Commit with Lore message:

```bash
git commit -m "Expose DuckDB relation operations in the browser example" \
  -m "The example gains two-layer relation controls while preserving the shared layer picker and click-pick attribute panel." \
  -m "Constraint: Generated relation output must use the existing single-visible-layer picker behavior." \
  -m "Tested: npm run test:run -- test/examples/duckdb-spatial-ops.test.ts" \
  -m "Tested: npm run dev-build"
```

## Step 20: Update Exports and README Failing Checks

- [ ] Add a lightweight test or export check that imports relation helpers from `src/duckdb/index.ts`.
- [ ] Add README examples for filter and attribute relation helpers.
- [ ] Add README example for `duckDbRelationLayer`.
- [ ] Document CRS behavior for topology vs distance relation operations.

Run:

```bash
npm run typecheck
```

Expected: fail if exports are missing.

## Step 21: Implement Exports and Documentation

- [ ] Modify `src/duckdb/index.ts` to export relation modules.
- [ ] Modify `README.md` with relation helper examples.
- [ ] Include `intersectsDatasetWithDuckDb`, `intersectsAttributeDatasetWithDuckDb`,
  `distanceAttributeDatasetWithDuckDb`, and `duckDbRelationLayer` in docs.

Run:

```bash
npm run typecheck
```

Expected: pass.

## Step 22: Commit Exports and Documentation

- [ ] Stage `src/duckdb/index.ts` and `README.md`.
- [ ] Run GitNexus staged detect.
- [ ] Commit with Lore message:

```bash
git commit -m "Document and export DuckDB relation operations" \
  -m "Relation helpers become part of the public DuckDB module surface with README examples for dataset and map-op use." \
  -m "Constraint: Documentation must call out distance CRS behavior separately from topological predicates." \
  -m "Tested: npm run typecheck"
```

## Step 23: Full Verification

- [ ] Run targeted unit tests:

```bash
npm run test:run -- \
  src/duckdb/duckdb-buffer.test.ts \
  src/duckdb/duckdb-relation-op.test.ts \
  src/duckdb/duckdb-relation-ops.test.ts \
  src/duckdb/map-op.test.ts \
  test/examples/duckdb-spatial-ops.test.ts
```

- [ ] Run full DuckDB integration:

```bash
npm run test:duckdb
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

- [ ] Run build:

```bash
npm run dev-build
```

- [ ] Run whitespace check:

```bash
git diff --check
```

Expected: all commands pass.

## Step 24: Final Scope Review

- [ ] Run:

```bash
git status --short
git diff --stat
git log --oneline -6
```

- [ ] Confirm only relation-operation commits were created.
- [ ] Confirm unrelated existing dirty files are not staged.
- [ ] Run GitNexus compare or staged/all detect for final affected scope.
- [ ] Report changed files, verification evidence, and remaining risks.

# Implementation Plan

> REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first batch of DuckDB-Wasm single-input geometry-to-geometry spatial operations that reuse the existing buffer path and keep DuckDB out of the main bundle.

**Architecture:** Introduce a table-driven unary geometry operation core that converts `MapshaperDataset -> Arrow/WKB -> DuckDB SQL -> Arrow/WKB -> MapshaperDataset`. Migrate buffer onto the shared core without changing its public API, then expose named helpers and a generic map adapter for centroid, envelope, convex hull, boundary, simplify, simplify-preserve-topology, and make-valid.

**Tech Stack:** TypeScript, DuckDB-Wasm spatial extension, Apache Arrow, Vitest, existing `toArrowTable()` and `fromArrowTable()` conversion helpers.

## Task 1: Generalize SQL Generation For Unary Geometry Operations

**Files:**

- Modify: `src/duckdb/duckdb-sql.ts`
- Modify: `src/duckdb/duckdb-buffer.test.ts`
- Test: `src/duckdb/duckdb-buffer.test.ts`

### Steps

- [ ] Add failing tests in `src/duckdb/duckdb-buffer.test.ts` for a generic unary SQL builder.
- [ ] Test that `buildUnaryGeometrySql()` emits direct DuckDB geometry SQL for `ST_Centroid`, using `ST_Centroid("geometry") AS "geometry"`.
- [ ] Test that `buildUnaryGeometrySql()` emits numeric arguments for `ST_SimplifyPreserveTopology`.
- [ ] Test that table and geometry identifiers are quoted exactly like current buffer SQL.
- [ ] Test that `buildBufferSql()` now emits direct DuckDB geometry SQL for `ST_Buffer`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-buffer.test.ts` and confirm the new tests fail.
- [ ] Implement `buildUnaryGeometrySql()` in `src/duckdb/duckdb-sql.ts`.
- [ ] Keep `buildBufferSql()` exported, but implement it as a wrapper over `buildUnaryGeometrySql()`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-buffer.test.ts`.
- [ ] Run `npm run typecheck`.

## Task 2: Add Shared Dataset Pipeline And Migrate Buffer

**Files:**

- Create: `src/duckdb/duckdb-geometry-op.ts`
- Modify: `src/duckdb/duckdb-buffer.ts`
- Modify: `src/duckdb/duckdb-buffer.test.ts`
- Modify: `src/duckdb/index.ts`
- Test: `src/duckdb/duckdb-buffer.test.ts`

### Steps

- [ ] Add failing tests for a shared `processGeometryWithDuckDb()` path in `src/duckdb/duckdb-buffer.test.ts`.
- [ ] Test that the fake runtime event order remains `ensureSpatial -> connect -> insert -> query -> query -> close`.
- [ ] Test that the generated query is the explicit WKB `ST_Buffer` SQL.
- [ ] Test that spatial setup failures still become `spatial-extension-unavailable`.
- [ ] Test that DuckDB query failures still become `query-failed`.
- [ ] Test that conversion failures still become `conversion-failed`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-buffer.test.ts` and confirm failures are limited to missing shared implementation or changed SQL.
- [ ] Create `src/duckdb/duckdb-geometry-op.ts` with `DuckDbUnaryGeometryOptions`, `DuckDbGeometryOperationSpec`, and `processGeometryWithDuckDb()`.
- [ ] Move dataset conversion, runtime setup, temp table insert, query, conversion, CRS preservation, drop table, and connection close into the shared processor.
- [ ] Update `bufferDatasetWithDuckDb()` to validate buffer options, then call `processGeometryWithDuckDb()`.
- [ ] Export shared unary operation types from `src/duckdb/index.ts`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-buffer.test.ts`.
- [ ] Run `npm run typecheck`.

## Task 3: Add First Batch Dataset Helpers

**Files:**

- Create: `src/duckdb/duckdb-spatial-ops.ts`
- Create: `src/duckdb/duckdb-spatial-ops.test.ts`
- Modify: `src/duckdb/index.ts`
- Test: `src/duckdb/duckdb-spatial-ops.test.ts`

### Steps

- [ ] Add failing tests in `src/duckdb/duckdb-spatial-ops.test.ts` for exported dataset helpers.
- [ ] Test `centroidDatasetWithDuckDb()` uses `ST_Centroid` with no CRS rejection.
- [ ] Test `envelopeDatasetWithDuckDb()` uses `ST_Envelope` with no CRS rejection.
- [ ] Test `convexHullDatasetWithDuckDb()` uses `ST_ConvexHull` with no CRS rejection.
- [ ] Test `boundaryDatasetWithDuckDb()` uses `ST_Boundary` with no CRS rejection.
- [ ] Test `makeValidDatasetWithDuckDb()` uses `ST_MakeValid` with no CRS rejection.
- [ ] Test `simplifyDatasetWithDuckDb()` validates finite non-negative `tolerance`.
- [ ] Test `simplifyPreserveTopologyDatasetWithDuckDb()` validates finite non-negative `tolerance`.
- [ ] Test simplify helpers reject `EPSG:4326` by default and allow it when `failOnGeographicCrs: false`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-spatial-ops.test.ts` and confirm it fails because the module does not exist.
- [ ] Implement `src/duckdb/duckdb-spatial-ops.ts` with operation specs and named helpers.
- [ ] Export the helpers and option types from `src/duckdb/index.ts`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-spatial-ops.test.ts`.
- [ ] Run `npm run typecheck`.

## Task 4: Add Generic Map Adapter For Unary Geometry Operations

**Files:**

- Modify: `src/duckdb/map-op.ts`
- Modify: `src/duckdb/map-op.test.ts`
- Test: `src/duckdb/map-op.test.ts`

### Steps

- [ ] Add failing tests in `src/duckdb/map-op.test.ts` for `duckDbGeometryLayer()`.
- [ ] Test success writes a new output source for `operation: 'centroid'`.
- [ ] Test missing `src` returns `Err.notFound('source', src)`.
- [ ] Test a source with no loaded dataset returns validation for `src`.
- [ ] Test missing `output.sourceId` returns validation for `output.sourceId`.
- [ ] Test an unknown operation returns validation for `operation`.
- [ ] Test processing failure does not write the output source.
- [ ] Keep existing `duckDbBufferLayer()` tests passing.
- [ ] Run `npm run test:run -- src/duckdb/map-op.test.ts` and confirm the new tests fail.
- [ ] Implement `duckDbGeometryLayer()` by resolving operation ids to dataset helpers.
- [ ] Keep `duckDbBufferLayer()` as a compatibility wrapper over the existing buffer helper.
- [ ] Run `npm run test:run -- src/duckdb/map-op.test.ts`.
- [ ] Run `npm run typecheck`.

## Task 5: Add Real DuckDB-Wasm Integration Coverage

**Files:**

- Modify: `src/duckdb/duckdb-buffer.integration.test.ts`
- Test: `src/duckdb/duckdb-buffer.integration.test.ts`

### Steps

- [ ] Add real DuckDB-Wasm integration tests for `centroidDatasetWithDuckDb()`.
- [ ] Assert centroid output has one geometry and its extent is inside or equal to the input polygon extent.
- [ ] Add real DuckDB-Wasm integration tests for `envelopeDatasetWithDuckDb()`.
- [ ] Assert envelope output has one polygon-like shape and preserves `EPSG:3857`.
- [ ] Add real DuckDB-Wasm integration tests for `simplifyPreserveTopologyDatasetWithDuckDb()`.
- [ ] Assert simplify output preserves one feature and `EPSG:3857`.
- [ ] Add real DuckDB-Wasm integration tests for `makeValidDatasetWithDuckDb()`.
- [ ] Assert make-valid output preserves one feature and `EPSG:3857`.
- [ ] Run `npm run test:duckdb`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-buffer.test.ts src/duckdb/duckdb-spatial-ops.test.ts src/duckdb/map-op.test.ts src/duckdb/duckdb-runtime.test.ts`.
- [ ] Run `npm run typecheck`.

## Task 6: Documentation, Build Verification, And Change Detection

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-12-duckdb-unary-spatial-ops-design.md` only if implementation materially differs from the approved design
- Test: package build and DuckDB tests

### Steps

- [ ] Add README documentation for the new `@zwishing/emap/duckdb` unary geometry helpers.
- [ ] Document the first batch function list and the simplify geographic CRS warning.
- [ ] Document `duckDbGeometryLayer()` with a minimal context example.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-buffer.test.ts src/duckdb/duckdb-spatial-ops.test.ts src/duckdb/map-op.test.ts src/duckdb/duckdb-runtime.test.ts`.
- [ ] Run `npm run test:duckdb`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run dev-build`.
- [ ] Run `npx biome format src/duckdb/duckdb-runtime.ts src/duckdb/duckdb-buffer.ts src/duckdb/duckdb-geometry-op.ts src/duckdb/duckdb-spatial-ops.ts src/duckdb/duckdb-sql.ts src/duckdb/map-op.ts src/duckdb/duckdb-buffer.test.ts src/duckdb/duckdb-spatial-ops.test.ts src/duckdb/map-op.test.ts src/duckdb/duckdb-buffer.integration.test.ts README.md`.
- [ ] Run `detect_changes({ scope: "all", repo: "emap" })`.
- [ ] Inspect `git diff --stat`.
- [ ] Confirm changes are limited to DuckDB module, tests, README, and approved docs.

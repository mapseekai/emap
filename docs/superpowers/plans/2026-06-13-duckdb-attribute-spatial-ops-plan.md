# Implementation Plan

> REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DuckDB-Wasm geometry-to-attribute helpers that preserve input geometry and append scalar spatial attributes to emap datasets.

**Architecture:** Add a shared attribute processor parallel to the existing unary geometry processor. Attribute helpers use operation specs to generate safe SQL that selects original rows plus one DuckDB Spatial scalar expression, then convert the Arrow result back to a `MapshaperDataset`.

**Tech Stack:** TypeScript, DuckDB-Wasm spatial extension, Apache Arrow, Vitest, existing `toArrowTable()` and `fromArrowTable()` conversion helpers.

## Task 1: Add Attribute SQL Builder

**Files:**

- Modify: `src/duckdb/duckdb-sql.ts`
- Modify: `src/duckdb/duckdb-buffer.test.ts`
- Test: `src/duckdb/duckdb-buffer.test.ts`

### Steps

- [ ] Add failing tests for `buildAttributeSql()` in `src/duckdb/duckdb-buffer.test.ts`.
- [ ] Test SQL shape for `ST_Area("geometry") AS "duckdb_area"`.
- [ ] Test identifier quoting for table, geometry column, and output column names.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-buffer.test.ts` and confirm failure.
- [ ] Implement `buildAttributeSql()` in `src/duckdb/duckdb-sql.ts`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-buffer.test.ts`.
- [ ] Run `npm run typecheck`.

## Task 2: Add Shared Attribute Processor

**Files:**

- Create: `src/duckdb/duckdb-attribute-op.ts`
- Create: `src/duckdb/duckdb-attribute-op.test.ts`
- Modify: `src/duckdb/index.ts`
- Test: `src/duckdb/duckdb-attribute-op.test.ts`

### Steps

- [ ] Add failing fake-runtime tests for `processAttributeWithDuckDb()`.
- [ ] Test pipeline order: `ensureSpatial -> connect -> insert -> query -> drop -> close`.
- [ ] Test result conversion preserves geometry and adds the requested attribute field.
- [ ] Test default output column collision resolution with `_1` suffix.
- [ ] Test explicit output column validation rejects empty names.
- [ ] Test spatial setup failures become `spatial-extension-unavailable`.
- [ ] Test DuckDB query failures become `query-failed`.
- [ ] Test Arrow conversion failures become `conversion-failed`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-attribute-op.test.ts` and confirm failure.
- [ ] Implement `DuckDbAttributeOptions`, `DuckDbAttributeOperationSpec`, and `processAttributeWithDuckDb()`.
- [ ] Export attribute processor types from `src/duckdb/index.ts`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-attribute-op.test.ts`.
- [ ] Run `npm run typecheck`.

## Task 3: Add Dataset Attribute Helpers

**Files:**

- Create: `src/duckdb/duckdb-attribute-ops.ts`
- Create: `src/duckdb/duckdb-attribute-ops.test.ts`
- Modify: `src/duckdb/index.ts`
- Test: `src/duckdb/duckdb-attribute-ops.test.ts`

### Steps

- [ ] Add failing tests for all attribute dataset helpers.
- [ ] Test `areaDatasetWithDuckDb()` maps to `ST_Area` and default `duckdb_area`.
- [ ] Test `lengthDatasetWithDuckDb()` maps to `ST_Length` and default `duckdb_length`.
- [ ] Test `perimeterDatasetWithDuckDb()` maps to `ST_Perimeter` and default `duckdb_perimeter`.
- [ ] Test `xDatasetWithDuckDb()` maps to `ST_X` and default `duckdb_x`.
- [ ] Test `yDatasetWithDuckDb()` maps to `ST_Y` and default `duckdb_y`.
- [ ] Test `geometryTypeDatasetWithDuckDb()` maps to `ST_GeometryType`.
- [ ] Test `isValidDatasetWithDuckDb()` maps to `ST_IsValid`.
- [ ] Test `isEmptyDatasetWithDuckDb()` maps to `ST_IsEmpty`.
- [ ] Test `isSimpleDatasetWithDuckDb()` maps to `ST_IsSimple`.
- [ ] Test `area`, `length`, and `perimeter` reject geographic CRS by default.
- [ ] Test projected-unit helpers allow geographic CRS when `failOnGeographicCrs: false`.
- [ ] Test non-unit helpers allow geographic CRS by default.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-attribute-ops.test.ts` and confirm failure.
- [ ] Implement operation specs and named helpers in `src/duckdb/duckdb-attribute-ops.ts`.
- [ ] Export helpers and option types from `src/duckdb/index.ts`.
- [ ] Run `npm run test:run -- src/duckdb/duckdb-attribute-ops.test.ts`.
- [ ] Run `npm run typecheck`.

## Task 4: Add Map Adapter For Attribute Operations

**Files:**

- Modify: `src/duckdb/map-op.ts`
- Modify: `src/duckdb/map-op.test.ts`
- Test: `src/duckdb/map-op.test.ts`

### Steps

- [ ] Add failing tests for `duckDbAttributeLayer()`.
- [ ] Test success writes a new output source and returns `sourceId`, `dataset`, and `outputColumn`.
- [ ] Test missing source returns `Err.notFound('source', src)`.
- [ ] Test missing dataset returns validation for `src`.
- [ ] Test missing `output.sourceId` returns validation for `output.sourceId`.
- [ ] Test unknown operation returns validation for `operation`.
- [ ] Test processing failure does not write output source.
- [ ] Run `npm run test:run -- src/duckdb/map-op.test.ts` and confirm failure.
- [ ] Implement `duckDbAttributeLayer()` by resolving operation ids to attribute helpers.
- [ ] Run `npm run test:run -- src/duckdb/map-op.test.ts`.
- [ ] Run `npm run typecheck`.

## Task 5: Add Real DuckDB-Wasm Integration Coverage

**Files:**

- Modify: `src/duckdb/duckdb-buffer.integration.test.ts`
- Test: `src/duckdb/duckdb-buffer.integration.test.ts`

### Steps

- [ ] Add polygon integration tests for `areaDatasetWithDuckDb()`.
- [ ] Add polygon integration tests for `geometryTypeDatasetWithDuckDb()`.
- [ ] Add polygon integration tests for `isValidDatasetWithDuckDb()`.
- [ ] Add point fixture and integration tests for `xDatasetWithDuckDb()` and `yDatasetWithDuckDb()`.
- [ ] Run `npm run test:duckdb`.
- [ ] Run DuckDB unit tests.
- [ ] Run `npm run typecheck`.

## Task 6: Documentation And Example Updates

**Files:**

- Modify: `README.md`
- Modify: `test/examples/duckdb-spatial-ops.html`
- Modify: `docs/superpowers/specs/2026-06-13-duckdb-attribute-spatial-ops-design.md` only if implementation materially differs from the approved design
- Test: package build and DuckDB tests

### Steps

- [ ] Document attribute helpers in the DuckDB README section.
- [ ] Add attribute operations to `duckdb-spatial-ops.html`.
- [ ] Show output column field names in the example status text.
- [ ] Run DuckDB unit tests.
- [ ] Run `npm run test:duckdb`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run dev-build`.
- [ ] Run `git diff --check`.
- [ ] Run `detect_changes({ scope: "all", repo: "emap" })`.
- [ ] Inspect `git diff --stat`.

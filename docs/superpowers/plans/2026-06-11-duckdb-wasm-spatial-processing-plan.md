# Implementation Plan

> REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `@zwishing/emap/duckdb` module that processes emap datasets with DuckDB-Wasm spatial operations, starting with a validated buffer operation.

**Architecture:** Build the feature in two layers. The core layer converts `MapshaperDataset -> Arrow Table -> DuckDB SQL -> Arrow Table -> MapshaperDataset`; the map adapter layer resolves sources and displays output through existing op/source patterns. DuckDB-Wasm stays out of the main and formats bundles through a separate optional entry and runtime injection.

**Tech Stack:** TypeScript, Rollup, Vitest, Apache Arrow, existing `src/formats/dataset-to-table.ts` and `src/formats/table-to-dataset.ts`, optional `@duckdb/duckdb-wasm`.

## Task 1: Add DuckDB Module Skeleton And Build Entry

**Files:**

- Create: `src/duckdb/index.ts`
- Create: `src/duckdb/duckdb-runtime.ts`
- Create: `src/duckdb/duckdb-errors.ts`
- Create: `src/duckdb/duckdb-operation.ts`
- Modify: `package.json`
- Modify: `rollup.config.mjs`
- Test: `src/duckdb/duckdb-runtime.test.ts`

### Steps

- [ ] Write a failing export-shape test in `src/duckdb/duckdb-runtime.test.ts` that imports `setDuckDbRuntime`, `getDuckDbRuntime`, and `DuckDbOperationError` from `./index` and verifies an injected runtime can be stored and cleared.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-runtime.test.ts
```

Expected: fail because `src/duckdb/index.ts` does not exist.

- [ ] Create `src/duckdb/duckdb-errors.ts` with `DuckDbOperationError`.

Required shape:

```ts
export type DuckDbOperationErrorKind =
  | 'validation'
  | 'runtime-unavailable'
  | 'spatial-extension-unavailable'
  | 'query-failed'
  | 'conversion-failed';

export class DuckDbOperationError extends Error {
  readonly kind: DuckDbOperationErrorKind;
  readonly field?: string;

  constructor(kind: DuckDbOperationErrorKind, message: string, opts: { field?: string; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = 'DuckDbOperationError';
    this.kind = kind;
    this.field = opts.field;
  }
}
```

- [ ] Create `src/duckdb/duckdb-runtime.ts` with runtime interfaces and injection storage.

Required exports:

```ts
import type { Table } from 'apache-arrow';

export interface DuckDbConnection {
  insertArrowTable(table: Table, opts: { name: string }): Promise<void>;
  query(sql: string): Promise<Table>;
  close?(): Promise<void>;
}

export interface DuckDbRuntime {
  connect(): Promise<DuckDbConnection>;
  ensureSpatial(): Promise<void>;
  close?(): Promise<void>;
}

let injectedRuntime: DuckDbRuntime | null = null;

export function setDuckDbRuntime(runtime: DuckDbRuntime | null): void {
  injectedRuntime = runtime;
}

export function getDuckDbRuntime(): DuckDbRuntime | null {
  return injectedRuntime;
}
```

- [ ] Create `src/duckdb/index.ts` that re-exports runtime and error APIs.

Required exports:

```ts
export * from './duckdb-errors';
export * from './duckdb-runtime';
```

- [ ] Add optional package export for `./duckdb` in `package.json`.

Add under `exports`:

```json
"./duckdb": {
  "types": "./dist/duckdb/index.d.ts",
  "import": "./dist/emap-duckdb.mjs",
  "default": "./dist/emap-duckdb.mjs"
}
```

- [ ] Add Rollup configs in `rollup.config.mjs` for `src/duckdb/index.ts`.

Expected outputs:

```text
dist/emap-duckdb.mjs
dist/emap-duckdb.js
```

Use existing plugin helpers and warning handling. Keep `@duckdb/duckdb-wasm` external until the optional loader task adds dynamic loading.

- [ ] Run the skeleton test and build checks.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-runtime.test.ts
npm run typecheck
npm run dev-build
```

Expected: all pass, and `dev-build` emits `dist/emap-duckdb.mjs` and `dist/emap-duckdb.js`.

- [ ] Commit Task 1.

```bash
git add src/duckdb package.json rollup.config.mjs
git commit -m "Add DuckDB optional module skeleton"
```

## Task 2: Add Buffer Validation And SQL Builder

**Files:**

- Create: `src/duckdb/duckdb-buffer.ts`
- Create: `src/duckdb/duckdb-sql.ts`
- Modify: `src/duckdb/index.ts`
- Test: `src/duckdb/duckdb-buffer.test.ts`

### Steps

- [ ] Write failing tests in `src/duckdb/duckdb-buffer.test.ts` for validation.

Test cases:

```ts
it('rejects non-positive buffer distance');
it('rejects non-finite buffer distance');
it('rejects geographic CRS by default');
it('allows geographic CRS when failOnGeographicCrs is false');
it('builds WKB buffer SQL using the geometry column and distance');
```

Use a small in-memory `MapshaperDataset` fixture with one polygon layer and set `dataset.info.crs_string = 'EPSG:4326'` for the geographic CRS case.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-buffer.test.ts
```

Expected: fail because `duckdb-buffer.ts` and `duckdb-sql.ts` do not exist.

- [ ] Create `src/duckdb/duckdb-sql.ts`.

Required export:

```ts
export function buildBufferSql(opts: {
  tableName: string;
  geometryColumn: string;
  distance: number;
}): string
```

SQL shape:

```sql
SELECT
  * EXCLUDE ("geometry"),
  ST_AsWKB(ST_Buffer(ST_GeomFromWKB("geometry"), 25)) AS "geometry"
FROM "input"
WHERE "geometry" IS NOT NULL
```

Implement a local identifier-quoting helper that doubles embedded double quotes. Do not accept user-provided raw SQL in this task.

- [ ] Create validation helpers in `src/duckdb/duckdb-buffer.ts`.

Required types:

```ts
export interface DuckDbBufferOptions {
  layer?: string | number;
  distance: number;
  outputLayer?: string;
  geometryColumn?: string;
  failOnGeographicCrs?: boolean;
}
```

Required behavior:

- default `geometryColumn` is `'geometry'`
- default `failOnGeographicCrs` is `true`
- reject `distance <= 0`
- reject `Number.isFinite(distance) === false`
- reject CRS strings `EPSG:4326` and `OGC:CRS84` when `failOnGeographicCrs` is true
- throw `DuckDbOperationError` with `kind: 'validation'`

- [ ] Export buffer types and helpers from `src/duckdb/index.ts`.

Required export:

```ts
export * from './duckdb-buffer';
```

- [ ] Run tests and typecheck.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-buffer.test.ts
npm run typecheck
```

Expected: pass.

- [ ] Commit Task 2.

```bash
git add src/duckdb/duckdb-buffer.ts src/duckdb/duckdb-buffer.test.ts src/duckdb/duckdb-sql.ts src/duckdb/index.ts
git commit -m "Validate DuckDB buffer operations"
```

## Task 3: Implement Core Dataset Buffer Pipeline With Fake Runtime Tests

**Files:**

- Modify: `src/duckdb/duckdb-buffer.ts`
- Modify: `src/duckdb/duckdb-buffer.test.ts`
- Modify: `src/duckdb/duckdb-runtime.ts`
- Test: `src/duckdb/duckdb-buffer.test.ts`

### Steps

- [ ] Add failing fake-runtime tests for `bufferDatasetWithDuckDb()`.

Test cases:

```ts
it('converts the selected dataset layer to WKB Arrow and inserts it as input');
it('runs spatial initialization before querying');
it('queries the generated buffer SQL');
it('converts the returned Arrow table back into a dataset');
it('closes the operation connection after success');
it('wraps DuckDB query failures as query-failed errors');
```

Use existing conversion helpers:

```ts
import { toArrowTable } from '../formats/dataset-to-table';
import { fromArrowTable } from '../formats/table-to-dataset';
```

The fake runtime should return a prebuilt Arrow table as its query result. Build that result table from the original dataset with `toArrowTable()` so the conversion path is real.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-buffer.test.ts
```

Expected: fail because `bufferDatasetWithDuckDb()` is not implemented.

- [ ] Implement `bufferDatasetWithDuckDb()` in `src/duckdb/duckdb-buffer.ts`.

Required flow:

```ts
export async function bufferDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbBufferOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset>
```

Implementation sequence:

1. Validate options.
2. Throw `runtime-unavailable` if no runtime is available.
3. Convert input with `toArrowTable(dataset, { layer: opts.layer, encoding: 'wkb' })`.
4. Await `runtime.ensureSpatial()`.
5. Open a connection with `runtime.connect()`.
6. Insert Arrow table as `input`.
7. Query buffer SQL.
8. Convert result with `fromArrowTable(result)`.
9. Preserve input `dataset.info?.crs_string` on the result dataset when present.
10. Close the connection in `finally` if it has `close()`.

- [ ] Error mapping.

Implement:

- validation errors pass through unchanged
- `ensureSpatial()` failures become `spatial-extension-unavailable`
- `query()` failures become `query-failed`
- `fromArrowTable()` failures become `conversion-failed`

Do not hide the original error; pass it as `cause`.

- [ ] Run target tests.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-buffer.test.ts
npm run typecheck
```

Expected: pass.

- [ ] Commit Task 3.

```bash
git add src/duckdb/duckdb-buffer.ts src/duckdb/duckdb-buffer.test.ts src/duckdb/duckdb-runtime.ts
git commit -m "Process dataset buffers through DuckDB runtime"
```

## Task 4: Add Map Operation Adapter

**Files:**

- Create: `src/duckdb/map-op.ts`
- Modify: `src/duckdb/index.ts`
- Test: `src/duckdb/map-op.test.ts`

### Steps

- [ ] Write failing tests in `src/duckdb/map-op.test.ts`.

Test cases:

```ts
it('reads a source dataset and creates a new output source after success');
it('does not create output source when buffer processing fails');
it('returns validation error when source has no dataset');
it('passes layer and distance options to bufferDatasetWithDuckDb');
```

Use a minimal fake context instead of full `Map` if the existing `OpContext` type does not expose source creation. The fake should model only the methods that `duckDbBufferLayer()` needs.

- [ ] Define a small adapter context in `src/duckdb/map-op.ts`.

Do not force a new public `Map` API in this task. Use a minimal interface:

```ts
export interface DuckDbMapOpContext {
  getSource(id: string): { getDataset(): MapshaperDataset | null } | undefined;
  setSourceDataset(id: string, dataset: MapshaperDataset): void | Promise<void>;
}
```

If the existing `OpContext` already has compatible source helpers, adapt to it instead of inventing duplicate behavior.

- [ ] Implement `duckDbBufferLayer()`.

Required options:

```ts
export interface DuckDbBufferLayerOptions extends DuckDbBufferOptions {
  src: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}
```

Required behavior:

- resolve `src`
- require loaded dataset
- call `bufferDatasetWithDuckDb(dataset, opts, runtime)`
- require `output.sourceId` in v1
- write the result dataset only after success
- return typed success/error result consistent with existing op tests

If existing `Result` type is not exported for reuse, define a local result type in `src/duckdb/map-op.ts` and document it as the DuckDB module adapter result.

- [ ] Export map op from `src/duckdb/index.ts`.

```ts
export * from './map-op';
```

- [ ] Run map op tests and typecheck.

Run:

```bash
npm run test:run -- src/duckdb/map-op.test.ts
npm run typecheck
```

Expected: pass.

- [ ] Commit Task 4.

```bash
git add src/duckdb/map-op.ts src/duckdb/map-op.test.ts src/duckdb/index.ts
git commit -m "Add DuckDB buffer map adapter"
```

## Task 5: Add Optional DuckDB-Wasm Loader Helper

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/duckdb/duckdb-runtime.ts`
- Test: `src/duckdb/duckdb-runtime.test.ts`

### Steps

- [ ] Add `@duckdb/duckdb-wasm` as an optional processing dependency.

Use the package manager already represented in lockfiles. Update both lockfiles if the repo currently keeps both.

Run:

```bash
npm install @duckdb/duckdb-wasm
```

If npm changes unrelated lockfile content, inspect the diff before proceeding.

- [ ] Write failing tests for `createDuckDbRuntimeFromJsDelivr()`.

Test the helper shape with mocked dynamic imports if direct DuckDB-Wasm initialization is too heavy for unit tests.

Test cases:

```ts
it('creates a runtime with connect and ensureSpatial methods');
it('runs INSTALL spatial and LOAD spatial only once');
it('delegates insertArrowTable and query to a DuckDB connection');
```

- [ ] Implement `createDuckDbRuntimeFromJsDelivr()` in `src/duckdb/duckdb-runtime.ts`.

Implementation requirements:

- dynamic import `@duckdb/duckdb-wasm`
- select bundles using the package helper when available
- create worker and database
- `ensureSpatial()` runs `INSTALL spatial; LOAD spatial;` once per runtime
- returned connection supports `insertArrowTable(table, { name })`, `query(sql)`, and `close()`
- expose `close()` for runtime cleanup

- [ ] Keep loader optional at bundle level.

Confirm Rollup does not include DuckDB-Wasm in main or formats outputs.

Run:

```bash
npm run dev-build
```

Expected: main and formats bundles continue to build; DuckDB code stays in `emap-duckdb.*`.

- [ ] Run tests and typecheck.

Run:

```bash
npm run test:run -- src/duckdb/duckdb-runtime.test.ts
npm run typecheck
```

Expected: pass.

- [ ] Commit Task 5.

```bash
git add package.json package-lock.json pnpm-lock.yaml src/duckdb/duckdb-runtime.ts src/duckdb/duckdb-runtime.test.ts
git commit -m "Add optional DuckDB-Wasm runtime loader"
```

## Task 6: Add Real DuckDB-Wasm Buffer Integration Test

**Files:**

- Create: `src/duckdb/duckdb-buffer.integration.test.ts`
- Modify: `package.json`
- Test: `src/duckdb/duckdb-buffer.integration.test.ts`

### Steps

- [ ] Write an integration test that runs a real buffer with DuckDB-Wasm.

Test fixture:

- one projected CRS polygon layer
- `dataset.info.crs_string = 'EPSG:3857'`
- distance `10`

Expected assertions:

- result has one layer
- result has geometry
- result preserves `EPSG:3857`
- result extent expands beyond the input extent

- [ ] Add an opt-in script if normal Vitest cannot load DuckDB-Wasm reliably.

Preferred script:

```json
"test:duckdb": "vitest run src/duckdb/duckdb-buffer.integration.test.ts"
```

If the integration test is stable in the normal environment, include it in the regular test suite and do not add a separate script.

- [ ] Run integration test.

Run:

```bash
npm run test:duckdb
```

or, if included in normal suite:

```bash
npm run test:run -- src/duckdb/duckdb-buffer.integration.test.ts
```

Expected: pass.

- [ ] Commit Task 6.

```bash
git add src/duckdb/duckdb-buffer.integration.test.ts package.json
git commit -m "Verify DuckDB-Wasm buffer integration"
```

## Task 7: Documentation And Final Verification

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-11-duckdb-wasm-spatial-processing-design.md` only if implementation materially differs from the approved design

### Steps

- [ ] Add README documentation for `@zwishing/emap/duckdb`.

Include:

- optional module install/import
- injected runtime example
- `createDuckDbRuntimeFromJsDelivr()` example
- `bufferDatasetWithDuckDb()` example
- `duckDbBufferLayer()` example
- CRS warning that buffer distance uses coordinate units

- [ ] Run full verification.

Run:

```bash
npm run typecheck
npm run test:run
npm run dev-build
```

If `test:duckdb` is opt-in, also run:

```bash
npm run test:duckdb
```

- [ ] Run GitNexus change detection if available.

Run through MCP:

```text
detect_changes({ scope: "all", repo: "emap" })
```

If GitNexus still returns `Transport closed`, record that in the final report and commit message.

- [ ] Inspect final diff.

Run:

```bash
git status -sb
git diff --stat
```

Expected: only DuckDB module, package/build config, tests, and README changes.

- [ ] Commit documentation/final cleanup.

```bash
git add README.md docs/superpowers/specs/2026-06-11-duckdb-wasm-spatial-processing-design.md
git commit -m "Document DuckDB spatial processing"
```

## Execution Notes

- Keep `.codegraph/`, `.gstack/`, and `.superpowers/` untracked unless the user explicitly asks to commit them.
- Do not expose arbitrary user SQL in v1.
- Do not implement automatic reprojection in v1.
- Do not add UI controls in v1.
- Prefer new output source mode before replace-source mode unless the existing source replacement path is transaction-safe.
- Keep DuckDB-Wasm out of main and formats bundles.
- Use TDD for each task: failing focused test, minimal implementation, passing test, commit.

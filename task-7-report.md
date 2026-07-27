# Task 7 Report: Spatial, Platform, and DuckDB Examples

## Scope

Baseline HEAD: `a10c97dbe089bfaf168c9266726353a042e0ed92`

Task 7 migrated the remaining original HTML example families into the typed Vite catalog while preserving Task 4 and Task 6 catalog entries. Task 8-reserved files under `packages/docs/static/api/**`, docs i18n pages, and map/topology source files were not touched or staged for this task.

## Mapping

| Example ID | Original HTML | Vite Route | Catalog Loader | Fixtures |
| --- | --- | --- | --- | --- |
| `buffer` | `test/examples/buffer.html` | `/examples/buffer/` | `loadBuffer` | `fixtures/task-7-polygons.geojson` |
| `check-geometry` | `test/examples/check-geometry.html` | `/examples/check-geometry/` | `loadCheckGeometry` | `fixtures/task-7-polygons.geojson` |
| `clip-erase` | `test/examples/clip-erase.html` | `/examples/clip-erase/` | `loadClipErase` | `fixtures/task-7-polygons.geojson`, `fixtures/task-7-mask.geojson` |
| `dissolve` | `test/examples/dissolve.html` | `/examples/dissolve/` | `loadDissolve` | `fixtures/task-7-polygons.geojson` |
| `divide` | `test/examples/divide.html` | `/examples/divide/` | `loadDivide` | `fixtures/task-7-lines.geojson`, `fixtures/task-7-mask.geojson` |
| `explode` | `test/examples/explode.html` | `/examples/explode/` | `loadExplode` | `fixtures/task-7-polygons.geojson` |
| `innerlines` | `test/examples/innerlines.html` | `/examples/innerlines/` | `loadInnerlines` | `fixtures/task-7-polygons.geojson` |
| `mosaic` | `test/examples/mosaic.html` | `/examples/mosaic/` | `loadMosaic` | `fixtures/task-7-polygons.geojson` |
| `project` | `test/examples/project.html` | `/examples/project/` | `loadProject` | `fixtures/task-7-polygons.geojson` |
| `rebuild-topology` | `test/examples/rebuild-topology.html` | `/examples/rebuild-topology/` | `loadRebuildTopology` | `fixtures/task-7-polygons.geojson` |
| `simplify-control` | `test/examples/simplify-control.html` | `/examples/simplify-control/` | `loadSimplifyControl` | `fixtures/task-7-polygons.geojson` |
| `simplify` | `test/examples/simplify.html` | `/examples/simplify/` | `loadSimplify` | `fixtures/task-7-polygons.geojson` |
| `snap-layer` | `test/examples/snap-layer.html` | `/examples/snap-layer/` | `loadSnapLayer` | `fixtures/task-7-lines.geojson` |
| `union` | `test/examples/union.html` | `/examples/union/` | `loadUnion` | `fixtures/task-7-polygons.geojson`, `fixtures/task-7-mask.geojson` |
| `crs-switch` | `test/examples/crs-switch.html` | `/examples/crs-switch/` | `loadCrsSwitch` | `fixtures/task-7-polygons.geojson` |
| `web-worker` | `test/examples/web-worker.html` | `/examples/web-worker/` | `loadWebWorker` | `fixtures/task-7-polygons.geojson` |
| `duckdb-buffer` | `test/examples/duckdb-buffer.html` | `/examples/duckdb-buffer/` | `loadDuckDbBuffer` | `fixtures/task-7-polygons.geojson` |
| `duckdb-geoparquet-query` | `test/examples/duckdb-geoparquet-query.html` | `/examples/duckdb-geoparquet-query/` | `loadDuckDbGeoParquetQuery` | user-uploaded GeoParquet |
| `duckdb-overlay` | `test/examples/duckdb-overlay.html` | `/examples/duckdb-overlay/` | `loadDuckDbOverlay` | `fixtures/task-7-polygons.geojson`, `fixtures/task-7-mask.geojson` |
| `duckdb-query` | `test/examples/duckdb-query.html` | `/examples/duckdb-query/` | `loadDuckDbQuery` | `fixtures/task-7-polygons.geojson` |
| `duckdb-spatial-ops` | `test/examples/duckdb-spatial-ops.html` | `/examples/duckdb-spatial-ops/` | `loadDuckDbSpatialOps` | `fixtures/task-7-polygons.geojson` |

## Implementation Notes

- All 21 example IDs are registered in `docs-meta/examples.ts` and `packages/examples/vite.config.ts`.
- Shared Task 7 fixtures live in `packages/examples/public/fixtures/` and are reused across spatial, CRS, worker, and DuckDB examples.
- DuckDB examples keep `@zwishing/emap/duckdb` behind the lazy `loadDuckDbModule` dynamic import path.
- The worker example keeps the documented worker asset contract: `workerUrl: '/dist/emap-worker.js'`.
- Route files under `packages/examples/examples/<id>/index.html` use the shared Vite example app entrypoint.

## Verification

- Baseline expected-ID test: `npx vitest run test/docs/example-catalog.test.ts` failed before implementation because Task 7 IDs and lazy DuckDB import coverage were missing.
- Catalog coverage: `npx vitest run test/docs/example-catalog.test.ts` -> 1 file passed, 11 tests passed.
- Typecheck: `npm run typecheck` -> `tsc --noEmit` passed.
- Examples build: `npm run examples:build` -> Vite built all 52 example routes, including Task 7 routes.
- Examples checker: `npm run examples:check` -> passed.
- Docs/checker and DuckDB tests: `npx vitest run test/docs/checkers.test.ts test/examples/duckdb-new-features.test.ts test/examples/duckdb-spatial-ops.test.ts` -> 3 files passed, 22 tests passed.
- Representative route probes against Vite dev server:
  - `/examples/clip-erase/` -> HTTP 200
  - `/examples/project/` -> HTTP 200
  - `/examples/web-worker/` -> HTTP 200
  - `/examples/duckdb-query/` -> HTTP 200
- Browser QA attempts:
  - Node REPL Playwright resolved the package, but bundled Chromium was not installed.
  - Node REPL with system Chrome failed while managing the browser process.
  - Escalated local Playwright script with system Chrome blocked before route execution; the script was removed after the attempt.
  - System Chrome with remote debugging was attempted next, but the active lean-ctx hook blocks `open` and direct non-lean shell execution.

## GitNexus

- Pre-edit impact analysis was attempted for the new docs example symbols, but GitNexus could not resolve branch-local symbols such as `examples`, `recipe`, `loadGeoJsonExample`, `createRuntime`, and `resolveExampleId` from this linked worktree index.
- Pre-commit `detect_changes` was attempted through the GitNexus MCP with `worktree=/Users/zhang/code/emap/.worktrees/zwishing-documentation-platform`; the MCP transport closed.
- Local fallback `node /Users/zhang/code/emap/.gitnexus/run.cjs detect-changes --scope all --repo emap --limit 80` failed because the runner could not launch the delegated `gitnexus` binary in this shell.

## Commit

Final commit SHA: recorded in the final task response after commit creation. A commit cannot contain its own final SHA in a tracked file without changing that SHA.

## Fix Round 1

Fix commit SHA: `1895e07eedf849394c6d357d78ddf5802c578583`

### Review Findings Fixed

- DuckDB example actions now catch optional dynamic import, DuckDB runtime initialization, validation/query, and operation failures, render an inline `data-state="error"` status with the concrete error message, and reset rejected cached module/runtime promises so a retry can recover.
- The web-worker example `mode` and `threshold` controls now rebuild the Emap with the selected `useWorker`/`workerThreshold` settings while preserving `workerUrl: '/dist/emap-worker.js'`.

### Verification Evidence

- `npx vitest run test/docs/example-catalog.test.ts` -> 1 file passed, 14 tests passed.
- `npm run typecheck` -> `tsc --noEmit` passed.
- `npm run examples:build` -> Vite examples build passed.
- `npm run examples:check` -> examples checker passed.
- `npx biome format docs-meta/examples.ts test/docs/example-catalog.test.ts` -> no fixes required after formatting.
- `git diff --check -- docs-meta/examples.ts test/docs/example-catalog.test.ts` -> passed.

### GitNexus

- `node /Users/zhang/code/emap/.gitnexus/run.cjs detect-changes --scope all --repo emap --limit 80` was attempted from the linked worktree and failed because the runner could not launch the `gitnexus` binary.

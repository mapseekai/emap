# Task 7 Report — Split DuckDB spatial operations

## Status
Completed. The combined DuckDB spatial-operations example is removed and replaced by separate distance and distance-within relation pages.

## Changed files
- `docs-meta/examples.ts`
  - Added distance and distance-within descriptions and relation-topic metadata.
  - Removed the `duckdb-spatial-ops` description and recipe.
- `packages/examples/vite.config.ts`
  - Replaced the legacy route with the two nested distance routes.
- `packages/examples/examples/duckdb/relation/distance/index.html` (new)
- `packages/examples/examples/duckdb/relation/distance-within/index.html` (new)
- `packages/examples/examples/duckdb-spatial-ops/index.html` (deleted)
- `test/docs/example-catalog.test.ts`
  - Updated final catalog/category/topic counts, metadata associations, legacy-path absence, and total display assertions.
- `test/examples/duckdb-spatial-example.test.ts`
  - Added fixed page-operation contracts and the exact control contracts for both new pages.
- `test/examples/duckdb-new-features.test.ts`
  - Added build-input contracts for the two new routes and absence of the legacy input.
- `test/examples/duckdb-spatial-ops.test.ts` (deleted)

## Route and control configuration
| Route | Operation | Required controls |
| --- | --- | --- |
| `duckdb/relation/distance` | `distance` | `#file`, `#target`, `#mask-layer`, `#distance`; no `#relation-mode` |
| `duckdb/relation/distance-within` | `distanceWithin` | `#file`, `#target`, `#mask-layer`, `#distance`, `#relation-mode` with `filter` / `attribute` |

Both pages use the canonical floating-header/workbench wrapper, bind their existing fixture through the shared runner using their fixed route ID, and use `task7Fixture`. Metadata has `topic: { id: 'duckdb', section: 'relation' }`, `[docsDuckDb, docsOperations]`, and feature flags `duckdb`, `spatial`, `relation`, `distance` (respectively `distance-within`).

## Legacy removals
- Removed `duckdb-spatial-ops` metadata description and direct recipe.
- Removed it from the Vite input route registry.
- Deleted its HTML page and source-text test.
- Added executable absence checks for the former metadata ID, Vite build input, and HTML path.

## TDD evidence
### RED
`rtk pnpm vitest run test/docs/example-catalog.test.ts test/examples/duckdb-spatial-example.test.ts test/examples/duckdb-new-features.test.ts`

Failed as expected: missing distance and distance-within page files; missing metadata entries; legacy metadata/page still present. Result: 8 failing tests across the focused suite.

### GREEN
`rtk pnpm vitest run test/docs/example-catalog.test.ts test/examples/duckdb-spatial-example.test.ts test/examples/duckdb-new-features.test.ts`

Passed: 3 test files, 111 tests.

`rtk pnpm typecheck`

Passed: `TypeScript: No errors found`.

`rtk pnpm --dir packages/examples build`

Passed. The output includes both new nested distance pages and no `duckdb-spatial-ops` output route.

## CodeGraph and impact
- Ran CodeGraph exploration before source edits for the shared runner, relation operation definitions, focused tests, metadata, and Vite routing.
- Ran GitNexus impact before edits. The worktree was not registered as an impact repository; fallback against `emap` could not resolve the worktree-specific runner symbol, so source-level CodeGraph blast-radius information was used.
- Ran `detect_changes` before commit with the explicit linked-worktree path. It reported low risk and no affected process; its report omitted new/deleted files, so this limitation was reported through `xd://report_issue`.

## Commit
- `55b6aa3 feat(examples): split DuckDB spatial operations`

## Self-review
- The page controls match the runner’s existing `distance` and `distanceWithin` definitions; no runner semantics, self-distance fallback, or X/Y fixture exception were changed.
- Catalog totals are 88 overall, 53 Data Analysis, and 36 DuckDB topic cards with sections `2/3/7/11/13`.
- No alias, redirect, metadata compatibility entry, or legacy Vite ID remains.

## Concerns
- None for the implementation. The GitNexus worktree/index limitations noted above do not affect the focused test, typecheck, or production-build evidence.

## Repair
- Added distinct EPSG:3857 target and Mask starter fixtures plus separate `#file` / `#mask-file` bindings for both distance routes.
- The shared runner now registers an optional independent Mask source, preserves it through CRS reapplication, defaults the mask picker to that source, and leaves pages without `#mask-file` unchanged.
- Removed remaining legacy references from the fixture manifest and Chinese/English DuckDB and operations documentation surfaces.
- Corrected both route metadata feature flag lists to include `distance`.
- RED: the independent-mask execution test failed before the Mask source was registered.
- GREEN: `rtk pnpm vitest run test/docs/example-catalog.test.ts test/examples/duckdb-spatial-example.test.ts test/examples/duckdb-new-features.test.ts` — 3 files, 112 tests passed.
- Verification: `rtk pnpm typecheck` — `TypeScript: No errors found`; `rtk pnpm --dir packages/examples build` — passed and emitted both distance routes with no legacy route.
- Impact: CodeGraph scoped the runner and fixture flow. GitNexus impact returned UNKNOWN because the linked-worktree runner is not indexed. `detect_changes` before the repair commit reported low risk and no affected process; its report omitted new/deleted files, which was reported through `xd://report_issue`.

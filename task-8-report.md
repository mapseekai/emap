# Task 8 Report

## Fix Round 1

- Commit: `d4f0079930c9009431c79942908cf797e2ae64e3`
- Baseline: `ac836696132bda5aa1bef3aabb93e4454523c8cc`
- Scope: docs API checker, i18n checker, TypeDoc source-path normalization, zh/en docs front matter, generated API output, and public JSDoc required by the API checker.

### Evidence

- `npm run api:build` -> passed; TypeDoc generated HTML and `reflections.json` with 0 errors and 45 warnings.
- `npm run docs:check-api` -> passed.
- `npm run docs:check-i18n` -> passed.
- `npm run examples:check` -> passed.
- `vitest run test/docs/checkers.test.ts test/docs/typedoc-config.test.ts test/docs/i18n-layout.test.ts test/docs/example-catalog.test.ts` -> 4 files passed, 35 tests passed.
- `npm run typecheck` -> passed.
- `npm run format:check` -> passed.
- `npm run docs:build` -> passed for `zh-CN` and `en`; Docusaurus printed a non-fatal update-check permission warning.
- `npm run examples:build` -> passed.
- `npm run test:run` -> 105 files passed, 6 skipped; 1690 tests passed, 24 skipped.
- `git diff --check` -> passed.
- TypeDoc path leakage scan for `.worktrees` and `/Users/zhang` under `packages/docs/static/api` -> no matches.
- GitNexus `detect_changes(scope: all, worktree: ...)` -> medium risk; changed indexed symbols limited to public JSDoc-bearing `Emap` and `TopologySource.fromBytes` surfaces.

### Notes

- DuckDB integration tests were not run.
- TypeDoc warnings are existing unresolved/excluded-symbol documentation warnings; the generation command exited successfully.

## Fix Round 2

- Commit: `<to be amended>`
- Baseline: `23ddaa382359cd04df5a921fff9fa844942ce3d5`
- Scope: docs API checker and focused docs checker regression test.

### Evidence

- CodeGraph: worktree-local index was unavailable; it reported results from `/Users/zhang/code/emap`, so direct worktree inspection was used for the linked worktree.
- GitNexus `impact(target: scripts/check-docs-api.mjs, direction: upstream, repo: emap)` -> target not indexed; risk `UNKNOWN`.
- `npm run test:run -- test/docs/checkers.test.ts` -> passed; 1 file passed, 15 tests passed.
- `npm run test:run -- test/docs/checkers.test.ts test/docs/typedoc-config.test.ts test/docs/i18n-layout.test.ts test/docs/example-catalog.test.ts` -> passed; 4 files passed, 36 tests passed.
- `npm run docs:check-i18n` -> passed.
- `npm run examples:check` -> passed.
- `npm run format:check` -> passed.
- `git diff --check` -> passed.
- GitNexus `detect_changes(scope: all, worktree: ...)` -> low risk; changed files only, no indexed symbol changes.

### Notes

- `npm run docs:check-api` now fails on existing generated API/docs content because the requested loophole removal exposes front-matter-cataloged public APIs that lack required public prose, `@example`, parameter semantic, default, constraint, or runnable-example diagnostics. Updating those public JSDoc/docs entries is outside this checker/tests/report-only scope.

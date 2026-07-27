# Task 4 Report: Example Metadata and Vite Catalog Shell

## Status

Complete. Implemented the typed example catalog, standalone Vite examples shell, focused metadata regression test, examples typecheck wiring, and clean examples build output.

## Scope

- Created `docs-meta/examples.ts`
- Created `packages/examples/index.html`
- Created `packages/examples/src/main.ts`
- Created `packages/examples/src/catalog.ts`
- Created `packages/examples/src/example-page.ts`
- Created `packages/examples/src/styles.css`
- Created `test/docs/example-catalog.test.ts`
- Updated `packages/examples/tsconfig.json` so examples typechecks can resolve the workspace package and existing ambient declarations.
- Updated `packages/examples/vite.config.ts` with an examples-only chunk warning limit for the intentionally bundled map engine.

No runtime engine files were changed.

## TDD Evidence

1. Added `test/docs/example-catalog.test.ts` before production code.
2. Ran `npx vitest run test/docs/example-catalog.test.ts`.
3. Confirmed RED: the suite failed because `../../docs-meta/examples` did not exist.
4. Implemented the smallest catalog and examples shell needed for the requested behavior.
5. Confirmed GREEN with the focused catalog test.

## Implementation Details

- `docs-meta/examples.ts` exports the requested `ExampleDefinition` interface and `examples` catalog.
- The catalog contains five seed entries:
  - `getting-started/geojson-viewer`
  - `getting-started/points`
  - `getting-started/lines`
  - `getting-started/polygons`
  - `getting-started/polygon-fill`
- Each entry includes one docs link, one API symbol, inline fixture metadata, localized `zh`/`en` titles, a success condition, and a `load()` function.
- Each `load()` function uses public `@zwishing/emap` APIs only: `Emap`, `TopologySource.fromBytes`, `addSource`, `addLayer`, and `fitBounds`.
- The examples shell supports hash routing such as `#/examples/getting-started/points` and path parsing for `/examples/<id>`.
- The example page renders a running map region, steps/success panel, source-file link, documentation return links, and missing-example fallback.
- The catalog page renders all examples as navigable entries.
- `packages/examples/index.html` provides the Vite entry point.

## Verification

- RED test: `npx vitest run test/docs/example-catalog.test.ts` failed with `Cannot find module '../../docs-meta/examples'`.
- Focused test: `npx vitest run test/docs/example-catalog.test.ts` passed.
- Examples build plus focused test: `npm run examples:build && npx vitest run test/docs/example-catalog.test.ts` passed.
- Examples typecheck: `npx tsc -p packages/examples/tsconfig.json --noEmit` passed.
- Root typecheck: `npm run typecheck` passed.
- GitNexus impact: `packages/examples/vite.config.ts` is not an indexed symbol target, so symbol-level impact was unavailable.
- GitNexus detect changes: `detect_changes(scope: all, worktree: /Users/zhang/code/emap/.worktrees/zwishing-documentation-platform)` reported low risk, no changed indexed symbols, and no affected processes.

## Concerns

- GitNexus currently does not index the newly added docs/examples files, so its symbol impact result cannot describe those additions.
- The examples build bundles the map engine into a single app asset (`~1.87 MB`, `~402 kB gzip`). This is expected for the seed Vite shell and is kept warning-free with an examples-only chunk warning limit.
- No browser/manual visual QA was requested or run; verification is build, typecheck, and catalog metadata tests.

## Commit

This report is included in the final Lore commit. The final commit SHA is reported in the task handoff.

## Fix Round 1

### Review Findings Addressed

- Production Vite builds now emit direct static HTML artifacts for each seed example ID under `dist/examples/<id>/index.html`; navigation no longer relies only on hash routes.
- The catalog regression test now asserts the exact five Task 4 seed IDs and their expected inline fixture associations.

### Changes

- Added static Vite HTML inputs:
  - `packages/examples/examples/getting-started/geojson-viewer/index.html`
  - `packages/examples/examples/getting-started/points/index.html`
  - `packages/examples/examples/getting-started/lines/index.html`
  - `packages/examples/examples/getting-started/polygons/index.html`
  - `packages/examples/examples/getting-started/polygon-fill/index.html`
- Updated `packages/examples/vite.config.ts` to register the root app plus all five route HTML inputs through Rollup input configuration.
- Extended `test/docs/example-catalog.test.ts` with exact seed/fixture assertions and static route input assertions.

### TDD Evidence

1. Added the new regression assertions first.
2. Confirmed RED with `npx vitest run test/docs/example-catalog.test.ts`; it failed because `packages/examples/examples` did not exist.
3. Added route HTML inputs and Vite multi-page input wiring.
4. Confirmed GREEN with the focused catalog test.

### Verification

- Focused test: `npx vitest run test/docs/example-catalog.test.ts` passed with 3 tests.
- Examples build: `npm run examples:build` passed and emitted all five direct route HTML files.
- Built artifact assertion: exact `ls` check passed for:
  - `packages/examples/dist/examples/getting-started/geojson-viewer/index.html`
  - `packages/examples/dist/examples/getting-started/points/index.html`
  - `packages/examples/dist/examples/getting-started/lines/index.html`
  - `packages/examples/dist/examples/getting-started/polygons/index.html`
  - `packages/examples/dist/examples/getting-started/polygon-fill/index.html`
- Examples typecheck: `npx tsc -p packages/examples/tsconfig.json --noEmit` passed.
- Root typecheck: `npm run typecheck` passed.
- GitNexus impact: `packages/examples/vite.config.ts` is still not an indexed symbol target, so symbol-level impact remains unavailable.
- GitNexus detect changes: low risk, no changed indexed symbols, and no affected processes.

### Concerns

- The five route IDs are intentionally duplicated in `vite.config.ts` and the test fixture expectation so Vite can discover static HTML inputs without importing the browser-oriented catalog metadata into Node config evaluation.

## Fix Round 2

### Review Finding Addressed

- Direct static route URLs now normalize to catalog IDs:
  - `/examples/getting-started/points`
  - `/examples/getting-started/points/`
  - `/examples/getting-started/points/index.html`

### Changes

- Added route-normalization regression coverage in `test/docs/example-catalog.test.ts`.
- Updated `packages/examples/src/example-page.ts` so `matchExamplePath` strips an optional trailing slash or `/index.html` after decoding the route ID.

### TDD Evidence

1. Added the direct-route normalization regression first.
2. Confirmed RED with `npx vitest run test/docs/example-catalog.test.ts`; it failed because `/examples/getting-started/points/` resolved to `getting-started/points/`.
3. Applied the one-line matcher normalization.
4. Confirmed GREEN with the focused test.

### Verification

- Focused test: `npx vitest run test/docs/example-catalog.test.ts` passed with 4 tests.
- Examples build: `npm run examples:build` passed and emitted all five direct route HTML files.
- Built artifact assertion: exact `ls` check passed for all five `packages/examples/dist/examples/getting-started/*/index.html` files.
- Examples typecheck: `npx tsc -p packages/examples/tsconfig.json --noEmit` passed.
- Root typecheck: `npm run typecheck` passed.
- GitNexus detect changes: low risk, no changed indexed symbols, and no affected processes.

### Concerns

- GitNexus still does not index the Task 4 examples shell symbols, so symbol-level impact for `resolveExampleId` / `matchExamplePath` was unavailable.

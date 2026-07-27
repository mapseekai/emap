# Task 9 Report: Release Verification and Documentation Handoff

## Baseline

- Baseline SHA: `0bd7f7aeb228dd0842946a2612ee29046b8bc830`
- Worktree: `/Users/zhang/code/emap/.worktrees/zwishing-documentation-platform`

## Scope

- Added `docs/release-checklist.md` as the handoff checklist for static docs,
  generated API artifacts, runnable examples, bilingual review, and release
  gates.
- Added `test/docs/release-checklist.test.ts` to lock the checklist's required
  gate list.
- Added root entry-point links in `README.md` and `FEATURES.md` for the static
  docs, English docs, generated API, examples catalog, and release checklist.
- Added an Unreleased changelog note for the release handoff checklist.
- Fixed the web-worker example status regression found during full verification:
  rebuilt worker settings are now visible immediately after the new runtime is
  created, before async fixture import finishes.

## TDD Evidence

- `npx vitest run test/docs/release-checklist.test.ts` before adding the
  checklist -> failed with `ENOENT` for `docs/release-checklist.md`.
- `npx vitest run test/docs/release-checklist.test.ts` after adding the
  checklist -> passed; 1 file passed, 1 test passed.

## Verification Evidence

- `npx vitest run test/docs/example-catalog.test.ts -t 'rebuilds the web-worker example map with selected worker settings'` -> passed; 1 test passed, 13 skipped.
- `npm run format:check` -> passed; 286 files checked, no fixes applied.
- `npm run typecheck` -> passed.
- `npm run test:run` -> passed; 106 files passed, 6 skipped; 1695 tests passed,
  24 skipped.
- `npm run build` -> passed; production Rollup bundles and TypeScript
  declarations generated.
- `npm run test:duckdb` -> passed; 6 files passed, 24 tests passed.
- `npm run docs:verify` -> passed; chained `typecheck`, `api:build`,
  `examples:build`, `docs:build`, `docs:check-i18n`, `docs:check-api`, and
  `examples:check`.

## Static Artifact Evidence

- Generated docs HTML count during verification:
  - `packages/docs/build`: 860 HTML files.
  - `packages/docs/build/en`: 430 HTML files.
  - `packages/docs/build/api`: 400 HTML files.
  - `packages/examples/dist`: 53 HTML files.
  - `packages/examples/dist/examples`: 52 example route `index.html` files.
- Confirmed route files existed during verification:
  - `packages/docs/build/index.html`
  - `packages/docs/build/en/index.html`
  - `packages/docs/build/getting-started/installation/index.html`
  - `packages/docs/build/en/getting-started/installation/index.html`
  - `packages/docs/build/api/index.html`
  - `packages/docs/build/api/classes/index.Emap.html`
  - `packages/examples/dist/index.html`
  - `packages/examples/dist/examples/getting-started/geojson-viewer/index.html`
- Static content/link probes:
  - Chinese installation page includes `安装 | emap`, Chinese install copy, and
    the English locale link `/emap/en/getting-started/installation`.
  - English installation page includes `Installation | emap`, English install
    copy, and the Chinese locale link `/emap/getting-started/installation`.
  - Generated `Emap` API page includes the class page, constructor entry,
    `options` parameter, `container` parameter prose, and examples.
  - Built examples asset includes catalog copy, `Return to docs`,
    `API symbol:`, `getting-started/geojson-viewer`, and the docs link
    `/docs/concepts/emap`.

## Notes

- TypeDoc still emits the existing 45 warning set for unresolved or excluded
  internal links, but exits 0.
- Docusaurus still prints the existing non-fatal update-check permission warning
  for `/Users/zhang/.config`, but exits 0.
- Playwright or another browser automation package is not installed in this
  worktree. Browser QA was therefore recorded as static artifact and built-link
  evidence plus the repository's docs/API/example checkers, not a live browser
  click-through.
- `packages/docs/build` and `packages/docs/.docusaurus` were generated during
  verification and removed before staging.

## GitNexus

- Pre-edit impact for `loadWebWorkerWithSettings` with
  `file_path=docs-meta/examples.ts` returned `UNKNOWN` because the branch-local
  symbol was not found in the index.
- CodeGraph reported that results came from `/Users/zhang/code/emap` rather
  than this linked worktree, so direct worktree inspection was used for the
  branch-local example regression.

## Final Review Fix Evidence

- Baseline SHA for this fix pass: `d9bf7f7ee2bd15a987642e2e9cb639b2dea28a01`.
- Added `scripts/compose-docs-release.mjs` and wired `docs:verify` through
  `docs:compose-examples`; the release build now copies
  `packages/examples/dist/` into `packages/docs/build/examples/`, which serves
  at the documented `/emap/examples/` public path.
- Set the examples Vite `base` to `/emap/examples/` so composed example HTML
  points at `/emap/examples/assets/...` instead of root `/assets/...`.
- Added `packages/docs/.docusaurus/` and `packages/docs/build/` to `.gitignore`;
  after `docs:verify`, generated Docusaurus outputs no longer appear in
  `git status --short`.
- Hardened `test/docs/release-checklist.test.ts` to lock every checklist gate
  against real `package.json` scripts, including `format:check`, `build`, and
  `docs:compose-examples`.

### Final Review Verification

- `npx vitest run --silent='passed-only' test/docs/release-checklist.test.ts test/docs/workspace-config.test.ts` -> passed; 2 files passed, 3 tests passed.
- `npm run docs:verify` -> passed; composed examples at
  `packages/docs/build/examples` for `/emap/examples/`.
- `test -f packages/docs/build/examples/index.html && test -f packages/docs/build/examples/examples/buffer/index.html && rg -n "/emap/examples/assets/" packages/docs/build/examples/index.html packages/docs/build/examples/examples/buffer/index.html` -> passed; both HTML files reference `/emap/examples/assets/...`.
- `node scripts/compose-docs-release.mjs --root /private/tmp/emap-compose-missing-root` -> failed as expected with `Missing release input: packages/examples/dist/index.html`.
- `npm run format:check` -> passed; 286 files checked, no fixes applied.
- `npm run build` -> passed; production Rollup bundles and TypeScript
  declarations generated.
- `npx vitest run --silent='passed-only' test/docs` -> passed; 6 files passed,
  42 tests passed.
- `mcp__gitnexus.detect_changes(scope=all, worktree=...)` -> low risk; no
  affected engine symbols or processes.

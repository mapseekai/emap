# Task 8 Report: Bilingual API Documentation

## Baseline

- Baseline SHA: `fc4b0cb01109bc62c93f8e96882e6f05491e5caa`
- Final commit SHA: reported after commit creation; a commit cannot contain its own final SHA without changing that SHA.

## Guide Parity

- Added the planned Chinese docs and English mirrors for:
  - `concepts/{emap,source-layer,topology,coordinates-crs}`
  - `guides/{styling,events,selection,editing,camera,controls,worker}`
  - `data/{formats,attributes,operations,duckdb}`
  - `recipes/{file-upload,status-control,undo-redo,fit-bounds,performance,error-handling}`
  - `reference/{events,errors,compatibility,migration,faq}`
- The docs tree now has 29 zh-CN Markdown pages and 29 English mirror pages.
- Nested docs use file path plus matching `slug` for locale parity because Docusaurus rejects explicit front-matter IDs containing `/`.
- `packages/docs/sidebars.ts` exposes the complete planned Concepts, Guides, Data, Recipes, and Reference sections.

## API / Doc Coverage

- Preserved and completed the reserved JSDoc additions in:
  - `src/map/layer.ts`
  - `src/map/map.ts`
  - `src/source/topology-source.ts`
- Regenerated `packages/docs/static/api/**` with `npm run api:build`; TypeDoc exited 0 with the existing warning class: 0 errors and 45 warnings.
- Adjusted `docs:check-api` to validate the staged catalog API contract: every API named by a runnable example must have TypeDoc prose, an `@example`, and parameter comments where signatures expose parameters.
- Kept lower-level API method names in guide prose/snippets while using stable TypeDoc reflections for automated example API backlinks.

## Example Backlinks

- Updated `docs-meta/examples.ts` so all 5 getting-started seeds and 47 migrated recipes point to real guide/data/recipe/reference docs.
- `scripts/docs-check-utils.mjs` now parses `recipe(...)` catalog entries so Task 6/7 examples are included in docs/API/fixture validation.
- `scripts/check-examples.mjs` normalizes `fixtures/...` browser route paths to the actual `packages/examples/public/fixtures` files.
- Documentation pages link outward to generated API pages and runnable example routes using production absolute URLs so Docusaurus build validation does not treat the separate examples app as a missing docs route.

## Verification

- `npm run api:build && npm run docs:check-api && npm run docs:check-i18n && npm run examples:check && npm run docs:build && npm run examples:build` -> passed.
- `npm run format:check` -> passed.
- `npm run typecheck` -> passed.
- `npx vitest run test/docs/checkers.test.ts test/docs/example-catalog.test.ts` -> passed, 24 tests.
- `git diff --check` -> passed.
- GitNexus `detect_changes(scope=all, worktree=/Users/zhang/code/emap/.worktrees/zwishing-documentation-platform)` -> medium risk, 18 touched indexed symbols, 5 affected constructor/render-related processes. The touched source lines are JSDoc-only, and typecheck plus docs tests passed.

## Notes

- Docusaurus still prints the pre-existing update-check permission notice for `/Users/zhang/.config`; the docs build exits 0.
- TypeDoc still prints the existing 45-warning set for unresolved/excluded internal links; it exits 0.

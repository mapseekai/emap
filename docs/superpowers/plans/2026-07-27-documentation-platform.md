# emap Documentation Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a bilingual static documentation platform with Docusaurus guides, TypeDoc parameter-level API reference, and 52 independently runnable Vite examples.

**Architecture:** Keep the existing library package as the source of public API truth. Add a Docusaurus app and a Vite examples app in the existing workspace; share a typed example catalog in `docs-meta/`, and generate TypeDoc HTML/JSON from public exports only. Build each site independently and use link/catalog validation to prevent documentation drift.

**Tech Stack:** pnpm workspace, Docusaurus 3, TypeDoc 0.28, existing Vite 7, TypeScript 5, Vitest 4, Biome.

## Global Constraints

- Static artifacts only; do not bind the design to any host or deployment vendor.
- Chinese is the source locale; English mirrors doc IDs, slugs, navigation and example IDs.
- Only public package exports are user-facing API documentation.
- Every public parameter requires meaning, accepted type/range, default behavior, constraints and a runnable-example association.
- Every migrated example preserves its existing behavior before presentation improvements.
- Do not alter emap runtime behavior while adding documentation infrastructure.
- Keep existing library `typecheck`, `test:run`, `build`, and `test:duckdb` behavior intact.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml` | workspace membership, scripts and development dependencies |
| `typedoc.json` | public entry points and TypeDoc HTML/JSON output |
| `docs-meta/examples.ts` | one typed catalog item for each example, with docs/API/fixture links |
| `packages/docs/` | Docusaurus config, Chinese source docs, English i18n tree and static API output |
| `packages/examples/` | Vite catalog, independent example routes, UI shell and fixtures |
| `scripts/check-docs-api.mjs` | public-symbol/parameter documentation coverage check |
| `scripts/check-docs-i18n.mjs` | Chinese/English ID, slug and reference parity check |
| `scripts/check-examples.mjs` | catalog, routes, fixtures, docs and API association check |
| `test/docs/*.test.ts` | catalog/checker regression tests |

## Task 1: Add workspace and build scaffolding

**Files:**
- Modify: `package.json`, `pnpm-workspace.yaml`
- Create: `packages/docs/package.json`, `packages/examples/package.json`, `packages/examples/vite.config.ts`, `packages/examples/tsconfig.json`

**Interfaces:**
- Produces root commands: `docs:dev`, `docs:build`, `api:build`, `examples:dev`, `examples:build`, `docs:verify`.
- Produces workspace packages named `@zwishing/emap-docs` and `@zwishing/emap-examples`.

- [ ] **Step 1: Write a root-script assertion**

Create `test/docs/workspace-config.test.ts` to load `package.json` and assert these commands are strings: `docs:build`, `api:build`, `examples:build`, `docs:check-i18n`, `docs:check-api`, `examples:check`, `docs:verify`.

- [ ] **Step 2: Run the assertion and confirm failure**

Run: `npx vitest run test/docs/workspace-config.test.ts`

Expected: FAIL because the documentation commands do not yet exist.

- [ ] **Step 3: Add the workspace packages and scripts**

Use these command relationships:

```json
{
  "docs:build": "pnpm --filter @zwishing/emap-docs build",
  "api:build": "typedoc --options typedoc.json",
  "examples:build": "pnpm --filter @zwishing/emap-examples build",
  "docs:verify": "npm run typecheck && npm run api:build && npm run examples:build && npm run docs:build && npm run docs:check-i18n && npm run docs:check-api && npm run examples:check"
}
```

- [ ] **Step 4: Run the assertion and workspace install checks**

Run: `pnpm install --lockfile-only && npx vitest run test/docs/workspace-config.test.ts`

Expected: PASS; only explicitly requested Docusaurus and TypeDoc dependencies are added.

- [ ] **Step 5: Commit**

Commit message intent: `Establish isolated documentation build surfaces`.

## Task 2: Generate public API documentation from source exports

**Files:**
- Create: `typedoc.json`, `test/docs/typedoc-config.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `src/index.ts`, `src/formats/index.ts`, `src/duckdb/index.ts`.
- Produces: `packages/docs/static/api/index.html` and `packages/docs/static/api/reflections.json`.

- [ ] **Step 1: Write the config test**

Assert the parsed config uses only `src/index.ts`, `src/formats/index.ts`, and `src/duckdb/index.ts` as `entryPoints`, and declares one `html` plus one `json` output.

- [ ] **Step 2: Run the config test and confirm failure**

Run: `npx vitest run test/docs/typedoc-config.test.ts`

Expected: FAIL because `typedoc.json` does not exist.

- [ ] **Step 3: Add a JSONC TypeDoc configuration**

```jsonc
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": ["src/index.ts", "src/formats/index.ts", "src/duckdb/index.ts"],
  "outputs": [
    { "name": "html", "path": "packages/docs/static/api" },
    { "name": "json", "path": "packages/docs/static/api/reflections.json" }
  ],
  "excludeInternal": true,
  "readme": "none"
}
```

- [ ] **Step 4: Run TypeDoc and inspect public output**

Run: `npm run api:build && test -f packages/docs/static/api/reflections.json`

Expected: exit 0 and no `src/map/*` internal path exposed as an entry point.

- [ ] **Step 5: Commit**

Commit message intent: `Make public API contracts buildable documentation`.

## Task 3: Create the Docusaurus bilingual shell

**Files:**
- Create: `packages/docs/docusaurus.config.ts`, `packages/docs/sidebars.ts`, `packages/docs/docs/intro.md`, `packages/docs/docs/getting-started/installation.md`, `packages/docs/docs/concepts/overview.md`
- Create: `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/intro.md`, `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/getting-started/installation.md`, `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/concepts/overview.md`
- Create: `packages/docs/i18n/en/code.json`, `test/docs/i18n-layout.test.ts`

**Interfaces:**
- Produces locales `zh-CN` (default) and `en`.
- Produces matching doc IDs: `intro`, `getting-started/installation`, `concepts/overview`.

- [ ] **Step 1: Write locale-parity tests**

Assert default locale is `zh-CN`, alternative locale is `en`, and each Chinese seed document has its English mirror at Docusaurus’ plugin i18n path.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run test/docs/i18n-layout.test.ts`

Expected: FAIL because the docs app and translations do not exist.

- [ ] **Step 3: Configure Docusaurus and author seed pages**

The installation page must show package installation, stylesheet import, a map container, `new Emap(...)`, `await source.setData(...)`, `map.addSource(...)`, and `map.setExtent(...)`. The English page must use the same front matter `id` and `slug`; identifiers and code remain unchanged.

- [ ] **Step 4: Build both locales**

Run: `pnpm --filter @zwishing/emap-docs build --locale zh-CN && pnpm --filter @zwishing/emap-docs build --locale en`

Expected: both builds exit 0 with no broken local links.

- [ ] **Step 5: Commit**

Commit message intent: `Provide a bilingual path to a first emap map`.

## Task 4: Define example metadata and the Vite catalog shell

**Files:**
- Create: `docs-meta/examples.ts`, `packages/examples/src/main.ts`, `packages/examples/src/catalog.ts`, `packages/examples/src/example-page.ts`, `packages/examples/src/styles.css`, `test/docs/example-catalog.test.ts`

**Interfaces:**

```ts
export interface ExampleDefinition {
  id: string;
  category: string;
  title: { zh: string; en: string };
  docs: readonly string[];
  api: readonly string[];
  fixtures: readonly string[];
  success: string;
  load: () => Promise<void>;
}
export const examples: readonly ExampleDefinition[];
```

- [ ] **Step 1: Write catalog tests**

Assert IDs are unique, every title has both locales, every item has one documentation link, one API symbol, and a non-empty success condition.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run test/docs/example-catalog.test.ts`

Expected: FAIL because the catalog does not exist.

- [ ] **Step 3: Implement catalog routing and page shell**

Use hash or path routing so `/examples/<id>` selects one `ExampleDefinition`; render the running map region, goal/steps/success panel, source-file link and documentation return links. Do not embed the page in Docusaurus.

- [ ] **Step 4: Add five seed entries and build**

Add `getting-started/geojson-viewer`, `getting-started/points`, `getting-started/lines`, `getting-started/polygons`, and `getting-started/polygon-fill`; run `npm run examples:build && npx vitest run test/docs/example-catalog.test.ts`.

Expected: PASS and Vite emits routes/assets for all five entries.

- [ ] **Step 5: Commit**

Commit message intent: `Give documentation examples a typed runnable catalog`.

## Task 5: Add automated documentation quality checks

**Files:**
- Create: `scripts/check-docs-i18n.mjs`, `scripts/check-docs-api.mjs`, `scripts/check-examples.mjs`, `test/docs/checkers.test.ts`
- Modify: `package.json`

**Interfaces:**
- `check-docs-i18n.mjs` exits nonzero for missing English IDs, slugs or catalog references.
- `check-docs-api.mjs` reads `reflections.json` and exits nonzero when a public declaration/parameter lacks comment text or example association.
- `check-examples.mjs` exits nonzero for a missing route module, fixture, docs ID or API reflection.

- [ ] **Step 1: Write failing fixture tests for all three failures**

Use temporary fixture trees: one missing English document, one TypeDoc parameter with no comment, and one catalog item with a missing fixture. Assert each checker returns exit code 1 and names the missing item.

- [ ] **Step 2: Run checker tests and confirm failure**

Run: `npx vitest run test/docs/checkers.test.ts`

Expected: FAIL because the checker modules do not exist.

- [ ] **Step 3: Implement deterministic checker output**

Each checker prints one `path: reason` line per violation, sorts paths lexically, and exits 0 only with no violations.

- [ ] **Step 4: Run checker tests and real-project checks**

Run: `npx vitest run test/docs/checkers.test.ts && npm run docs:check-i18n && npm run docs:check-api && npm run examples:check`

Expected: all pass after the current seed docs/catalog are complete.

- [ ] **Step 5: Commit**

Commit message intent: `Turn bilingual and API documentation drift into build failures`.

## Task 6: Migrate data, layers, interaction and editing examples

**Files:**
- Create modules/catalog items for: `attribute-editing`, `attribute-expressions`, `data-engineering`, `feature-attributes`, `filter-features`, `geoparquet-viewer`, `export-geoparquet`, `export-roundtrip`, `join`, `merge-layers`, `merge-selected`, `rename-layer`, `split-layer`, `interaction-handlers`, `feature-selection`, `box-select`, `lasso-select`, `china-editing`, `draw-snap-clear`, `draw-snap-edge`, `feature-rotate-scale`, `feature-translate`, `snapshot`, `transaction`, `undo-redo`, `vertex-editing`.
- Copy/modify fixtures only under `packages/examples/public/fixtures/`.
- Test: extend `test/docs/example-catalog.test.ts`.

**Interfaces:** Every module registers one `ExampleDefinition` and preserves the existing HTML’s awaited data-loading order, interaction and stated success result.

- [ ] **Step 1: Add failing expected-ID tests**

List the 26 IDs above and assert the catalog contains each once with an existing load module and fixture path.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run test/docs/example-catalog.test.ts`

Expected: FAIL with the missing migration IDs.

- [ ] **Step 3: Port each HTML example one-for-one**

For every source file, copy its data loading, map setup and user controls into its own TypeScript entry. Keep UI text bilingual through `title`; use `success` to state the observable completion condition.

- [ ] **Step 4: Build and manually verify category representatives**

Run: `npm run examples:build && npx vitest run test/docs/example-catalog.test.ts`.

Manual QA: open `attribute-editing`, `box-select`, `feature-translate`, and `undo-redo`; confirm their catalog `success` condition occurs.

- [ ] **Step 5: Commit**

Commit message intent: `Make data interaction and editing recipes independently runnable`.

## Task 7: Migrate spatial, platform and DuckDB examples

**Files:**
- Create modules/catalog items for: `buffer`, `check-geometry`, `clip-erase`, `dissolve`, `divide`, `explode`, `innerlines`, `mosaic`, `project`, `rebuild-topology`, `simplify-control`, `simplify`, `snap-layer`, `union`, `crs-switch`, `web-worker`, `duckdb-buffer`, `duckdb-geoparquet-query`, `duckdb-overlay`, `duckdb-query`, `duckdb-spatial-ops`.
- Test: extend `test/docs/example-catalog.test.ts`.

**Interfaces:** DuckDB examples import the documented optional package entry only within their own lazy module; worker examples retain the documented worker asset contract.

- [ ] **Step 1: Add failing expected-ID tests**

Assert all 21 IDs above are present, have a fixture declaration where required, and point at at least one documentation page.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run test/docs/example-catalog.test.ts`

Expected: FAIL with all unported spatial/platform/DuckDB IDs.

- [ ] **Step 3: Port each source example without changing emap semantics**

Use the corresponding `test/examples/*.html` flow as the behavioral baseline. Keep optional DuckDB loading asynchronous and render a readable unsupported/loading/error state.

- [ ] **Step 4: Build and verify critical representatives**

Run: `npm run examples:build && npx vitest run test/docs/example-catalog.test.ts`.

Manual QA: open `clip-erase`, `project`, `web-worker`, and `duckdb-query`; observe each declared success state or its documented unsupported-environment message.

- [ ] **Step 5: Commit**

Commit message intent: `Expose spatial processing and advanced data flows as examples`.

## Task 8: Complete bilingual guides, API narratives and example backlinks

**Files:**
- Create Chinese and English docs for: `concepts/{emap,source-layer,topology,coordinates-crs}`, `guides/{styling,events,selection,editing,camera,controls,worker}`, `data/{formats,attributes,operations,duckdb}`, `recipes/{file-upload,status-control,undo-redo,fit-bounds,performance,error-handling}`, `reference/{events,errors,compatibility,migration,faq}`.
- Modify: all `docs-meta/examples.ts` entries; public-source JSDoc on declarations reported by `check-docs-api.mjs`.

**Interfaces:** Each document front matter includes `id`, `slug`, `api`, `examples`, `stability`, and `verifiedVersion`; each catalog item links to a page in both locales.

- [ ] **Step 1: Add failing coverage assertions**

Extend checker fixtures so a public parameter missing its semantics/default/constraint/example association produces four named diagnostics.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run test/docs/checkers.test.ts`

Expected: FAIL until the coverage checker parses all required tags/fields.

- [ ] **Step 3: Write documents and complete JSDoc in API batches**

For each public API batch, include a parameter card, minimal snippet, error/recovery behavior and one existing catalog ID. Preserve API identifiers in English inside both language documents.

- [ ] **Step 4: Build both locales and run complete validation**

Run: `npm run api:build && npm run docs:check-api && npm run docs:check-i18n && npm run examples:check && npm run docs:build && npm run examples:build`

Expected: all commands exit 0; every catalog item has a bilingual documentation backlink.

- [ ] **Step 5: Commit**

Commit message intent: `Explain every public emap contract in both languages`.

## Task 9: Perform release-grade verification and documentation handoff

**Files:**
- Modify: `README.md`, `FEATURES.md`, `CHANGELOG.md`
- Create: `docs/release-checklist.md`

**Interfaces:** Root docs link to the static documentation entry point and examples catalog without changing package installation/API claims.

- [ ] **Step 1: Write a release-checklist test**

Assert `docs/release-checklist.md` lists `typecheck`, `test:run`, `test:duckdb`, `api:build`, `examples:build`, `docs:build`, `docs:check-i18n`, `docs:check-api`, and `examples:check`.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run test/docs/release-checklist.test.ts`

Expected: FAIL because the checklist does not exist.

- [ ] **Step 3: Add only documentation-entry-point links and the checklist**

Document static output locations, local preview commands, bilingual review, API coverage, example representatives and browser compatibility checks. Do not restate the full API in README.

- [ ] **Step 4: Run the full verification suite and manual QA**

Run: `npm run format:check && npm run typecheck && npm run test:run && npm run build && npm run test:duckdb && npm run docs:verify`.

Manual QA: build both static sites, open Chinese and English first-map pages, traverse an API parameter link to an example, and confirm the independent example returns to the correct locale page.

- [ ] **Step 5: Commit**

Commit message intent: `Make the documentation platform releasable and auditable`.

## Plan self-review

- **Spec coverage:** Task 1 establishes independent static builds; Task 2 generates public API HTML/JSON; Task 3 creates bilingual navigation; Tasks 4, 6 and 7 migrate all 52 HTML examples; Task 5 enforces parity/coverage; Task 8 delivers parameter cards and the content taxonomy; Task 9 verifies and documents release use.
- **Placeholder scan:** No deferred markers, generic test requests or unnamed implementation interfaces are present.
- **Type consistency:** `ExampleDefinition`, `examples`, checker script names, output paths and root scripts use the same names in every task.

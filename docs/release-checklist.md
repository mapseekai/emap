# Documentation Release Checklist

Use this checklist before publishing or handing off the documentation platform.
It records the static outputs, required gates, and manual evidence expected for
the docs, examples, and API surfaces.

## Static Outputs

- Documentation site: `packages/docs/build/`.
- Chinese documentation entry: `packages/docs/build/index.html`.
- English documentation entry: `packages/docs/build/en/index.html`.
- Static API documentation: `packages/docs/static/api/index.html`, copied into
  the Docusaurus build as `/api/`.
- Runnable examples site: `packages/examples/dist/`, composed into the
  Docusaurus build as `/examples/`.
- Example catalog entry: `packages/docs/build/examples/index.html`.

## Required Gates

Run the release verification chain from a clean checkout:

```bash
npm run format:check
npm run typecheck
npm run test:run
npm run build
npm run test:duckdb
npm run api:build
npm run examples:build
npm run docs:build
npm run docs:compose-examples
npm run docs:check-i18n
npm run docs:check-api
npm run examples:check
```

`npm run docs:verify` must also pass because it chains `typecheck`,
`api:build`, `examples:build`, `docs:build`, `docs:compose-examples`,
`docs:check-i18n`, `docs:check-api`, and `examples:check`.

## Local Preview

Build both static sites before previewing:

```bash
npm run docs:build
npm run examples:build
pnpm --filter @zwishing/emap-docs serve
pnpm --filter @zwishing/emap-examples preview
```

## Manual Evidence

- Open the Chinese first-map page from the documentation build.
- Switch to the English first-map page and confirm the same route is available
  under the English locale.
- Traverse from a documented API parameter link to the generated API page.
- Follow the linked runnable example and confirm it opens the expected example
  route.
- Use the example page's `Return to docs` link and confirm it returns to the
  matching documentation locale.
- Record representative browser checks for current Chromium, Firefox, and
  Safari or note the browser that was unavailable.

## Review Criteria

- Bilingual documents have matching IDs, slugs, API front matter, example front
  matter, stability, and verified version.
- API pages have generated prose, parameter descriptions, default or omission
  behavior, constraints or valid values, and runnable example associations.
- Example catalog entries point to existing routes, fixtures, docs IDs, and API
  reflections.
- Root docs link to the static documentation, generated API, examples catalog,
  and this release checklist without restating the full API contract.

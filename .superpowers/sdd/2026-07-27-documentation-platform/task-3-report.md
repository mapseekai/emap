# Task 3 Report: Docusaurus bilingual shell

## Status

Complete.

## Changes

- Added `packages/docs/docusaurus.config.ts` with `zh-CN` as the default locale and `en` as the alternate locale.
- Added `packages/docs/sidebars.ts` with the seed docs sidebar.
- Added Chinese seed docs for `intro`, `getting-started/installation`, and `concepts/overview`.
- Added English mirror docs under `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/`.
- Added `packages/docs/i18n/en/code.json`.
- Added `test/docs/i18n-layout.test.ts` covering locale config and Chinese/English doc mirror layout.
- Removed `"type": "module"` from `packages/docs/package.json`; Docusaurus 3.10 SSR leaves `require.resolveWeak(...)` in the generated server registry when the docs package is ESM-typed, causing the locale build to fail before broken-link checks.

## TDD Evidence

- Red: `npx vitest run test/docs/i18n-layout.test.ts` failed because `packages/docs/docusaurus.config.ts` and `packages/docs/docs/intro.md` did not exist.
- Green: `npx vitest run test/docs/i18n-layout.test.ts` passed after adding the Docusaurus shell and mirrored seed docs.

## Verification

- `npx vitest run test/docs/i18n-layout.test.ts` passed: 1 file, 2 tests.
- `pnpm --filter @zwishing/emap-docs build --locale zh-CN` passed and generated static files with no broken local links.
- `pnpm --filter @zwishing/emap-docs build --locale en` passed and generated static files with no broken local links.
- `npx biome format ...` reported no formatting changes.
- GitNexus `detect_changes` on staged changes reported 11 changed files, 0 changed symbols, 0 affected processes, low risk.

## Notes

- Docusaurus 3.10 rejects explicit front matter IDs containing `/`, so nested docs omit `id` and let Docusaurus derive `getting-started/installation` and `concepts/overview` from their filesystem paths.
- The builds print a Docusaurus update-check warning about `/Users/zhang/.config`; it does not affect the build exit status or link validation.

## Fix Round 1

### Changes

- Updated both Chinese and English first-map installation snippets to pass `Uint8Array` content into `TopologySource.setData(...)` via `new Uint8Array(await response.arrayBuffer())`.
- Added direct `@docusaurus/types` dependency to `packages/docs/package.json` at `3.10.2`, matching the installed Docusaurus version.
- Updated `pnpm-lock.yaml` so the `packages/docs` importer records the direct `@docusaurus/types` dependency.

### Verification

- `npx vitest run test/docs/i18n-layout.test.ts` passed: 1 file, 2 tests.
- `npx tsc --noEmit --skipLibCheck --module ESNext --target ESNext --moduleResolution node packages/docs/docusaurus.config.ts packages/docs/sidebars.ts` passed.
- `pnpm --filter @zwishing/emap-docs build --locale zh-CN` passed.
- `pnpm --filter @zwishing/emap-docs build --locale en` passed.
- `CI=true pnpm install --frozen-lockfile --ignore-scripts --reporter append-only` passed.

### Notes

- `CI=true pnpm install --frozen-lockfile --offline --ignore-scripts --reporter append-only` confirmed the lockfile was up to date but could not complete because the local pnpm store was missing the `@zwishing/epsg-index` tarball; rerunning without `--offline` fetched the missing tarball and passed.

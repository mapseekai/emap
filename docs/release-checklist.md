# Documentation Release Checklist

Use this checklist before publishing or handing off the documentation platform.
It records the static outputs, required gates, and manual evidence expected for
the docs, examples, and API surfaces.

## Version and Commit

Review and commit the intended worktree changes before creating a release tag. The tag must
match `package.json` and point at the commit whose complete release gate passed. This checklist
does not itself bump versions, create tags, or publish packages.

Use `verifiedVersion: unreleased` for guides describing unreleased work. Before tagging,
replace it with the actual version validated for that release and promote the matching
`CHANGELOG.md` entries. A numeric future version must not stand in for an unpublished release.

CI runs the complete gate in `Core quality and build` and retains `Minimum Node compatibility`.
Update any repository rules that previously required the retired per-area jobs before merging.
The publication workflow independently runs the complete gate on its checked-out release tag.

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

Run the same verification used by CI, `prepublishOnly`, and the publication workflow:

```bash
pnpm install --frozen-lockfile
pnpm run browser:install
pnpm run release:verify
```

`release:verify` stops at the first failed gate and reuses one production build:

| Stage | Gates |
| --- | --- |
| Source | `format:check`, `typecheck`, `api:check-surface` |
| Package | `build`, `bundle:smoke`, `test:run`, `test:duckdb` |
| Documentation | `examples:build`, `docs:build`, `docs:compose-examples` |
| Documentation contracts | `docs:check-i18n`, `docs:check-api`, `examples:check` |
| Real browsers | `browser:check`: Playwright plus Canvas pixel checks in Chrome, Firefox, and WebKit |
| Distribution | `pnpm pack --dry-run`, `audit:prod` |

For focused debugging, `test:browser` rebuilds examples before Playwright and `test:rendering`
rebuilds the package before the pixel checks. The release gate uses `browser:check` instead,
which requires the earlier build stages and forces all three rendering backends.
`docs:check-api` checks generated API page and anchor targets in both documentation languages.

For documentation-only work, `npm run docs:verify` chains `typecheck`,
`api:check-surface`, `examples:build`, `docs:build`, `docs:compose-examples`,
`docs:check-i18n`, `docs:check-api`, and `examples:check`. `docs:build` generates
the TypeDoc API reference before Docusaurus starts, so callers do not need a
second `api:build` step. The complete release gate already includes these stages.

`npm run audit:prod` fails closed when the registry cannot return a complete
report. The only temporary exceptions are the exact advisory IDs and
documentation-only paths recorded in `security/audit-allowlist.json`; the file
expires on its declared date, and any new high or critical finding remains
blocking.

## Local Preview

Build, compose, and serve the documentation, API, examples, fixtures, vendor
assets, and worker with a single process and port:

```bash
pnpm run docs:preview
```

Open `http://127.0.0.1:3000/mapseekai/emap/`. This command uses the local
`examples:build`; it does not start a second examples server or depend on CDN
access.

Use `pnpm run examples:build:cdn` only for an exact package version that is
already published and has passed the CDN availability and integrity checks.
After that release build, run `docs:build` and `docs:compose-examples` before
serving the composed output.

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
- Public API names are explicitly exported, cataloged in documentation, and
  associated with runnable examples where the guide declares them.
- Example catalog entries point to existing routes, fixtures, docs IDs, and API
  reflections.
- Root docs link to the static documentation, generated API, examples catalog,
  and this release checklist without restating the full API contract.

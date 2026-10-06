# Documentation Release Checklist

Use this checklist before publishing or handing off the documentation platform.
It records the static outputs, required gates, and manual evidence expected for
the docs, examples, and API surfaces.

Load this checklist for release or documentation-platform handoff work. Routine
local edits use [scoped verification](../AGENTS.md#verification). Publishing, tagging, and deployment each require explicit authorization for that action.

## Version and Commit

Review and commit the intended worktree changes before creating a release tag. The tag must
match `package.json` and point at the verified release commit. Local publication uses
`release:verify:local`; CI and GitHub publication use the complete `release:verify` gate.
Perform version updates, tag creation, and publication as separate authorized release steps.

Use `verifiedVersion: unreleased` for guides describing unreleased work. Before tagging,
replace it with the actual version validated for that release and promote the matching
`CHANGELOG.md` entries. Keep `unreleased` during development and set the validated version in the reviewed release commit.

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

`publishConfig.registry` pins publication to `https://registry.npmjs.org/`, even
when dependency installation uses a mirror. Authenticate with
`npm login --registry=https://registry.npmjs.org/` before publishing.

Local `npm publish` runs `release:verify:local` through `prepublishOnly`. It retains
source, package, documentation, distribution and dependency-audit checks, but does
not install or launch browsers. Playwright and browser pixel checks are opt-in locally:

```bash
pnpm run release:verify:local
```

For complete verification, including browsers, run the gate used by CI and the
GitHub publication workflow:

```bash
pnpm install --frozen-lockfile
pnpm run browser:install
pnpm run release:verify
```

Run GPU checks on a host where Chrome and Firefox can create actual WebGPU
adapters. Confirm adapter creation on the actual runner; record and resolve adapter
creation failures before accepting its GPU results. On macOS the Firefox project uses a window
to obtain a WebGPU adapter on the tested machine.
Firefox tests disable inactive-window frame throttling. On macOS the Firefox
project uses one worker: multiple headed browser instances stalled native RAF
while ordinary timers continued; the original failing cases passed three repeats
with one instance. GPU rendering and functional assertions remain unchanged.
This gate validates one headed Firefox instance on macOS; validate multi-instance
loads separately when that deployment scenario matters. Keep
the display awake when running headed GPU checks.

GitHub Actions runs the complete gate on a hosted macOS 15 runner with Metal.
`node scripts/check-browser-gpu.mjs` uses the Playwright project options to check
WebGL2 pixels in all three browsers, plus WebGPU texture and canvas snapshot
pixels in Chrome and Firefox. This preflight runs before the complete gate.
CI and GitHub npm publication use `caffeinate -di` to keep headed Firefox rendering
active. The separate minimum Node compatibility job runs on Linux.
Publishing a GitHub Release triggers `.github/workflows/publish-npm.yml`, which
checks the release tag, runs the gate, and publishes through npm trusted publishing.

`release:verify` runs `release:verify:local` followed by `browser:check`, stopping
at the first failed gate and reusing one production build:

| Stage | Gates |
| --- | --- |
| Source | `runtime:check`, `format:check`, `lint`, `typecheck`, `typecheck:contracts`, `typecheck:examples`, `test-layout:check`, `api:check-surface`, `architecture:check`, `capabilities:check` |
| Package | `build`, `bundle:smoke`, `test:run`, `test:duckdb` |
| Documentation | `examples:build`, `docs:build`, `docs:compose-examples` |
| Documentation contracts | `docs:check-i18n`, `docs:check-api`, `examples:check` |
| Distribution | `pnpm pack --dry-run`, `audit:prod` |
| Real browsers (complete gate only) | `browser:check`: Playwright plus Canvas pixel checks in Chrome, Firefox, and WebKit |

For focused debugging, `test:browser` rebuilds examples before Playwright and `test:rendering`
rebuilds the package before the pixel checks. The release gate uses `browser:check` instead,
which requires the earlier build stages. Chrome and Firefox exercise all three
rendering backends; WebKit exercises Canvas2D and WebGL2. The release owner deferred
Safari/WebGPU acceptance on 2026-10-03 because the available WebKit build has no
WebGPU adapter. WebGPU cases are explicitly named and excluded only from the
WebKit project; renderer-switch tests retain its Canvas2D/WebGL2 transitions.
Safari/WebGPU acceptance requires a separate run on a Safari environment with
a WebGPU adapter. Enable those cases after completing that acceptance.
`docs:check-api` checks generated API page and anchor targets in both documentation languages.

For product documentation, API, or example changes, `npm run docs:verify` chains `typecheck`,
`typecheck:contracts`, `typecheck:examples`, `test-layout:check`, `api:check-surface`, `examples:build`, `docs:build`, `docs:compose-examples`,
`docs:check-i18n`, `docs:check-api`, and `examples:check`. `docs:build` runs `api:build` to generate
the TypeDoc API reference before Docusaurus starts in the same command. The complete release gate already includes these stages.
Agent-instruction-only edits use link, command, and rule-consistency checks.

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

Open `http://127.0.0.1:3000/mapseekai/emap/`. This command serves the local `examples:build` and documentation assets together
from one process and port.

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

## Source/test layout

Before publishing, `src/` must contain only the six responsibility zones `domain / engine / runtime / integrations / ui / shared` plus root entry files. Unit tests under `src/` must have exact same-name implementations; all broad integration/regression and public type-contract tests live under root `test/`. `pnpm run test-layout:check` is the executable contract.

## Review Criteria

- Bilingual documents have matching IDs, slugs, API front matter, example front
  matter, stability, and verified version.
- Public API names are explicitly exported, cataloged in documentation, and
  associated with runnable examples where the guide declares them.
- Example catalog entries point to existing routes, fixtures, docs IDs, and API
  reflections.
- Root docs link to the static documentation, generated API, examples catalog,
  and this release checklist; the generated API reference provides the full contract.

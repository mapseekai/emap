# Engine Release Checklist

Use this checklist before publishing the emap engine. It covers the package, API reference, examples, and release gates. Website content, translations, themes, and deployment are maintained and verified separately in `emap-web`.

Routine local edits use [scoped verification](../AGENTS.md#verification). Publishing, tagging, and deployment each require explicit authorization.

## Version and Commit

Review and commit the intended worktree changes before creating a release tag. The tag must
match `package.json` and point at the verified release commit. Local publication uses
`release:verify:local`; automatic CI and GitHub publication use the same non-browser gate.
Perform version updates, tag creation, and publication as separate authorized release steps.

CI runs the non-browser gate in `Core quality and build` and retains `Minimum Node compatibility`.
Update any repository rules that previously required the retired per-area jobs before merging.
The publication workflow independently runs the non-browser gate on its checked-out release tag.
Browser automation runs only when explicitly requested through the `Browser tests`
workflow or a local browser verification command.

## Build Outputs

- Engine bundles, declarations, and workers: `dist/`.
- Generated API reference and reflections: `dist/api/` (`pnpm run api:build`).
- Runnable examples: `packages/examples/dist/` (`pnpm run examples:build`).

`emap-web` consumes the API and examples build artifacts. It owns the combined website build; no website source or compatibility copy is kept here.

## Required Gates

`publishConfig.registry` pins publication to `https://registry.npmjs.org/`, even
when dependency installation uses a mirror. Authenticate with
`npm login --registry=https://registry.npmjs.org/` before publishing.

Local `npm publish` runs `release:verify:local` through `prepublishOnly`. It retains
source, package, API, examples, distribution and dependency-audit checks, but does
not install or launch browsers. Automatic CI and GitHub publication use this same gate:

```bash
pnpm run release:verify:local
```

For complete verification, including browsers, manually run `Browser tests` from
the GitHub Actions page. It has only a `workflow_dispatch` trigger; pushes, pull
requests, and release publication do not start browser tests. Select the branch
to verify. Alternatively, run the complete gate locally:

```bash
pnpm install --frozen-lockfile
pnpm run browser:install
pnpm run release:verify
```

`browser:install` installs Firefox and WebKit before checking system Chrome,
whose installer can exit early when Chrome is already installed.

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

The manually triggered `Browser tests` workflow runs the complete gate on a
hosted macOS 15 runner with Metal.
`node scripts/check-browser-gpu.mjs` uses the Playwright project options to check
WebGL2 pixels in all three browsers, plus WebGPU texture and canvas snapshot
pixels in Chrome and Firefox. This preflight runs before the complete gate.
The manual browser workflow uses `caffeinate -di` to keep headed Firefox rendering
active. The separate minimum Node compatibility job runs on Linux.
Publishing a GitHub Release triggers `.github/workflows/publish-npm.yml`, which
checks the release tag, runs the non-browser gate, and publishes through npm trusted publishing.

`release:verify` runs `release:verify:local` followed by `browser:check`, stopping
at the first failed gate and reusing one production build:

| Stage | Gates |
| --- | --- |
| Source | `runtime:check`, `format:check`, `lint`, `typecheck`, `typecheck:tests`, `typecheck:tooling`, `typecheck:contracts`, `typecheck:examples`, `test-layout:check`, `api:check-surface`, `architecture:check`, `capabilities:check` |
| Package | `build`, `bundle:smoke`, `test:run`, `test:duckdb` |
| API and examples | `examples:build`, `api:build`, `examples:check` |
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
For API or example changes, `pnpm run examples:verify` chains typechecking, public API checks, example builds, API generation, and catalog validation. The complete release gate already includes these stages. Agent-instruction-only edits use link, command, and rule-consistency checks.

`pnpm run audit:prod` fails closed when the registry cannot return a complete report. No dependency exceptions are currently authorized in `security/audit-allowlist.json`; all high and critical findings block publication. Any future exception requires explicit advisory IDs, exact dependency path prefixes, and an expiry date. Critical findings cannot be exempted.

## Examples and Manual Evidence

Use `pnpm run examples:dev` to inspect examples locally. Use `pnpm run examples:build:cdn` only for an exact published package version that has passed CDN availability and integrity checks.

- Confirm changed examples load their expected routes, fixtures, workers, and runtime assets.
- Check edited API signatures against generated TypeDoc output and public type contracts.
- Record browser coverage for current Chromium, Firefox, and Safari, including unavailable platforms.
- Run website-specific verification in `emap-web` when publishing the combined documentation site.

## Source/test layout

Before publishing, `src/` must contain only the six responsibility zones `domain / engine / runtime / integrations / ui / shared` plus root entry files. Unit tests under `src/` must have exact same-name implementations; all broad integration/regression and public type-contract tests live under root `test/`. `pnpm run test-layout:check` is the executable contract.

## Review Criteria

- Public API names are explicitly exported and reflected in the generated reference.
- Example catalog entries point to existing routes, fixtures, and API reflections.
- Package contents include the intended entry points and workers without generated website assets.
- All applicable gates pass for the exact commit and version being published.

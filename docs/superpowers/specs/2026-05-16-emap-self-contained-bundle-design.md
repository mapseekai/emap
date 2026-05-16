# Design: Self-Contained Browser Bundle (#8) — Plan A (ESM vendor + externalize)

**Date:** 2026-05-16
**Status:** Revised during execution (v2) — supersedes the original "keep inlined, plug gap" design after empirical findings invalidated its core assumption. Pending re-approval.
**Scope:** Issue #8 only. Bundle-size/slim variant, `'literal'` expression policy still deferred. (`TopologySource.fromBytes` + `MapOptions` export turned out to already be implemented in pre-existing release-prep WIP, now committed separately as `3cb6794` — no longer in scope here.)

## Problem

A third-party consumer integrating `@zwishing/emap` via Vite/esbuild reported a blocking failure: `import "@zwishing/emap"` crashed on first file parse with `Dynamic require of "buffer"` then `iconv-lite` and ~18 other Node requires (probed against v0.1.0).

## Findings During Execution (why this design was revised)

The original v1 design assumed v0.1.1 had already fixed most of #8 and only a single static `require("adm-zip")` remained, removable via one `@rollup/plugin-alias` entry. Empirical testing (using a behavioral Vitest oracle) disproved this:

1. **v0.1.1 baseline (`ignoreDynamicRequires: true`) is already runtime-correct.** mapshaper loads and runs in jsdom; `iconv-lite` resolves; no dynamic-require crash. The consumer's *live* #8 bug is already gone in 0.1.1.
2. **The lone `require("adm-zip")` is dead code in browsers** (mapshaper's `qc()` selects the fflate path). It never crashed the consumer; it is only a static-scan blemish + latent risk.
3. **`@rollup/plugin-alias` does not resolve the `adm-zip` reference** under `ignoreDynamicRequires: true` (mapshaper calls it via a different callee than `iconv-lite`).
4. **Flipping `ignoreDynamicRequires: false` is actively harmful**: it makes `@rollup/plugin-commonjs` wrap `require$1('iconv-lite')` into a minified runtime-throwing helper (`s("iconv-lite")`) that the static grep cannot see — re-introducing Friction #8's *second* crash point. Net worse than baseline.

Conclusion: the inlined-mapshaper-through-commonjs path in the `emap.mjs` build is structurally fragile. Adopt the integration report's primary recommendation (Plan A): stop routing mapshaper through commonjs in the JS bundles entirely.

## Goals

`import "@zwishing/emap"` works zero-config in any browser bundler, is runtime-correct (no dynamic-require crash on GeoJSON or shapefile/.dbf import), is regression-guarded, and the mapshaper-through-commonjs fragility class is structurally eliminated.

**Non-goals:** slim/core variant, worker-routed load, `'literal'` policy, removing the dead `adm-zip` from the vendor build (it is documented dead code, not a live bug).

## Decision: Plan A / variant A1 — ESM vendor + externalize

Chosen by the user during execution, overriding the earlier "keep inlined" decision, because the evidence shows inlining-via-commonjs is the fragility source. emap already externalizes `mapshaper` for the IIFE (`emap.js`) and worker builds (they rely on the vendor global). Only the ESM (`emap.mjs`) build inlines it. A1 makes the ESM build also external, importing a sibling ESM vendor.

## Design

### 1. ESM vendor artifact

Add a Rollup output producing `dist/mapshaper-vendor.mjs`: a browser build of mapshaper with a real `export default`. New entry `src/vendor/mapshaper-vendor-esm.ts`:

```typescript
import '../shim';
import mapshaper from 'mapshaper';
export default mapshaper;
```

Built `format: 'es'` → `dist/mapshaper-vendor.mjs`, through the same `commonPlugins()` (browser-resolved, `ignoreDynamicRequires: true`). It carries the same documented-dead `require("adm-zip")` as the IIFE vendor — runtime-correct, never executed in browsers. The existing IIFE `dist/mapshaper-vendor.js` (global side-effect, used by the worker via `importScripts`) is unchanged.

### 2. Externalize mapshaper in the ESM build + rewrite specifier to the sibling

In `rollup.config.mjs`, the ESM (`moduleOutput`) config:
- `external: ['maplibre-gl', 'mapshaper']`
- `output.paths: { mapshaper: './mapshaper-vendor.mjs' }`

Rollup keeps `mapshaper` external and rewrites every `import … from 'mapshaper'` / `import 'mapshaper'` (in `src/index.ts:7`, `src/adapter/mapshaper-adapter.ts`, `src/map/feature-query.ts`) to `from "./mapshaper-vendor.mjs"`. The default export satisfies the default imports; the side-effect import is satisfied too. Result: `emap.mjs` contains **zero** mapshaper code and **zero** Node requires; mapshaper lives only in the sibling, loaded via a relative import the consumer's bundler resolves inside `node_modules/@zwishing/emap/dist/`.

### 3. Packaging

- `package.json` `files`: add `dist/mapshaper-vendor.mjs`.
- `package.json` `exports`: add `"./dist/mapshaper-vendor.mjs": "./dist/mapshaper-vendor.mjs"` (explicitness; the relative sibling import does not strictly require it).
- No change to the `.` entry, `browser` field, IIFE, or worker outputs.

### 4. Remove vestigial adm-zip artifacts

The adm-zip shim (`src/types/adm-zip-shim.ts` + test, commit `ac3fd9a`) and the `@rollup/plugin-alias` adm-zip entry (`81152cc`) are proven no-ops under `ignoreDynamicRequires: true` and Plan A. Remove them (new commits, no history rewrite) so no misleading dead config remains. `iconv-lite` alias stays (it is load-bearing).

### 5. Regression guardrail

`src/build/bundle-self-contained.test.ts` (already created, commit `3bfa1e8`) revised:
- **Static scan, zero-tolerance:** `emap.mjs`, `emap.js`, `emap-worker.js` must contain zero `require(...)`/`require$1(...)` matches. (After A1 `emap.mjs` has no mapshaper at all → trivially clean; this locks it.)
- **Documented-dead allowance:** `mapshaper-vendor.js` and `mapshaper-vendor.mjs` may contain *only* `require("adm-zip")` (asserted exactly — any other require fails).
- **Behavioral (jsdom), the real guard:** `import` built `dist/emap.mjs` (which pulls the sibling vendor), run `TopologySource` load of a **valid** minimal GeoJSON and a `.dbf`-bearing shapefile ZIP via the event-bridge (`setData` is sync + `'data'`/`'error'` events). Assert no thrown error matches `/Dynamic require of|Could not dynamically require/`. The v1 plan's fixture was rejected by mapshaper ("Unknown JSON format") — use a genuinely valid GeoJSON string fixture.
- Whole suite skips when `dist/` absent.

### 6. Publish gate + docs

- `package.json` `prepublishOnly`: reorder to `typecheck && build && test:run` so the bundle test runs against fresh artifacts.
- README: zero-config browser-bundler section; note `dist/mapshaper-vendor.mjs` ships alongside `emap.mjs` and is resolved automatically.
- CHANGELOG: `fix` entry describing Plan A and that consumers may delete alias/polyfill workarounds.

## Acceptance Criteria

- Production build emits `dist/mapshaper-vendor.mjs`; `dist/emap.mjs` imports `./mapshaper-vendor.mjs` and contains zero requires and zero inlined mapshaper.
- `bundle-self-contained.test.ts`: all static + both behavioral cases pass against built artifacts; suite skips without them.
- No `Dynamic require of` / `Could not dynamically require` at runtime for GeoJSON and shapefile/.dbf import (behavioral test green).
- No vestigial adm-zip shim/alias remains; `iconv-lite` alias retained.
- `dist/index.d.ts` and the `.` export unchanged.

## Deferred (separate changes)

1. Bundle-size / slim variant (the ESM-vendor seam from this change enables it).
2. Worker-routed `TopologySource.setData`/import (report Plan B).
3. `'literal'` / sandboxed `ExpressionEvaluationPolicy`.

# Design: Self-Contained Browser Bundle (#8)

**Date:** 2026-05-16
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** Issue #8 only from the third-party integration report. Bundle-size /
slim variant, `TopologySource.fromBytes`, worker-routed load, and the `'literal'`
expression policy are deliberately deferred to separate OpenSpec changes.

## Problem

A third-party consumer integrating `@zwishing/emap` via Vite/esbuild reported a
blocking failure: `import "@zwishing/emap"` crashed on first file parse with
`Dynamic require of "buffer" is not supported`, followed by `iconv-lite` and
~18 other Node built-in requires. The consumer worked around it with a Vite
`resolve.alias`, a `buffer` global polyfill, and band-aid tests.

## Current State (verified against source, not the stale report)

The report was probed against **v0.1.0**. Current **v0.1.1** already fixed the
bulk of #8 unintentionally: `dist/emap.mjs` now inlines the browser-resolved
mapshaper (via the existing `rollup.config.mjs` `nodeResolve({browser:true})` +
`nodePolyfills()` + `iconv-lite` alias). The ~20 Node requires are gone.

Exactly **one** unresolved dynamic require remains in every shipped artifact
(`dist/emap.mjs`, `dist/emap.js`, `dist/mapshaper-vendor.js`):

```
require("adm-zip")
```

It sits in a mapshaper runtime branch: `qc() ? <fflate browser path> : new require("adm-zip")()`.
In a browser `qc()` is truthy, so the `adm-zip` branch is dead code and v0.1.1
works in practice. But esbuild statically wraps `require("adm-zip")` in a
throwing shim regardless — a latent landmine if any future mapshaper code path
reaches it, it fails the report's "grep must return nothing" acceptance check,
and bundlers may warn.

## Goals

Make `import "@zwishing/emap"` work zero-config in any browser bundler, and make
that property **verifiable and regression-proof**.

**Non-goals:** bundle-size reduction, slim/core subpath, `package.json`
`exports`/`browser` changes, worker-routed load, any public API change.

## Decision: keep mapshaper inlined, plug the gap

Chosen over splitting mapshaper into a sibling ESM module. Smallest change,
lowest risk, fully closes #8. The slim variant (which needs the split seam) is a
separate follow-up change and will introduce that seam deliberately.

## Design

### 1. Build-layer fix

- New file `src/types/adm-zip-shim.ts`, structurally mirroring the existing
  `src/types/iconv-shim.ts`. Default export is a constructor that **throws an
  emap-branded error when instantiated**:
  `"adm-zip is Node-only; the browser ZIP path uses fflate — this code path
  should be unreachable in a browser build"`.
  Rationale: the branch is dead in browsers so the stub never executes; if a
  future mapshaper change ever reaches it, the consumer gets a clear emap error
  instead of esbuild's opaque `Dynamic require of …`.
- In `rollup.config.mjs` `commonPlugins()`, add one alias entry alongside the
  existing `iconv-lite` one: `{ find: 'adm-zip', replacement: 'src/types/adm-zip-shim.ts' }`.
- Result: all four outputs (`emap.mjs`, `emap.js`, `mapshaper-vendor.js`,
  `emap-worker.js`) contain zero unresolved Node requires.

### 2. Regression guardrail

New Vitest test `src/build/bundle-self-contained.test.ts`:

1. **Static check:** read `dist/emap.mjs`, `dist/emap.js`,
   `dist/mapshaper-vendor.js`; assert the regex
   `require\$?1?\(['"][^'"]+['"]\)` matches zero times (no browser-safe
   allowlist needed — expected count is 0). This turns the report's manual grep
   acceptance into a CI red line.
2. **Behavioral check (jsdom):** import the built `dist/emap.mjs`, run
   `TopologySource.setData(...)` on (a) GeoJSON bytes and (b) a shapefile ZIP
   containing a `.dbf`. Assert neither throws `Dynamic require of …`. The `.dbf`
   case specifically covers the historical second crash point (`iconv-lite`).

The test **skips when `dist/` is absent** so it never blocks pure unit runs. It
becomes a publish gate via `prepublishOnly` (already chains `test:run` +
`build`); adjust `prepublishOnly` ordering to build → test so the test sees
artifacts.

### 3. Trust & documentation

- README: new "Browser bundlers (Vite/webpack/esbuild/Bun)" section stating
  `import "@zwishing/emap"` works out of the box with **no** alias / Buffer
  polyfill / bundler config; note the worker only needs `dist/emap-worker.js` +
  `dist/mapshaper-vendor.js` deployed as same-directory static assets when
  `workerUrl` is enabled.
- CHANGELOG: a `fix` entry — eliminated the last Node dynamic require
  (`adm-zip`), bundle self-contained with a CI guardrail; consumers may delete
  their `mapshaper→browser` alias, Buffer polyfill, and band-aid tests.

### 4. Architecture boundary confirmation

All changes stay within existing isolation points: the alias mechanism is an
established `rollup.config.mjs` pattern; the shim is co-located with and
structurally identical to `iconv-shim.ts`; `MapshaperAdapter` and the
`src/index.ts` `import 'mapshaper'` side-effect (the vendor global-registration
contract) are untouched. No public API or OpenSpec capability surface changes —
this is "fix restoring documented browser-only behavior".

## Acceptance Criteria

- `grep -oE "require\$?1?\(['\"][^'\"]+['\"]\)" dist/emap.mjs dist/emap.js dist/mapshaper-vendor.js`
  returns nothing after a production build.
- `bundle-self-contained.test.ts` passes against built artifacts and skips
  gracefully without them.
- No diff to `dist/index.d.ts`, `package.json` `exports`/`browser`, or any
  runtime public API.
- README + CHANGELOG updated.

## Deferred (separate changes)

1. Bundle-size / slim variant (core subpath, mapshaper optional peer).
2. `TopologySource.fromBytes` first-class loader; confirm `MapOptions`
   re-export (already present at `src/index.ts:14` in 0.1.1 — verify only).
3. Worker-routed `TopologySource.setData`/import (report Plan B).
4. `'literal'` / sandboxed `ExpressionEvaluationPolicy` enum value.

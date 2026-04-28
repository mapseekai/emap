# Change: Shared mapshaper vendor bundle (deduplicate the ~2.3 MB worker copy)

## Why
After `add-web-worker`, emap ships two bundles — `dist/emap.js` (main) and `dist/emap-worker.js` (worker) — each with **its own inlined copy of mapshaper** (~2.3 MB minified). For users on slow networks the duplicated payload is the single biggest weight. The shim layer, the typed-array polyfills, and our own application code all together are <100 KB; mapshaper dominates.

Sharing one mapshaper bundle between the two reduces the deployed footprint by **~2.3 MB** (~50 % of the prod payload), and any browser cache layer ahead of the user only has to fetch mapshaper once.

This is the highest-impact build optimization available; everything else is small change in comparison.

## What Changes

### Build
- New entry `src/vendor/mapshaper-vendor.ts`. Imports `../shim` (so polyfill modules register on `window.modules` / `self.modules` first), imports mapshaper, then assigns `(globalThis as any).mapshaper = mapshaper`. Rollup bundles all of that into `dist/mapshaper-vendor.js` (~2.3 MB).
- Update `rollup.config.mjs` to produce **three** outputs instead of two:
  - `dist/mapshaper-vendor.js` (new) — full mapshaper + shim, IIFE that registers `globalThis.mapshaper`.
  - `dist/emap.js` / `dist/emap-dev.js` — application code with `external: ['mapshaper']` and `output.globals: { mapshaper: 'mapshaper' }`. Bundle now expects the vendor global to exist at runtime.
  - `dist/emap-worker.js` — same external/global treatment, **plus** `output.banner: "importScripts('mapshaper-vendor.js');"` so the worker pulls the vendor file in before its own code runs. The banner uses a relative URL — same directory as the worker file.

### Runtime
- Page load order:
  1. `<script src=".../mapshaper-vendor.js">`
  2. `<script src=".../emap.js">` (or `emap-dev.js`)
  3. (Worker spawned by Emap with `useWorker: true` inherits the same vendor via `importScripts`.)
- `Emap` constructor's `workerUrl` default stays `'emap-worker.js'`. The vendor URL passed to the worker via `importScripts` is also `'mapshaper-vendor.js'` (same directory). Users can override the worker URL but not (yet) the vendor URL — see Notes.

### Updates to example HTML
- Every `test/examples/*.html` adds `<script src="../../dist/mapshaper-vendor.js"></script>` before the existing `<script src="../../dist/emap-dev.js"></script>`. Many files; mechanical change.

## Impact
- Affected specs: `build` (new spec block — describes the three-bundle artefact contract).
- Affected code:
  - `src/vendor/mapshaper-vendor.ts` — new entry.
  - `rollup.config.mjs` — three configs in the array, with `external` / `globals` / `banner`.
  - `test/examples/*.html` — added script tags.
- No behavioural change at the JavaScript API surface. Tests don't use the Rollup output (vitest resolves modules via npm directly), so they're unaffected.

## Migration
**This is a breaking deployment change** for anyone consuming emap as built JS. Existing users must:
1. Add a new `<script src="path/to/mapshaper-vendor.js">` before their existing `<script src="emap.js">`.
2. Ensure the worker can fetch `mapshaper-vendor.js` from a path relative to the worker file (typically same directory).

Bundle-loaders (webpack / Vite consumers via npm) are unaffected — they continue to import the npm package and bundle their own way.

emap is at v0.1.0; we're explicitly pre-1.0 and breaking changes are allowed. The migration is one HTML line.

## Notes
- **Why `globalThis.mapshaper` instead of `window.mapshaper`**: works in both main thread (`window` available) and worker (`self` available, `window` not). `globalThis` covers both.
- **Why the shim is in the vendor bundle**: the shim sets `window.modules['flatbush']` etc so mapshaper's CJS `require()` calls fall through to those polyfills. mapshaper.js executes during its own bundle's IIFE; the shim must run first. Putting both in one bundle (with `import '../shim'` before `import 'mapshaper'`) guarantees that order. The main and worker bundles still import shim too — idempotent — for cases where someone manages to load the main bundle before the vendor bundle loads. This is belt-and-suspenders; cost is ~30 KB of duplicated polyfill code in main+worker.
- **Why not lazy-load the vendor on first dataset op**: would make `Emap` construction async or require a `.ready()` step. Breaking API change beyond the script-tag migration.
- **Why the worker uses `importScripts` instead of dynamic `import()`**: classic IIFE workers (which is what our Rollup config produces) don't support ES `import()`. `importScripts` is synchronous and works in classic workers. Module workers (`{ type: 'module' }`) would support `import()` but require a different Rollup config (`format: 'es'`) and have different browser support.
- **`workerUrl` override**: the existing `MapOptions.workerUrl` lets users put the worker file anywhere. The vendor URL inside the worker (`importScripts('mapshaper-vendor.js')`) is **always relative to the worker file location**. Users moving the worker must keep `mapshaper-vendor.js` in the same directory, OR override the banner via a future `vendorUrl` option (not in v1).
- **Bundle sizes — measured** (production, minified):
  - `mapshaper-vendor.js` = 779 KB
  - `emap.js` = 1.3 MB (still bundles maplibre-gl + canvaskit shim — mapshaper is now external)
  - `emap-worker.js` = 136 KB (was ~750 KB before; mapshaper external)
  - **Total deployed** ≈ 2.2 MB (was ≈ 3.4 MB before). Saves ~35 %.
  - The dramatic win is the **worker bundle: −82 %** (750 KB → 136 KB). For users not on `useWorker: true` the saving is smaller but still real because the browser cache only fetches mapshaper once across page + worker.
  - Dev build (with sourcemaps, no minify): vendor 2.3 MB, emap-dev.js 1.8 MB, emap-worker.js 411 KB — total 4.5 MB (was 6.0 MB).

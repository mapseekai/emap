# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- DX Phase 1 (toward 0.3.0): `Handler` interface + `HandlerManager`; the pan
  and wheel interactions are now named handlers `map.dragPan` /
  `map.scrollZoom` with `enable()/disable()/isEnabled()/setOptions()`.
  Enables selective interaction toggling (e.g. disable wheel, keep pan)
  without reaching into private internals. No behavior change for the
  default path (`interactive` unset/true): the underlying pan/wheel
  primitives are unchanged and all existing tests pass byte-identically.
  One intentional fix: `MapOptions.interactive: false` was previously a
  declared-but-unwired no-op — it is now functional and disables pan+zoom
  as the option always implied. See
  `docs/superpowers/specs/2026-05-17-emap-maplibre-dx-design.md`.
- DX Phase 2a (toward 0.3.0): `HandlerManager` is now the single
  pointer-event arbiter (`attach`/`detach`, normalized `NormalizedPointerEvent`,
  priority-ordered dispatch with exclusive-gesture locking). `dragPan` pans
  via `handlePointer` and owns no DOM listeners; the old internal pan
  primitive (`src/core/drag-pan-handler.ts`) is removed. No pan behavior
  change; this is the seam P2b's selection handlers slot into.
- DX Phase 2b (toward 0.3.0): three opt-in named selection handlers —
  `map.clickSelect`, `map.boxSelect`, `map.lassoSelect` (each a `Handler`
  with `enable/disable/isEnabled/setOptions/getOptions`). Driven by the
  Phase-2a pointer arbiter; `box`/`lasso` sit above `dragPan` so
  `shift`+drag selects (when enabled) instead of panning, with no
  `addControl` needed. Shared pure `resolveMode` (configurable
  modifier→`SelectMode` table) and a shared `select-geometry` module
  replace the duplicated private `_modeFromEvent`. `boxSelect` and
  `lassoSelect` are mutually exclusive (`enable()` throws if the other is
  on). Disabled by default → `new Emap()` behavior is unchanged; the
  legacy `BoxSelectControl`/`LassoSelectControl` keep working unchanged
  (thin-shell rewrite is Phase 2c).
- DX Phase 3 (toward 0.3.0): delegated feature events —
  `map.on('feature:click'|'feature:hover'|'feature:enter'|'feature:leave',
  { source?, layers? }?, cb)`. Fed by the Phase-2a pointer arbiter, hit-test
  reuses the existing `FeatureQuery` (no new path), decoupled from
  selection. Zero cost when no `feature:*` listener is registered (the
  pointer sink is installed lazily). Canonical highlight recipe:
  `map.on('feature:enter', {}, e => map.setHighlightedFeatures([e.ref]));
  map.on('feature:leave', {}, () => map.clearHighlightedFeatures());` —
  replaces the manual mousemove-poll + highlight-sync boilerplate.
- DX Phase 5 (toward 0.3.0): vertex editing is now the arbiter-driven
  `map.vertexEdit` handler (`enable/disable/isEnabled/setOptions/
  getOptions`), consistent with the other handlers — usable without
  `addControl`. The arbiter gained a `contextmenu` event kind (right-click
  vertex delete). `VertexEditControl` is now a button-only thin shell over
  `map.vertexEdit`; its public class, constructor options, button DOM,
  `editmodechange`/edit-mode behavior, undo commands, and the
  `vertex_moved` event are byte-identical. Disabled by default →
  `new Emap()` behavior unchanged. (P4 will migrate the context-menu
  inline styles to CSS tokens.)

### Documentation

- Documented the explicit 0.2.0 loading contract: `setData()` resolves only
  after the dataset is populated and `data{reason:'load'}` has fired, and
  `map.addSource()` is order-independent (back-fills an already-loaded
  source). Added a troubleshooting note — a blank map with no error after
  "upgrading to 0.2.0" is the *pre-0.2.0* fire-and-forget symptom and
  indicates a stale install, not an emap defect (a reopened Friction #9
  report was root-caused to this; the published 0.2.0 runtime was verified
  to settle the promise after the data event).
- Modernized all 41 `test/examples/*.html` to the canonical awaitable
  recipe (`await source.setData(...)` → `map.addSource(...)` →
  `map.setExtent(...)` in a `try/catch`), replacing the older event-driven
  `source.on('data'/'error')` load pattern. Examples now match the README
  "Loading contract" verbatim, removing the example/doc divergence that
  contributed to the reopened #9 misdiagnosis. Per-file status text,
  post-load logic, and multi-file/Promise-wrapper variants preserved.

### Tested

- Added `src/map/setdata-addsource-ordering.test.ts`: end-to-end regression
  proving both `addSource`→`await setData` and `await setData`→`addSource`
  populate the dataset before the promise resolves and schedule a render
  (guards the loading contract against regression).

## [0.2.0] - 2026-05-17

### Changed

- **BREAKING:** `TopologySource.setData()` now returns
  `Promise<TopologySource>` instead of `this`. It resolves once the import
  completes and rejects if it fails, so `await source.setData(...)` is now the
  canonical way to wait for the dataset (previously `await` resolved on the
  next microtask, before the data existed — a silent footgun that left the
  map blank). The `data` / `error` events still fire unchanged for
  event-driven consumers, and last-write-wins semantics are preserved (a
  superseded call's promise resolves early so awaiting it never hangs).
  Fluent chaining off the return value (`source.setData(x).getLayers()`) no
  longer works — `await` first. `fromUrl` / `fromBytes` now delegate to the
  awaitable `setData` internally.
- `TopologySource.getLayers()` is now typed `MapshaperLayer[]` instead of
  `any[]`, so `name` / `geometry_type` are reachable without an `any` cast at
  every consumer. Runtime behavior is unchanged (additive type only).

### Fixed

- Corrected `test/examples/*.html` (`box-select`, `draw-snap-edge`,
  `lasso-select`, `polygon-fill`) that passed the camelCase `sourceLayer` key
  to `addLayer` specs. The `LayerSpecification` only reads the canonical
  MapLibre-style `'source-layer'`, so the camelCase key was silently ignored
  and resolution fell back to the first layer — a real bug in `polygon-fill`,
  which targets a specific layer. Examples now use `'source-layer'`.
- `npm run dev-build` was broken: the `prefer-browser-mapshaper-modules`
  Rollup plugin only matched the terser-minified ternary form of mapshaper's
  module loader, so it patched the production vendor but threw `Unable to
  patch mapshaper module loader` on the unminified dev vendor (terser does
  not run in dev). `dist/emap-dev.js` — referenced by every
  `test/examples/*.html` — could not be built at all. Added a second pattern
  matching the unminified `if / else-if / else` loader block and reordering
  it to prefer `window.modules` over `require` (same intent as the minified
  path). Dev and prod builds now both patch the vendor correctly.

## [0.1.3] - 2026-05-17

### Fixed

- Made the browser mapshaper vendor loader prefer `window.modules` before any
  bundler-injected `require` shim. This closes the remaining Vite dev
  dep-optimizer failure where esbuild could make `require` truthy and trigger
  `Dynamic require of "iconv-lite" is not supported` on file upload.
- Added an esbuild pre-bundle smoke test for the shipped ESM entry so this
  Vite dev failure mode is covered in CI.

## [0.1.2] - 2026-05-16

### Fixed

- `import "@zwishing/emap"` is now self-contained in any browser bundler.
  mapshaper is no longer routed through CommonJS in the ESM build (which could
  emit a dead `require("adm-zip")` and a runtime-throwing `iconv-lite` helper);
  it ships as a sibling ES module `dist/mapshaper-vendor.mjs` that `dist/emap.mjs`
  imports by relative path. This **supersedes the 0.1.1 inlining approach** —
  consumers can remove any `mapshaper`->browser alias, `Buffer` polyfill, or
  band-aid tests.

## [0.1.1] - 2026-05-16

### Added

- Exported `MapOptions` from the package root for typed constructor options.
- Added `TopologySource.fromBytes(...)` for in-memory file and upload flows.
- Documented bundler, stylesheet, and worker asset integration for
  `@zwishing/emap`.

### Fixed

- Bundled mapshaper into the browser ESM entry so Vite/esbuild consumers no
  longer need an app-level `Buffer` polyfill for local file parsing. _(Interim
  approach — superseded in 0.1.2 by an externalized sibling ESM vendor.)_
- Changed `BasemapControl` to load MapLibre on demand instead of pulling it
  into the root entry at import time.
- Corrected README package names and worker option examples.

## [0.1.0] - 2026-05-16

Initial public release.

### Added

- Topology-based rendering of Mapshaper datasets to HTML5 Canvas 2D with
  shared-arc reuse, batched-stroke optimization, and level-of-detail for
  large datasets.
- Multi-format loaders: GeoJSON, TopoJSON, ZIP Shapefile (with per-archive
  resource limits).
- Interactive editing: pan, wheel-zoom, hover, plus vertex / feature /
  topology-aware editing.
- 30+ data operations under `emap.ops.*` (clip, erase, dissolve, buffer,
  simplify, project, snap, clean, mosaic, union, divide, …).
- Off-thread execution via `MapshaperWorkerPool` with command-family-aware
  worker routing.
- Undo / redo with command coalescing, dataset-replace barriers, and
  structured `OpResult` errors.
- Selection model (single / multi / box / lasso) and session snapshot
  pack / unpack.
- Geographic projections (EPSG / WKT / Proj.4 / mproj).
- Built-in UI controls: navigation, status, basemap, vertex edit, feature
  draw, history, box / lasso selection, simplify.
- Distributed control stylesheet as `dist/emap.css` (importable via
  `@zwishing/emap/style.css`).

[Unreleased]: https://github.com/zwishing/emap/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/zwishing/emap/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/zwishing/emap/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/zwishing/emap/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/zwishing/emap/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/zwishing/emap/releases/tag/v0.1.0

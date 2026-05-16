# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `import "@zwishing/emap"` is now self-contained in any browser bundler.
  mapshaper is no longer routed through CommonJS in the ESM build (which could
  emit a dead `require("adm-zip")` and a runtime-throwing `iconv-lite` helper);
  it ships as a sibling ES module `dist/mapshaper-vendor.mjs`. Consumers can
  remove any `mapshaper`->browser alias, `Buffer` polyfill, or band-aid tests.

## [0.1.1] - 2026-05-16

### Added

- Exported `MapOptions` from the package root for typed constructor options.
- Added `TopologySource.fromBytes(...)` for in-memory file and upload flows.
- Documented bundler, stylesheet, and worker asset integration for
  `@zwishing/emap`.

### Fixed

- Bundled mapshaper into the browser ESM entry so Vite/esbuild consumers no
  longer need an app-level `Buffer` polyfill for local file parsing.
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

[Unreleased]: https://github.com/zwishing/emap/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/zwishing/emap/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/zwishing/emap/releases/tag/v0.1.0

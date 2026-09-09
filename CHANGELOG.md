# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.1] - 2026-09-09

### Maintenance

- Republished the current `v0.10.0` release line after the release verification
  gate passed across builds, tests, browsers, documentation, and package audits.

## [0.10.0] - 2026-09-09

### Added

- Layer display filters: `addLayer({ filter })`, `map.setFilter(id, expression)`,
  and `map.getFilter(id)` apply a MapLibre-subset boolean expression per render
  layer so only matching features render, hit-test, and highlight. Data is
  untouched, filters never enter undo history, and `setFilter` fires
  `layerchange` with reason `'filter'`. Attribute tables can bind the filtered
  view via `map.features.iterFiltered(renderLayerId)` /
  `map.features.countFiltered(renderLayerId)`; the unfiltered `iter()`/`count()`
  keep their full-data semantics. A non-boolean evaluation result deactivates
  the filter and fires a structured `error` event carrying `layerId`,
  `filterExpression`, and `valueType`.


## [0.9.2] - 2026-09-09

### Fixed

- The public entry now re-exports `setDatasetCrsMetadata`, which was declared in
  `dist/geo/crs-resolver.d.ts` but unreachable from `@mapseekai/emap`. Consumers
  no longer need to mirror the helper to set explicit CRS metadata on detached
  datasets before map attach. The coordinates/CRS guide documents the function
  in both languages.

### Security

- Upgraded `maplibre-gl` to `^6.4.1` to patch a critical XSS sanitizer bypass in
  `DOM.sanitize()` (advisory 1193680). New high-severity `js-yaml` and `svgo`
  advisories reachable only through the Docusaurus documentation toolchain were
  reviewed and added to the dated audit allowlist.

## [0.9.1] - 2026-09-08

### Added

- Added a getting-started KML viewer example with a bundled fixture.

### Changed

- Refreshed the README and bilingual documentation around the current API and
  consolidated colocated tests, including DuckDB integration-test discovery.

### Fixed

- Direct KML input is decoded correctly, and the browser bundle now registers
  `@tmcw/togeojson` for KML conversion.

- Measurement and drawing previews now use a separate Canvas overlay with
  animation-frame coalescing, avoiding full layer redraws on every pointer move
  and preserving fast navigation while measuring, drawing, reshaping, or
  auto-completing polygons.
- New-feature snapping rejects distant arcs by their bounding boxes before
  inspecting vertices and segments, reducing cursor latency on large datasets.
- Auto-complete polygon submission now plans against a local mini-dataset and
  commits an undoable in-place geometry patch instead of cloning and rebuilding
  the entire dataset. Shared boundaries, attributes, selection, and undo/redo
  are preserved; ambiguous or distant boundary closures fall back to complete
  geometry planning to avoid missing faces.

## [0.9.0] - 2026-09-07

### Added

- Added `release:verify` as the single complete gate for CI, local npm publication,
  and release-tag publication, including the real-browser and Canvas pixel checks.
  Generated API page and anchor links are now validated in both documentation languages.
- Added regression coverage for null geometries, nearest-neighbor field collisions,
  deterministic ordering, stale writeback, literal tool IDs, and required output destinations.
- Added DuckDB example pages for every remaining `duckDbToolbox` processing tool:
  densify, multipart-to-singlepart, extract-vertices, point-to-line,
  line-to-polygon, polygon-to-line, near, nearest, spatial-filter, spatial-join,
  attribute-join, dissolve, collect, merge, append, and reproject, plus a
  `duckdb-toolbox` page demonstrating `duckDbToolbox.search()`/`execute()`. The
  DuckDB overlay example now also offers clip, union, and symmetric-difference,
  and a shared coverage test maps all 43 toolbox tools to example
  actions/pages.
- Added a unified browser-side DuckDB Processing Toolbox covering Overlay, Proximity, Aggregate, Join, Geometry, Transform, Selection, Data Management, and Attribute tools. `duckDbToolbox` is the canonical Agent/UI/workflow registry and all tools reuse the shared Arrow → DuckDB-Wasm → dataset pipeline.
- Added the canonical short processing APIs, including `spatialRelation`, `spatialJoin`, and `spatialSummaryJoin`, with Agent-oriented metadata, semantic aliases, parameter schemas, and a unified `duckDbToolbox.execute()` entry point.
- Added `map.ops.fillRing()` and the `fill` mode of `map.ringEdit` to turn an
  existing polygon hole into a new feature that reuses the hole's boundary
  arcs. The advanced edit toolbar now exposes a **Fill Hole** action, and the
  public `FeatureAppendCommand` / `FeatureAppendCommandOptions` API supports the
  underlying undoable append workflow.
- Added attribute-driven fill styling. `map.ops.classifyFeatures()` can classify
  records with quantile, equal-interval, nice, or categorical methods and bake
  mapshaper-compatible `fill`, `stroke`, `stroke-width`, or `r` fields. The
  operation is undoable, returns a stable `ClassificationResult`, supports an
  explicit null color, and publishes defensive copies of caller-owned arrays.
  Rendering baked fields is opt-in through `styleSource: 'mapshaper'`; class
  counts above the normal 256-bucket budget still render and emit a `warning`.
- Added a validated `fill-color` expression subset for `get`, `match`, `step`,
  linear `interpolate`, comparisons, and boolean composition. Expression results
  are cached by expression, dataset identity, layer, and `attributeVersion`, then
  rendered through Canvas fill buckets to avoid per-feature state changes.
  `StyleExpression` and `bumpAttributeVersion()` are now public APIs.
- Added real-browser smoke coverage for the generated example catalog, GeoJSON
  loading, Canvas painting, pointer interaction, and wheel navigation in Chrome,
  Firefox, and WebKit.
- Added spatial-index render candidates. Layers with at least 10,000 shapes
  prebuild a Flatbush index during source loading, shared with feature queries;
  point, line, and fill rendering visit only the indexed viewport candidates
  when the view covers less than a quarter of the layer extent, and keep the
  direct scan otherwise. Classified line buckets additionally cache each style
  bucket's ordered arc list, keyed by geometry revision.

### Changed

- Pan and zoom now reuse the existing canvas bitmap once a full draw exceeds a
  30fps budget (about 33 ms, previously 100 ms), and redraw at full quality
  after the interaction ends. A full frame rendered partway through a gesture
  rebases the fast-navigation transform instead of compounding stale deltas.
- **Breaking:** the DuckDB tool metadata types drop the `Spec` suffix:
  `DuckDbToolInputSpec` → `DuckDbToolInput`, `DuckDbToolParameterSpec` →
  `DuckDbToolParameter`, `DuckDbToolObjectPropertySpec` → `DuckDbToolObjectProperty`,
  and `DuckDbToolOutputSpec` → `DuckDbToolOutput`.

- **Breaking:** all four DuckDB map-adapter options now require `output.sourceId`.
  `DuckDbMapOpContext.setSourceDataset` must commit synchronously and return `undefined`;
  reuse a stable context/source collection so source versions and request generations can
  be validated atomically before writeback. Stale results return `stale-operation`.
- `DuckDbToolId` now preserves the literal union of actual tool IDs instead of widening
  to `string`. `near` and `nearest` reject unknown CRS by default; `nearest` also rejects
  geographic CRS and conflicting output column names.
- Unreleased documentation uses the explicit `verifiedVersion: unreleased` marker rather
  than claiming validation against a future version. See `docs/release-checklist.md` before tagging.
- Ring and multipart operations (`addRing`, `deleteRing`, `addPart`,
  `deletePart`, and `fillRing`) now commit reversible in-place commands instead
  of replacing an entire dataset. Consecutive edits preserve dataset identity,
  support multi-level undo/redo, and avoid cloning the dataset for every action.
  Deleting rings or parts no longer compacts the live arc collection; MSX export
  compacts an isolated copy so orphan arcs are not serialized.
- `map.ops.reshapeSelected()` and `map.ops.splitSelected()` now use isolated
  mini-dataset planning followed by direct patch commands. Line and polygon
  changes preserve shared-arc ownership, simplified-arc lineage, unselected
  neighbour geometry, and the original live dataset identity. Multi-source
  reshape is prepared atomically and recorded as one composite history entry.
- Dataset state now tracks geometry and attribute changes independently through
  `editVersion` and `attributeVersion`. Attribute commands invalidate style
  caches without forcing geometry-index rebuilds, while stale operation checks
  compare both versions before committing asynchronous results.
- Worker routing now uses record count for `classify` workloads, so large
  attribute operations can offload even when vertex count is near zero. The
  `workerRouting` documentation now demonstrates a real application override
  instead of returning the default decision unchanged.
- Custom `MapshaperAdapter` implementations must now provide the batch arc APIs
  `appendArcs`, `truncateArcs`, and `createArcCollection`. Long ring, part, and
  split writes use batched allocation/truncation while preserving retained
  intervals and simplification thresholds. The old compatibility shims were
  removed after all edit commands migrated to the canonical adapter boundary.
- DuckDB named geometry, attribute, relation, and overlay internals continue to share descriptor-backed dispatch, while `@mapseekai/emap/duckdb` is now organized around the canonical Processing Toolbox API. Examples, README content, and DuckDB documentation use the new tool names consistently.
- `apache-arrow`, `parquet-wasm`, and `@duckdb/duckdb-wasm` are now optional peer
  dependencies rather than mandatory core dependencies. Applications importing
  the Arrow or DuckDB subpaths must install the integrations they use; core-only
  consumers no longer receive these packages through the normal runtime graph.
- The published compatibility baseline is now Node.js `>=22.18 <25`, ES2022,
  Chrome/Edge 109+, Firefox 115+, and Safari 16.4+. TypeScript compilation uses
  bundler module resolution for the package's optional export subpaths.
- `MapshaperOps` now creates one stable operation context per facade instance
  instead of rebuilding the same host proxy object and closures for every call.

### Removed

- Removed the unshipped, unused DuckDB IIFE build; the published DuckDB entry remains ESM-only.
- **Breaking:** removed all legacy DuckDB executor/registry APIs and `xxxDatasetWithDuckDb` helper names from `@mapseekai/emap/duckdb`. Migrate directly to the final short APIs such as `attributeFilter`, `intersect`, `clip`, `repairGeometry`, `spatialJoin`, `spatialSummaryJoin`, and `spatialRelation`. Toolbox discovery/execution is now exposed only through `duckDbToolbox.*`; the duplicate `DUCKDB_TOOLBOX`, `listDuckDbTools`, `getDuckDbTool`, `requireDuckDbTool`, `searchDuckDbTools`, and `executeDuckDbTool` exports were removed. Unused map adapters `duckDbBufferLayer`, `duckDbGeometryLayer`, `duckDbRelationLayer`, and `duckDbAttributeLayer` were also removed; the actively used source/map adapters remain `duckDbAttributeFilterLayer`, `duckDbGeoParquetQueryLayer`, `duckDbOverlayLayer`, and `duckDbSpatialSummaryJoinLayer`. The old registry/executor implementation paths are no longer part of the runtime architecture.
- Removed the obsolete public exports `quoteCliArg`, `isValidLayerName`,
  `HighlightFeatureRef`, and `LassoStyle`. Internal compatibility aliases,
  string-command runner paths, duplicated control contracts, and superseded arc
  helpers were also removed.
- Removed generated TypeDoc HTML/JSON from version control. API reference output
  is rebuilt by `api:build`, `docs:build`, and release verification instead of
  being maintained as a second tracked copy of the public API.
- Replaced completed `docs/superpowers` implementation plans with concise
  architecture decision records under `docs/decisions`; legacy `docs/adr`
  locations now contain compatibility pointers only.

### Fixed

- DuckDB reprojection retains null-geometry records, attributes, and the geometry type
  of all-null or empty inputs instead of silently filtering records out.
- Nearest-neighbor analysis isolates internal row IDs from user fields, keeps input
  order, resolves distance ties by reference row order, and returns null matches for
  empty geometries or an empty reference layer without losing records.
- DuckDB map adapters reject results after input/output replacement, edits, CRS or
  byte/query-source changes, or a newer request to the same output. Independent outputs
  remain concurrent; examples now reuse stable context and source objects.
- Corrected eight stale API links, point/line styling type documentation, and the
  documented GitNexus status command.
- Transaction rollback now reverse-undoes captured in-place commands and reports
  undo failures, so mixed direct-edit and dataset-replacement transactions no
  longer leave partially applied edits behind.
- Direct reshape and split operations now reject stale queued plans, own their
  selection snapshots, undo composite changes atomically, preserve shared arcs,
  translate only live mini-dataset arcs, and retain source arc provenance after
  simplification. These fixes prevent selection drift, neighbour corruption,
  extra arc reuse, and partial multi-source commits.
- `fillRing()` now targets the correct hole in multipart features, reuses
  multi-arc boundaries safely, and does not manufacture an attribute record for
  layers without a data table.
- Restored all descriptor-backed DuckDB relation routes, including `overlaps`,
  `equals`, `crosses`, `covers`, `coveredBy`, `containsProperly`, `distance`, and
  `distanceWithin`, in both filter and attribute modes. Invalid distance values
  are again reported before geographic-CRS validation, and validation failures
  retain the DuckDB error kind and field metadata.
- Optional `@mapseekai/emap/arrow` and `@mapseekai/emap/duckdb` imports now resolve
  correctly in the examples and in consumer projects using modern TypeScript
  module resolution.
- Public declaration generation no longer leaks the internal
  `NormalizedDatasetCommit` type through `PreparedDatasetCommit`, and EPSG data
  constants no longer expand their full lookup tables into `.d.ts` files.
- Repaired the bilingual public API catalog and TypeDoc associations for newly
  added commands, fill-ring options, classification APIs, style expressions,
  and DuckDB SQL helpers.

### Security

- Rebuilt `SimplifyControl` dynamic form content with DOM APIs and runtime value
  validation instead of interpolating option values into `innerHTML`, removing
  the attribute-injection path available to untyped JavaScript callers.
- Hardened ZIP imports by upgrading `fflate` to `0.8.3`, rejecting
  case-insensitive duplicate basenames instead of silently overwriting
  Shapefile sidecars, and enforcing separate configurable 2 GiB compressed and
  uncompressed defaults before download, allocation, and extraction.
- Patched vulnerable runtime dependency chains for XML, ZIP, multipart form,
  protobuf schema, and query-string handling. Production auditing now fails
  closed for new, expired, non-documentation, critical, or unclassified findings;
  explicitly reviewed documentation-tool findings are kept in a dated allowlist.

### Documentation

- Reworked the root and bilingual documentation around the current source,
  layer, operation, interaction, control, selection, worker, error, Arrow,
  DuckDB, MapLibre, KML, FlatGeobuf, and compatibility contracts. The root
  README files now provide a compact entry point and defer detailed workflows to
  the documentation site.
- Consolidated the runnable-example inventory into one typed manifest used by
  Vite, the catalog UI, fixture loading, docs checks, and TypeDoc example links.
  The previous TypeScript AST parser and duplicate route list were removed.
- Simplified the TypeDoc plugin to internal-host filtering and runnable-example
  association; public API ownership and accidental root exports are now checked
  directly from source.

### Development

- Expanded pull-request and release gates to cover formatting, type checking,
  explicit public API surface checks, unit tests, production builds, bundle
  smoke checks, all DuckDB-Wasm integrations, documentation and example
  contracts, package dry runs, and production dependency auditing. DuckDB and
  browser suites run in independent jobs to keep core feedback fast.
- Added package-export existence checks, browser-runtime import checks, a minimum
  Node.js compatibility job, shared CanvasPainter test fixtures, and a
  reproducible security-audit policy with tests.
- Reduced repository maintenance state by removing tracked generated API files,
  shrinking duplicate README and planning content, simplifying documentation
  tooling, and preventing future EPSG declaration-size regressions.

## [0.8.1] - 2026-08-29

### Fixed

- MapLibre Style overlays now preserve top-level zoom-driven `step` and
  `interpolate` image expressions while namespacing sprite references, so
  OpenFreeMap Bright symbol layers pass native MapLibre validation.

## [0.8.0] - 2026-08-28

### Added

- MapLibre overlay services now accept complete Style v8 URLs or JSON, including
  managed sprite, glyph, source, layer, visibility, update, removal, error, and
  cancellation lifecycles. Overlay resources are namespaced, background layers
  are ignored, and conflicting glyph URLs are rejected deterministically.
- `map.ops.splitSelected({ cutter })` now splits the current same-source,
  same-layer selection: line features accept point or polyline cutters, while
  polygon features accept polyline cutters. Pieces copy the original attributes
  and replace the selection; `map.splitFeature` provides the interactive workflow.
- `map.ops.reshapeSelected({ line })` and the interactive `map.reshapeFeature`
  handler now reshape line and polygon features along a user-drawn line. Like
  QGIS, no selection is required: every feature the line contacts is reshaped;
  the `reshape-ring-part` example and editing guide document the workflow.
- `map.vertexEdit` now supports box-selecting vertices, Shift-additive box
  selection, group dragging, and Delete/Backspace batch deletion; the
  `reshape-ring-part` example demonstrates the workflow.
- `map.ops.addRing({ ring })` and `map.ops.deleteRing({ point })`, together
  with the `map.ringEdit` handler, now add and remove interior polygon rings.
  No selection is required: holes are added to the polygon containing the
  sketch and removed by clicking inside them; the `reshape-ring-part` example
  and editing guide document the workflow.
- `map.ops.addPart({ coordinates })` and `map.ops.deletePart({ point,
  tolerance? })`, together with the `map.partEdit` handler, now add and remove
  independent line or polygon parts. Adding a part requires one selected
  target feature; deleting a part is selection-free, and removing a feature's
  last part deletes the whole feature; the `reshape-ring-part` example and
  editing guide document the workflow.
- `EditToolbar` now accepts `advancedTools: true` to expose built-in reshape,
  add/delete hole, and add/delete part controls.
- `HighlightStyle` gains `fillOpacity` so highlighted polygon interiors can
  render filled instead of outline-only; the `reshape-ring-part` example now
  fills its selection highlight.

### Changed

- Custom `MapshaperAdapter` implementations must implement the new arc
  insertion, polygon mosaic and ring normalization, shape metric, and arc
  cleanup methods: `appendArc`, `insertCutPoints`, `buildPolygonMosaic`,
  `splitSelfIntersectingPolygonRings`, `getShapeArea`, `getShapePerimeter`,
  `getShapeAnchor`, and `cleanArcReferences`. `ArcCutPoint` is now exported.

### Fixed

- Polygon editing validation now follows GEOS/OGC ring-contact semantics:
  rings that merely touch at an isolated point (e.g. a hole vertex snapped
  onto the shell by upstream simplification) no longer make a feature
  uneditable in `addRing`/`deleteRing`/`addPart`/`deletePart`; proper
  crossings and shared edges are still rejected.
- Ring editing no longer analyzes the whole dataset's ring topology per click:
  `addRing`/`deleteRing` prefilter features with a point-in-ring containment
  test and only run exterior grouping / segment extraction for candidates
  (feature scan 6.7s → 0.16s on a 3.6M-vertex land-use dataset).
- Shapefile-only imports (including ZIP bundles), TopoJSON and GeoParquet
  imports now restore tangent holes encoded inside one pinched polygon part
  before CRS normalization. Nested opposite-winding pieces remain holes;
  non-contained lobes are reoriented as separate exteriors instead of
  becoming orphan holes, so `addRing`/`deleteRing` match QGIS without losing
  geometry.
- Reshape, ring, and part editing no longer freeze the UI on complex polygons:
  segment-conflict validation now uses a Flatbush broad-phase index instead of
  O(S²) all-pairs scans, ring/part ops validate the geometry once per
  operation instead of twice, and ring/part sketch snapping rejects vertices
  outside the snap box before projecting.
- Reshaping a large polygon no longer stalls for seconds: new arcs are now
  written with one batched allocation (`MapshaperAdapter.appendArc`) instead of
  mapshaper's per-vertex insert, which copied the whole vertex table on every
  point.
- Reshape no longer silently skips a feature when the sketch continues past
  it: clip boundaries that land on a sketch vertex now snap to the exact
  vertex instead of emitting near-duplicate vertices that read as
  self-intersections.
- `map.ops.mergeSelected()` now performs a true polygon union that removes shared and
  overlap-internal boundaries without changing unselected geometry, and accepts a selected
  feature as the merged record's attribute source.
- `clickSelect` no longer consumes clicks while a modal edit mode (split, draw, …) is
  active, so `map.splitFeature` can place cutter points when both handlers are enabled.
- Splitting a closed ring line no longer yields one extra fragment: the trailing and
  leading pieces are now joined across the storage seam, so a ring cut at N points
  produces N pieces.

## [0.7.2] - 2026-08-24

### Fixed

- Vertex-edit overlays now retain 20% opacity for the default selection theme
  color, so hovering a shared topology node does not obscure its shared edge.

## [0.7.1] - 2026-08-24

### Fixed

- Detached `projectLayer` export now isolates CRS metadata and leaves the
  registered source dataset unchanged.

## [0.7.0] - 2026-08-24

### Added

- Source loading now provides a two-phase `preflightSource()` and
  `confirmSource()` workflow. Applications can parse and validate detached
  inputs, request missing CRS information without reading the data again, and
  confirm a single-use plan only after it is ready.
- The optional DuckDB module now supports six additional topological relation
  predicates: `overlaps`, `equals`, `crosses`, `covers`, `coveredBy`, and
  `containsProperly`. Each predicate is available through dataset filters,
  attribute helpers, and map-operation routing with target-first semantics.
- `createDuckDbRuntimeFromJsDelivr()` accepts `spatialExtensionUrls` for
  self-hosted DuckDB spatial extension files keyed by the selected `mvp`, `eh`,
  or optional `coi` bundle. The matching URL is fetched once and loaded from a
  fixed DuckDB in-memory file, so signed URLs and arbitrary filenames work
  without contacting DuckDB's extension repository on every session.
- DuckDB-Wasm spatial aggregate joins can now preserve a target layer while
  appending ordered `count`, `sum`, `avg`, `min`, and `max` results from a
  second dataset. The API supports ten spatial predicates and `left` or `inner`
  output modes, with dataset and map-operation entrypoints plus a runnable
  two-input example.
- Point layers now support the `circle-shape` paint property with circle,
  square, upward and downward triangles, diamond, pentagon, star, cross, X,
  hexagon, and octagon markers. A new runnable point-style example loads point
  data and demonstrates live shape, color, radius, opacity, and stroke updates.
- Line layers and polygon outlines now support device-pixel-aware
  `line-dasharray` values and named `line-dashstyle` presets. The new
  `arrow-dot` style renders batched directional markers with configurable
  screen-space spacing and size; the runnable line-style example exposes all
  solid, dashed, dotted, dash-dot, and directional controls.
- ZIP Shapefile imports can now load every `.shp` dataset in an archive as a
  separate layer. A new runnable Shapefile viewer supports archive-detected,
  preset, or custom input CRS selection before registration.
- Spherical measurement tools now report per-segment lengths and centroid-based
  polygon area totals, with runnable measurement examples and public APIs.
- DuckDB geometry, attribute, and spatial-relation operations now have
  dedicated runnable example routes with shared source, layer, CRS-recovery,
  and result-display behavior.

### Changed

- Dataset-replacement operations now run against isolated working copies,
  serialize per source, classify their effects centrally, and commit through one
  atomic path. Multi-source reprojection is likewise prepared before commit and
  is now one undoable history entry.
- Source registration is now awaitable and enforces one active map CRS:
  the first loaded source establishes the CRS, later imports normalize before
  commit, and map-wide reprojection keeps every registered source synchronized.
  Display-only CRS changes and per-source CRS divergence are rejected.
- Public source datasets and map camera state now expose read-only or cloned
  views. Layer specifications are a discriminated union, layer lookup is
  centralized in `LayerRegistry`, and source processing uses the unified
  `MapshaperAdapter` contract.
- The runnable-examples catalog now groups recipes into map/data,
  styling/interaction, editing, and analysis modules, with bilingual category
  navigation and search across titles, APIs, tags, and IDs.
- Runnable examples now open their exact bundled HTML in an in-page **View
  source** dialog and syntax-highlight it with Prism, without navigation or a
  runtime network request.
- Built-in Canvas colors, selection/edit overlays, controls, popups, and menus
  now resolve semantic Mapseek theme variables from each map host, including
  local and dark themes. Controls use a shared accessible SVG icon set, and the
  Home/reset action fits the current registered-source extent.
- The former point-layer example is now identified as a feature-to-point
  conversion example and demonstrates centroid, vertex, endpoint, and
  interpolated point generation from polygon and line inputs.

### Fixed

- TypeDoc generation now classifies intentionally internal symbols explicitly,
  resolves all public JSDoc links, and treats future documentation warnings as
  build failures.
- Feature-event filtering and one-shot registration now dispatch consistently,
  while source removal, map teardown, vertex context menus, and worker failures
  release their listeners, pending jobs, highlights, indexes, and caches.
- Transactions now wait for tracked asynchronous operations without leaking
  rejected cleanup promises, and destructive history barriers release obsolete
  command payloads while preserving one unavailable-history boundary.
- The DuckDB spatial-operations example now processes the live registered
  datasets instead of retaining original/display copies, and multi-input DuckDB
  operations align secondary datasets to the active input CRS.
- The DuckDB envelope example now imports and invokes its public helper
  correctly, instead of failing before the DuckDB runtime is initialized.
- DuckDB overlay functions now serialize their internal geometry results to
  standard WKB before crossing the Arrow boundary, so overlay outputs import as
  valid emap geometry.
- Internal source, layer, and feature lookups now use structured keys, so legal
  public IDs containing delimiters cannot alias visibility, selection, event,
  highlight, or render-cache state.
- Registering a source now clears undo/redo history (matching source removal),
  so undoing an earlier map reprojection can no longer strand newly added
  sources on a stale CRS. Normalization commits re-validate the owning
  registration and the active map CRS at the last moment, per-source
  reprojection of a managed source rechecks the owning map's CRS before
  committing, and map reprojection aborts when any registered source loads or
  the registry changes during preparation. Undo history is likewise dropped
  when a source loads data outside the command history. The DuckDB
  spatial-operations example re-applies a changed input CRS by re-importing
  the original upload through a fresh source registration, discarding stale
  outputs and in-flight results.

### Performance

- Point rendering culls offscreen features; line and polygon rendering reuse
  cached layer arc IDs and avoid hot-path iterator and array allocations.
- Full-frame timing no longer forces synchronous Canvas pixel readback.
  Attribute-only operations retain unchanged geometry, and bulk feature undo
  restores records in linear time.

## [0.6.0] - 2026-07-29

### Added

- A bilingual Docusaurus documentation site now covers installation, core
  concepts, sources and layers, topology, styling, camera control, selection,
  editing, events, data operations, formats, DuckDB, workers, recipes, and
  reference material.
- Generated TypeDoc API documentation is published inside the documentation
  bundle with local navigation, complete public-contract metadata, and links
  back to the matching guides and runnable examples.
- A canonical `@mapseekai/emap-examples` workspace now publishes runnable
  examples at stable `/mapseekai/emap/examples/` routes. The catalog includes
  getting-started maps, interaction and editing workflows, map operations,
  import/export, Worker usage, and DuckDB spatial processing.
- Vertex editing now provides topology-aware shared-node deletion and an
  undoable **Separate shared node** action that duplicates shared arcs and
  remaps only the selected feature.

### Changed

- The public package, repository, and documentation deployment moved from
  `zwishing` to `mapseekai`: install `@mapseekai/emap`, and use the
  `/mapseekai/emap/` documentation and examples base path.
- The optional Arrow integration has moved from `@mapseekai/emap/formats` to
  `@mapseekai/emap/arrow`, with source, declarations, bundles, examples, and API
  documentation renamed accordingly. The old module path is no longer exported.
- Legacy and generated example placeholders were replaced by canonical,
  metadata-driven routes using one shared runtime, shared branding, and
  packaged fixture manifests.
- The jsDelivr DuckDB-Wasm runtime now serializes Arrow tables to IPC streams
  before insertion, matching the browser DuckDB connection API. Bundled
  GeoJSON-based DuckDB examples now default their source CRS to `EPSG:4326`.

### Fixed

- Default Vitest runs now cap worker concurrency to avoid resource-driven test
  timeouts, while DuckDB-Wasm integration files run in isolated processes so
  blocking database instances cannot stall later files.
- The shared-node editing APIs are now cataloged in both documentation locales
  with complete public API metadata.
- Shared topology nodes can now be deleted as one node across shared edges or
  coordinate-matched features. Endpoint deletion inserts shared bridge arcs so
  polygon and polyline rendering keeps every surviving edge, while features
  below their geometry minimum are removed atomically.
- Shared-node classification now uses the vertex owned by the selected feature,
  ignores repeated nodes that occur only inside one feature, and remains stable
  when coincident-feature hit-test order changes.
- Opening the context menu no longer loses the pending shared-node separation
  when window-level pointer movement clears hover state. The selected feature,
  node coordinates, and detached vertex IDs are restored after the menu action.
- Vertex snapping now promotes a node to a shared topology node after it lands
  on another feature vertex, and clears stale detached-node state when a
  separated node is snapped back onto another feature.
- Runnable examples now recover cleanly from runtime failures, keep box and
  lasso selection modes mutually exclusive, and load GeoParquet starter data
  at the published route.
- `StatusControl` now displays Mapshaper CRS aliases such as `webmercator` and
  `wgs84` as canonical `EPSG:3857` and `EPSG:4326` identifiers.

## [0.5.0] - 2026-07-22

### Added

- Optional `@mapseekai/emap/duckdb` browser module, powered by DuckDB-Wasm and its spatial extension. It provides Arrow-backed dataset processing, GeoParquet byte queries, unary geometry operations, geometry-derived attributes, spatial relations, and overlay operations without adding DuckDB to the core bundle.

### Fixed

- `@mapseekai/emap/style.css` now resolves its TypeScript declaration through both modern conditional exports and legacy Node-style module resolution.

## [0.4.0] - 2026-06-10

### Performance

- Large topology navigation now follows a stronger fast-nav strategy: slow
  pan/zoom interactions transform the last committed canvas frame, mark a
  settle redraw as pending, and defer the real redraw until interaction settle
  without synchronously blocking pointer-up / wheel-end handlers.
- Full redraw timing now includes a one-pixel Canvas readback flush when the
  browser exposes `getImageData()`. This makes the scheduler account for the
  real Canvas Commit cost that dominates large datasets instead of measuring
  only JavaScript path construction.
- Pending settle redraws are tracked separately from normal redraws. A new nav
  frame can supersede an obsolete settle redraw during continued interaction,
  while ordinary data/style redraws are still preserved.
- Line and polygon-outline rendering now bounds `drawArcs()` batches by both
  arc count and vertex count, reducing worst-case `stroke()` / Canvas Commit
  stalls when a few arcs contain many vertices.
- Polygon fill rendering now filters offscreen polygon parts by viewport bounds
  before path iteration, batches by vertex budget, and avoids per-ring
  `closePath()` calls.
- Fill-only polygon layers with `line-width: 0` now skip outline arc-flag
  construction and stroke rendering entirely.
- Near-full-extent rendering still applies tiny-arc and viewport arc filtering,
  preventing dense datasets from sending every invisible or subpixel segment to
  Canvas.

### Fixed

- Vertex drag snapping and edit-node rendering now stay bounded to the current
  view/cursor area on large datasets, avoiding unbounded vertex scans and
  `Set maximum size exceeded` failures during edit interactions.

## [0.3.7] - 2026-06-07

### Fixed

- Large point datasets no longer freeze the renderer. `CanvasPainter.drawPoints()`
  accumulated every point into one Canvas2D path and filled it once, which is
  super-linear in Skia (an 80k-point fill measured ~18s and blocked the main
  thread, so the layer appeared not to render). It now flushes the path every
  100 points like `drawArcs()` / `drawPaths()`, keeping render time linear
  (~200ms at 200k points).
- Point sources whose extent has zero area (a single point, or coincident
  points) now produce a finite camera transform. `Bounds.fillOut()` expands a
  degenerate (zero width/height) extent to the target viewport aspect instead
  of deriving a `NaN` transform, so single-point datasets render centered.

## [0.3.6] - 2026-06-01

### Added

- `vertexEdit` and `transformFeature` now accept `layers?: string[]`, matching
  the selection handlers' layer-filter option so app-level edit filters can
  constrain both selection and editing hit-tests.
- Standard EPSG CRS inputs now resolve through `epsg-index` to Proj.4 before
  being handed to mapshaper / mproj, so the UI CRS picker can pass values like
  `EPSG:4490` and `EPSG:32633` to `map.ops.projectLayer()` and `map.reproject()`.
- Biome is now the project formatting baseline, with `format` and
  `format:check` npm scripts included in the release verification chain.

### Fixed

- `TopologySource.setData()` now derives import filenames from root-relative
  and other relative URLs without throwing, so browser calls like
  `setData('/data/roads.geojson')` keep the correct file extension for
  mapshaper import.
- Worker-backed mapshaper operations now clean up pending job state if
  `Worker.postMessage()` throws synchronously, preventing stuck promises and
  stale worker load accounting after clone/transfer failures.
- Worker results now transfer packed binary buffers back to the main thread
  instead of cloning them, reducing memory pressure on large dataset
  operations.
- `DrawFeatureControl` now unregisters its `editmodechange` listener on
  removal, and delegated feature hover state is cleared when the last
  `feature:*` listener is removed, avoiding stale event/control state after
  teardown.
- `BasemapControl` now guards asynchronous MapLibre initialization against
  `onRemove()` races and clears container/style references during teardown.
- Feature hit-testing now routes mapshaper geometry helpers through the
  `MapshaperAdapter` boundary instead of importing `mapshaper` directly from
  `FeatureQuery`.
- `dissolveLayer`, `linesLayer`, `joinTable`, `unionLayers`, and `divideLayer`
  now reject invalid field lists with structured validation errors instead of
  silently dropping bad field names and running a partial command.
- Painter interfaces now use the shared mapshaper shape types instead of
  `any[]`, tightening the renderer contract without changing rendering
  behaviour.
- `map.reproject()` now normalizes common EPSG aliases before calling mapshaper
  (`EPSG:3857` / `EPSG:900913` / `EPSG:102100` -> `webmercator`,
  `EPSG:4326` -> `wgs84`), avoiding browser `+init=epsg:*` lookup failures.
- `map.reproject()` now clears spatial indexes after reprojection so
  click/box/lasso hit-testing rebuilds against the new coordinate space.
- `map.reproject()` continues to reset the viewport initial line-scale state
  before fitting the reprojected extent, preventing outline widths from drifting
  after switching between degree- and meter-based CRS values.

## [0.3.5] - 2026-05-27

### Changed

- `normalizeCrsString` now preserves the original case of non-EPSG inputs
  instead of upper-casing everything. EPSG codes still normalize to
  `EPSG:NNNN`; passthrough values (Proj.4 strings, mapshaper aliases) keep
  their case so case-sensitive tokens like `+proj=utm` survive intact.

### Fixed

- `inferFromPrj` now recognizes ESRI's `WGS 1984 Web Mercator (auxiliary
  sphere)` WKT spelling and `Web Mercator` with a space, both of which
  previously fell through to the `EPSG:4326` default.

### Examples

- Added `test/examples/crs-switch.html` — one-click switching between WGS84,
  CGCS2000, Beijing 1954, Xi'an 1980, Lambert / Albers / Gauss-Krüger
  projections for China, and world projections (Robinson, Natural Earth,
  Winkel Tripel) on a built-in China dataset. Demonstrates `map.ops.projectLayer`
  and CRS-only history sync.
- Fixed `test/examples/project.html` preset list: `natural-earth` →
  `natearth`, `winkel3` → `wintri` (mapshaper's actual alias names).

## [0.3.3] - 2026-05-24

### Performance

- Slow pan/wheel navigation now reuses the previous rendered canvas frame via
  CSS transform while a full redraw is deferred until interaction end. The
  scheduler avoids synchronous canvas readback, preventing the zoom jank seen
  with `getImageData()`-based frame timing.
- Canvas stroke batching now flushes paths every 100 arcs/paths instead of 25,
  matching mapshaper's lower-overhead draw cadence for large topology renders.
- Viewport arc filtering skips per-arc checks near full extent and raises the
  minimum visible path threshold to 0.35px, reducing redraw work without
  changing zoomed-in detail.
- `DrawFeatureHandler._findSnapTarget` now filters candidate vertices and arc
  segments by a world-space bbox derived from the cursor's pixel `snapThreshold`,
  skipping `project()`/`hypot()` on points that cannot win. Removes the per-frame
  O(N) cost over the entire `xx/yy` arrays on large topologies, making snapping
  responsive on datasets with hundreds of thousands of vertices.

## [0.3.2] - 2026-05-23

### Added

- `EditToolbar` now accepts explicit `controls`, allowing examples and apps to
  compose toolbar buttons directly from existing UI controls.
- Added `draw-snap-clear.html` to demonstrate that draw snapping markers clear
  as soon as the cursor leaves the configured threshold.

### Changed

- Renamed the batch snapping example from `snap.html` to `snap-layer.html` to
  make its `snapLayer` purpose explicit.
- Upgraded the direct `mproj` dependency to `^0.1.2` while keeping the browser
  bundle self-contained.

### Fixed

- Draw snapping now clears stale snap overlays when the cursor moves outside the
  snap threshold before the first vertex is placed.
- Vertex editing can snap dragged nodes to other features' vertices or edges,
  controlled by `snapThreshold`, `snapToVertex`, and `snapToEdge`.
- `DrawFeatureControl` reapplies its own handler options when switching between
  draw buttons in a shared toolbar.
- `projectLayer` normalizes common EPSG aliases (`EPSG:3857`, `EPSG:900913`,
  `EPSG:102100`, `EPSG:4326`) to mapshaper's browser-safe CRS names.

## [0.3.1] - 2026-05-21

### Changed

- `boxSelect` now behaves like an active selection tool by default: plain
  left-drag starts a rectangular selection and replaces the previous selection,
  while `Shift`+drag adds to the existing selection and `Shift`+`Alt`+drag
  toggles matching features.
- `transform` edit mode keeps map panning available outside already-selected
  features; dragging selected features still starts a transform session.
- When pan or translate-transform mode is active and the pointer hovers an
  already-selected feature, the canvas cursor now switches to `move`; active
  map dragging still uses `grabbing`.

## [0.3.0] - 2026-05-21

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
- DX Phase 2c (toward 0.3.0): `BoxSelectControl` / `LassoSelectControl`
  are now button-only thin shells over the P2b `map.boxSelect` /
  `map.lassoSelect` handlers (the ~490 lines of duplicated
  listener/overlay/hit-test/select logic deleted) — public class,
  constructor options, 0×0 anchor DOM, selection behaviour, and the
  dashed-lasso visual are byte-identical (the handler now honours
  `strokeDasharray`, default `'4 3'`). Adding both controls now surfaces
  the handlers' mutual-exclusivity error instead of silently conflicting.
  Duplicated types consolidated to one declaration each with re-export
  shims (every public import path unchanged): `SelectMode` →
  `core/handlers/select-mode`, `BoxSelectStyle` →
  `core/handlers/box-select`, `LassoSelectStyle`/`LassoStyle` →
  `core/handlers/lasso-select` (`LassoStyle` widened additively to include
  the optional `strokeDasharray`). No arbiter/dispatch change.
- DX Phase 3 (toward 0.3.0): delegated feature events —
  `map.on('feature:click'|'feature:hover'|'feature:enter'|'feature:leave',
  { source?, layers? }?, cb)`. Fed by the Phase-2a pointer arbiter, hit-test
  reuses the existing `FeatureQuery` (no new path), decoupled from
  selection. Zero cost when no `feature:*` listener is registered (the
  pointer sink is installed lazily). Canonical highlight recipe:
  `map.on('feature:enter', {}, e => map.setHighlightedFeatures([e.ref]));
  map.on('feature:leave', {}, () => map.clearHighlightedFeatures());` —
  replaces the manual mousemove-poll + highlight-sync boilerplate.
- DX Phase 4 (toward 0.3.0): opened the emap design-token namespace —
  `controls.css` now declares 9 `--emap-*` custom properties on `:root`
  (`accent`, `accent-soft`, `surface-bg`, `surface-border`,
  `surface-shadow`, `radius`, `hover-bg`, `danger`, `font`) with the
  current literal values as defaults. The vertex-edit right-click menu
  ("删除节点") migrated off inline styles + JS `mouseenter`/`mouseleave`
  hover toggle onto class-based rules (`.emap-ctx-menu` /
  `.emap-ctx-menu-item` with `:hover`) consuming the tokens. Default
  rendering is byte-identical; themers override `--emap-*` on `:root` (or
  a parent) to restyle. Existing controls' literal values are unchanged
  — namespace opened but not retro-applied (follow-up phases may opt in).
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
- DX Phase 6 (toward 0.3.0): feature drawing is now the arbiter-driven
  `map.drawFeature` handler (`enable/disable/isEnabled/setOptions/
  getOptions`) — usable without `addControl`. The arbiter gained a
  `dblclick` event kind (finish polyline/polygon); `Escape`-to-cancel is a
  handler-owned key listener. `enable()` throws if `source`/`type` are
  unset. `DrawFeatureControl` is now a button-only thin shell over
  `map.drawFeature`; its public class, constructor options (incl. `icon`),
  button DOM, `feature_created` event, `FeatureCreateCommand`, and the
  cross-mode auto-deactivate are byte-identical. Disabled (and
  unconfigured) by default → `new Emap()` behavior unchanged.
- DX Phase 7 (toward 0.3.0): feature transform is now the arbiter-driven
  modal `map.transformFeature` handler (`setOptions({ mode:
  'translate'|'rotate'|'scale' })`, `enable/disable/isEnabled/getOptions`).
  Selection is delegated to `clickSelect` (click = replace, shift+click =
  add, click on empty space = clear); `transformFeature` owns no
  selection logic — it press-drags an already-selected feature:
  pointerdown over a selected feature opens the matching `editSession`,
  drag streams the delta, pointerup commits one undo entry, `Escape`
  cancels. `EditMode` gained `'transform'` (enters the modal pan-disable +
  `editmodechange` like vertex/draw; cross-deactivates with
  vertexEdit/drawFeature). The headless `map.editSession` API is unchanged
  — this only absorbs the pointer→session boilerplate. Disabled by default
  → `new Emap()` behavior unchanged. The `feature-translate` /
  `feature-rotate-scale` examples are rewritten to the one-line recipe.
- DX Phase 8 (toward 0.3.0): delegated `map.on('mousemove', cb)` event
  (payload `{ point, mapCoord, originalEvent }`), fed by the Phase-2a
  pointer arbiter via the same sink mechanism as the Phase-3 `feature:*`
  events — exported `PointerMoveEvent` type. `StatusControl` no longer
  hand-wires a raw canvas `mousemove`; it subscribes the delegated event
  (public class/options/DOM/coordinate-string unchanged). Zero cost when
  no `mousemove`/`feature:*` listener is registered (the pointer sink is
  installed lazily and shared). One intentional, documented behavior
  change: the coordinate readout pauses during an exclusive pan/drag
  gesture (consistent with `feature:hover`) and resumes on release.
  Disabled-by-default cost model unchanged → `new Emap()` behavior
  identical.
- DX Phase 9 (toward 0.3.0): MapLibre-parity camera API — `map.jumpTo`,
  `setCenter`, `setZoom`, `easeTo`, `panTo`, `panBy`, `zoomTo`, `flyTo`
  (van-Wijk parabolic), `fitBounds`, `stop` (all chainable, return
  `this`), built on the existing `Tween`/`Viewport`. Fires a
  `movestart`/`move`/`moveend` + `zoomstart`/`zoom`/`zoomend` lifecycle.
  Camera state is `{ center (projected/data coords, = the Phase-8
  `mapCoord` space), scale }`; `zoom` is an optional Web-Mercator
  convenience (`Projection.getScale` inverse) — non-Web-Mercator CRSs
  pass `{ scale }`. 2D only (no bearing/pitch). A new camera call (or a
  user pan/wheel) interrupts a running animation; the interrupted move
  still fires its `moveend`. `getCenter`/`getZoom`/`setExtent`/`reset`/
  `zoomIn`/`zoomOut` are byte-identical; default `new Emap()` behaviour
  unchanged (no animation runs until a camera method is called).
- DX Phase 10 (toward 0.3.0): typed `EmapEventMap` — `map.on` / `off` /
  `once` now give
  event-name autocomplete and payload inference for the camera lifecycle
  (`movestart`/`move`/`moveend`/`zoomstart`/`zoom`/`zoomend`) and the
  `data`/`error`/`selectionchange`/`historychange`/`editmodechange`/
  `crschange`/`resize`/`validationfailed` events. `EmapEventMap` is an
  augmentable `interface` (`declare module` to register custom events);
  unknown event names still compile (escape hatch preserved). Compile-time
  only — zero runtime change. Exported: `EmapEventMap`, `CameraEvent`.
- DX Phase 11 (toward 0.3.0): per-handler cursor — each `Handler` may
  implement `getCursor(): string | null`; `HandlerManager` arbitrates one
  effective cursor (active gesture > priority order > default) and writes
  it to the map element via `refreshCursor()` / on every dispatch. Adds
  the previously-absent `grab`/`grabbing` pan cursors and the draw
  crosshair (the old `.emap-draw-active` CSS rule was dead); the ad-hoc
  `.emap-edit-active`/`.emap-draw-active` CSS-class mechanism is removed
  (single source of truth). No dispatch/priority behaviour change.

### Changed

- **`LassoStyle` widened (additive, back-compat):** the public
  `LassoStyle` type (`@mapseekai/emap` index, from
  `core/handlers/lasso-select`) gained an optional `strokeDasharray?:
  string` field (default `'4 3'`). Every existing 3-field value remains
  assignable; consumers passing an extra `strokeDasharray` to a lasso
  handler/control now see the dashed visual previously only possible via
  the `LassoSelectControl` surface.
- **Adding `BoxSelectControl` + `LassoSelectControl` together now
  throws:** the P2b handlers are mutually exclusive (one of `enable()`
  throws `cannot enable boxSelect: lassoSelect is enabled`). The legacy
  controls silently coexisted with undefined behavior; the P2c thin
  shells surface the conflict honestly. Install one, OR call
  `map.boxSelect.disable()` before enabling the other (see the updated
  `test/examples/lasso-select.html` for the canonical toggle recipe).
- Release metadata now targets `0.3.0`, matching the handler-centric public API
  documented in the README and project documentation.

### Fixed

- Made the bundle self-contained smoke test portable on Windows by resolving
  local CLI shims through `cmd /c`, adding explicit `esbuild` dev dependency
  coverage, and relaxing the GeoJSON bundle-load timeout for slower full-suite
  runs.
- Completed the typed event surface: `EmapEventMap` now includes the delegated
  `mousemove` and `feature:*` events, so facade authors can index the event map
  for those 0.3.0 APIs instead of relying only on `map.on(...)` overloads.

### Documentation

- Added third-party release guidance: static asset deployment, full custom
  box-selection wiring without bundled controls, known limitations, API
  stability boundaries, and a release checklist.
- Refreshed the project documentation for the current handler-centric public
  API: rewrote `README.md` around third-party integration, headless handler
  usage, custom UI patterns, feature events, editing, worker setup, theming,
  and built-in controls; consolidated the capability matrix at the package
  root. Removed the mandatory OpenSpec workflow instructions from `AGENTS.md`
  and `CLAUDE.md`, keeping them focused on current project architecture and
  contribution rules.
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

- `import "@mapseekai/emap"` is now self-contained in any browser bundler.
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
  `@mapseekai/emap`.

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
  `@mapseekai/emap/style.css`).

[Unreleased]: https://github.com/mapseekai/emap/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/mapseekai/emap/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/mapseekai/emap/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/mapseekai/emap/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/mapseekai/emap/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/mapseekai/emap/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/mapseekai/emap/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/mapseekai/emap/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/mapseekai/emap/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/mapseekai/emap/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/mapseekai/emap/compare/0c7ef115bbbb6d59829cd244c683f65ef38f39cd...v0.6.0
[0.5.0]: https://github.com/mapseekai/emap/compare/v0.4.0...0c7ef115bbbb6d59829cd244c683f65ef38f39cd
[0.4.0]: https://github.com/mapseekai/emap/compare/v0.3.6...v0.4.0
[0.3.7]: https://github.com/mapseekai/emap/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/mapseekai/emap/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/mapseekai/emap/compare/v0.3.3...v0.3.5
[0.3.3]: https://github.com/mapseekai/emap/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/mapseekai/emap/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/mapseekai/emap/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/mapseekai/emap/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mapseekai/emap/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/mapseekai/emap/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/mapseekai/emap/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mapseekai/emap/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mapseekai/emap/releases/tag/v0.1.0

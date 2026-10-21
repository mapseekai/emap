---
id: performance
slug: /recipes/performance
title: Performance
api: ["Emap", "Emap.setGeometryLod", "Emap.setScreenPathFiltering", "MapOptions", "SimplifyOptions"]
examples: ["simplify", "simplify-control", "web-worker", "point-lod", "geometry-lod", "luma-benchmark"]
stability: stable
verifiedVersion: 0.14.0
---

# Performance

Emap supports operation and geometry Workers, shared-arc simplification, viewport/triangle indexes, dense-point LOD, bounded caches, and progressive rendering. Measure preparation, submission, settled-view latency, and memory separately on real data to select suitable settings.


```ts
const map = await Emap.create({
  container: 'map', // mount the map
  useWorker: 'auto', // route large replacements off the main thread
  workerThreshold: 50_000, // route at this vertex count
});
```

## Core parameters

These `MapOptions` select where dataset-replace operations such as `clip`, `dissolve`, `simplify`, and `project` run:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `useWorker` | `boolean \| 'auto'` | `false` | `false` uses the main thread; `true` routes every dataset replacement through a Worker; `'auto'` routes by command and dataset size. Selection translation, rotation, vertex editing, and Canvas rendering remain on the main thread. |
| `workerThreshold` | `number` | `50000` | Vertex threshold for `'auto'`, using `arcs.getPointCount()`; boolean `useWorker` ignores it. Geometry-heavy `simplify`, `dissolve`, and `buffer` use half the threshold; lightweight attribute commands stay on the main thread. |

## More Worker configuration

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `workerUrl` | `string` | `'emap-worker.js'` | Worker bundle URL, resolved against `document.baseURI`. |
| `workerPoolSize` | `number` | `1` | Worker-pool size; independent sources can run in parallel and Workers spawn on demand. `workerPool` overrides it. |
| `workerPool` | `MapshaperWorkerPool` | — | Preconstructed pool, overriding `workerUrl` and `workerPoolSize`; the map exclusively manages it. |
| `workerRouting` | `WorkerRoutingFn` | Built-in decision | Called for both `'auto'` and `true`; receives `cmd`, `heads`, `vertexCount`, `recordCount`, `mode`, `threshold`, and `defaultDecision`, then returns `boolean`. |

## More optimization

### `SimplifyOptions`

`map.ops.simplifyLayer()` simplifies lines and polygons through shared arcs. Choose one threshold mode and call it after import or user confirmation:

```ts
await map.ops.simplifyLayer({
  source: 'roads',
  target: 'primary-roads',
  percentage: 10,
  method: 'weighted',
  weighting: 0.7,
  keepShapes: true,
});
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | Required | Source ID containing shared arcs. |
| `target` | `string` | Entire source | Layer to process; omit for every source layer. |
| `percentage` | `number` | One of three required | Percentage of removable vertices to retain (`0..100`); mutually exclusive with `interval` and `resolution`. |
| `interval` | `number` | One of three required | Positive source-CRS distance threshold; mutually exclusive with the other modes. |
| `resolution` | `string` | One of three required | `WIDTHxHEIGHT` grid, such as `'1000x500'`; mutually exclusive with the other modes. |
| `method` | `'dp' \| 'visvalingam' \| 'weighted'` | `'weighted'` | `'dp'`, `'visvalingam'`, or weighted Visvalingam (`'weighted'`). |
| `weighting` | `number` | `0.7` | Weighted-Visvalingam coefficient. |
| `planar` | `boolean` | `false` | Enables planar mode for planar-degree source CRSs. |
| `keepShapes` | `boolean` | `false` | Retains small polygons simplification might remove. |
| `lockBox` | `boolean` | `false` | Pins vertices on the dataset bounding box. |
| `noRepair` | `boolean` | `false` | Direct output for topology-validated data; otherwise repairs topology. |

Simplification writes its threshold to shared arcs' `retainedInterval` and keeps original vertex thresholds for later recalculation.

### Display-arc LOD

`geometryLod` controls automatic line and polygon display simplification for the current map, shared by Canvas2D, WebGL2, and WebGPU. The default is `{ pixelTolerance: 0.5 }`; `false` disables it. Change the setting without reloading data:

```ts
const map = await Emap.create({
  container: 'map',
  geometryLod: { pixelTolerance: 0.5 },
});
map.setGeometryLod({ pixelTolerance: 2 }); // Prefer simpler display geometry
map.setGeometryLod(false); // Restore the detail allowed by the source
map.setGeometryLod(); // Restore the default 0.5
```

`pixelTolerance` is a CSS-pixel simplification strength greater than `0` and at most `64`. With existing vertex thresholds, each frame uses `max(user simplification floor, pixelSize × pixelTolerance)`. Larger values reduce display detail. Disabling preserves an explicitly applied data simplification. Drawing, picking, and highlighting share the same LOD setting; original coordinates, attributes, and feature counts remain unchanged.

Above `500000` arc vertices, `DisplayArcs` prepares a low-detail copy: existing thresholds retain about `8%`; otherwise it fast-simplifies at four times average segment length. It switches when `unitsPerPixel × (pixelTolerance / 0.5) > low-detail average segment length × 1.5`. This is not a strict maximum-error guarantee. Small files without vertex thresholds do not automatically acquire per-vertex simplification preprocessing.

The tiny-arc filter also scales by `pixelTolerance / 0.5`. `geometryLod: false` bypasses low-detail copies, automatic vertex thresholds, and tiny-arc filtering while retaining viewport culling. It does not change the independent `screenPathFiltering` setting. In-place edits invalidate display copies for rebuilding on demand; export temporarily restores full precision.

### Screen-pixel deduplication

`screenPathFiltering` defaults to true independently of geometry LOD. Canvas2D, WebGL2, and WebGPU use the same source-anchored half-device-pixel grid to merge consecutive interior duplicates in opaque solid lines and polygon outlines. Retained vertices and both endpoints keep their original positions; the grid never snaps road junctions. Reversals are preserved. Panning reuses the frame; zooming in updates its resolution band. Small layers and large Worker batches share this rule.

Whole-layer GPU stroke caches can reuse a finer result while zooming out when its physical resolution is at most twice the requested resolution and it averages at most two segments per nonempty arc. This avoids repeated preparation and uploads without retaining excessive draw work. An already resident exact level takes priority. Changes outside these conditions or zooming beyond cached precision still update the geometry; source coordinates and endpoints stay unchanged.

```ts
const map = await Emap.create({
  container: 'map',
  geometryLod: false,
  screenPathFiltering: true,
});
map.setScreenPathFiltering(false); // Disable screen deduplication without changing geometry LOD
map.setScreenPathFiltering(); // Restore the default: enabled
map.setGeometryLod(false);
map.setScreenPathFiltering(false); // Disable both to retain the detail allowed by the source
```

Deduplication does not change source coordinates, features, exports, or geometry LOD vertex counts. Dashes, arrows, translucent strokes, and polygon fills retain geometry precision in every backend to preserve dash distances, alpha composition, and holes. Compare performance with identical settings, data, viewports, and DPR. CPU submission time is not GPU duration or FPS.

The [geometry LOD example](/mapseekai/emap/examples/geometry-lod/) exposes two independent toggles, a simplification strength input, and vertex counts. It calculates missing thresholds with `100%` vertex retention only when geometry simplification is first enabled. Importing with simplification disabled displays full precision directly.
Local GeoPackage files are also supported: enter comma-separated table names before selecting a `.gpkg` file, or leave the field empty to import all tables. Import runs in a Worker without uploading the file.

### Viewport-culling parameters

The renderer indexes layers with at least `10000` shapes in Flatbush. It uses viewport candidates when coverage and candidate count are both below `25%`; otherwise it draws sequentially. Prebuild during idle time after loading:

```ts
map.prebuildSpatialIndex('roads');
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `sourceId` for `map.prebuildSpatialIndex(sourceId)` | `string \| undefined` | `undefined` (all sources) | Prebuilds indexes for one or all sources. |
| `sourceId` for `map.clearSpatialIndex(sourceId)` | `string \| undefined` | `undefined` (all sources) | Clears cached indexes; call after direct geometry mutation to rebuild current bounds. |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | Layer render switch; `'none'` skips the layer. Update with `map.setLayerVisibility(id, visibility)`. |

## More dense-point LOD

`circle` layers thin by density by default: each binary-grid cell keeps the real point with the lowest feature/component ID, preserving coordinates and attributes for styling and picking. Point and MultiPoint are supported; display filtering precedes selection.

```ts
map.addLayer({
  id: 'points',
  type: 'circle',
  source: 'points',
  pointLod: { cellSize: 8 },
  paint: { 'circle-radius': 3 },
});
```

### `pointLod` parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | Automatic density thinning for a `circle` layer; `false` draws every original point. |
| `pointLod.cellSize` | `number` | `8` CSS pixels | Target grid edge (`1..64`); larger values retain fewer representatives per frame. |

The grid anchors at the data origin with binary nested scales; its active edge is half to all of the requested CSS size. Zoom restores detail progressively; panning and DPR preserve membership.

### Render behavior and budget

Fewer than `10000` valid filtered points, or thinning retaining at least `90%`, uses original candidates. Each layer caches at most three scales and indexes representatives for warm pans. Changes to edit/attribute version, dataset/layer/shape identity, count, filter mask, CRS, `cellSize`, or viewport budget rebuild the cache.

The build budget is `min(two full-CSS-viewport grid capacities, 150000, floor(64 MiB / 80 bytes))` representatives, independent of pointer-query bounds. Over-budget builds use a coarser grid; a single-point layer draws full-view candidates when they fit. Click and hover follow representatives plus selected/highlighted overlays; box and lasso selection, tables, statistics, analysis, exports, and `.msx` snapshots retain full data.

Run the reproducible algorithm benchmark:

```bash
node --expose-gc --max-old-space-size=8192 scripts/benchmark-point-lod.mjs
```

A fixed seed covers 100k, 1M, and 5M uniform and clustered points, reporting median of three cold builds (including first query), median/P95 of 50 warm pans, and input/output counts. Generation is excluded; Node measures LOD only, while browser frames also include Canvas drawing, import, style resolution, and the original spatial index.

## luma GPU real-data benchmark and optional point aggregation

The independent `luma-benchmark` uses selected local files as its performance
inputs. Canvas, WebGL2 and WebGPU share a native mapshaper dataset and conservative spatial culling.
The existing PointLod is enabled for point backgrounds with a 3 CSS-pixel cell target. Lines and polygons remain full detail. GeoJSON streams through a Worker;
full geometry is cached by revision. Formal viewer/editor presets now default to WebGL2, with explicit Canvas2D support.

Open `/mapseekai/emap/examples/luma-benchmark/?gpu=webgl` or `?gpu=webgpu`.
Point aggregation has its own off switch and grid-size control, independent of symbol radius. Cells retain original representative points and their attributes; centroid/count-bubble aggregation requires a separate application step.
Point shader controls select automatic optimization or the same-precision standard path, a CSS radius
(default 3), and opacity (default 1). Filled circles use four-vertex instancing and an analytic
antialiased edge inspired by GeoArrow/deck.gl. Automatic coverage optimization applies only to
consecutive same-color opaque circles. It changes neither coordinates, counts, radii nor sample
resolution. Transparent points and other symbols retain the standard compositing path.

The page runs Canvas → GPU → GPU → Canvas. CPU submission and GPU execution time are measured separately.
The point-specific runner measures fixed full/far/near views; report those FPS values separately from
animated-navigation results. Full-precision runners explicitly disable PointLod. The separate
`benchmark-luma-point-lod.mjs` runner measures default 3 CSS-pixel aggregation with ABBA navigation.

```bash
pnpm examples:luma
node scripts/benchmark-luma-points.mjs --data-dir /path/to/authorized/files --gpu webgl --frames 30
node scripts/benchmark-luma-points.mjs --data-dir /path/to/authorized/files --gpu webgpu --frames 30
node scripts/benchmark-luma-point-lod.mjs --data-dir /path/to/authorized/files --gpu webgl --frames 30
```

The point runner loads complete `points.geojson` and `pppp.geojson` files. Other real inputs use
`benchmark:luma:real`. Optional `--reference-dir` points to a local deck.gl-geoarrow checkout to run
actual GeoArrow layers with the same coordinates. Reference dependencies are installed for the test build only. Input hashes, pixels, raw frame intervals and resource release are recorded.

The soft cache budget only evicts inactive chunks; it never reduces visible geometry precision.
Actual browser memory and emap import limits still apply. Fixed decoded raster tiles measure compositing; measure
GeoTIFF I/O, decoding and overview selection separately.

### Full-detail line rendering

The two luma examples offer `MSAA path optimization`, `same-geometry MSAA reference`,
and `legacy analytic stroke` modes. Original mapshaper paths and segments are unchanged;
point LOD remains independent. Opaque solid strokes use a six-vertex indexed path envelope,
round joins/caps and actual render-target multisampling. A private depth mask only rejects
already covered same-color samples. Color changes and intervening primitives reset coverage;
translucency, dashes and devices without multisampling retain the analytic path.
MSAA and analytic antialiasing can produce different edge pixels. Use the same-geometry
MSAA reference for a comparison with matching output.

```bash
pnpm benchmark:luma:lines --data-dir /path/to/authorized/files --gpu webgl --frames 20
pnpm benchmark:luma:lines --data-dir /path/to/authorized/files --gpu webgpu --frames 20
```

This runner loads complete `big.geojson`, `lucc.geojson` and `building.geojson` and measures
stroke-only fixed views. The UI A/B still supports full-scene animated navigation; the two
methods should be reported separately. `--reference-dir` optionally uses a local deck.gl-geoarrow checkout
for a real GeoArrowPathLayer comparison, without adding its dependencies to emap production.

### Snapshot navigation and conservative path culling

Both luma examples enable snapshot navigation and viewport path-range filtering by default.
Gestures reuse a completed image; settling redraws current full-detail geometry. Newly exposed
areas may temporarily be blank, and zooming temporarily scales image sharpness and stroke width.
The editor bypasses snapshot navigation while a feature is selected to keep original handles exact.
Native mapshaper geometry, topology and history remain unchanged; PointLod is an independent option.

Range culling rejects only bounds outside the expanded viewport, including neighbor and stroke
padding. It preserves visible short paths and original vertices. Original GPU buffers are reused
with offset VAOs on WebGL and firstInstance on WebGPU. A full-extent view still submits all paths.
Use `?nav=off` or `?cull=off` to disable each mechanism, and `&pointLod=off` for original point counts.

Raw A/B trials always bypass snapshots. Snapshot rAF cadence measures frame reuse; full-geometry GPU throughput requires separate measurement.
The UI separates navigation state, CPU submission, replacement readiness, candidate segments and
submitted segments.

### Canvas screen filtering in the luma examples

The independent examples enable separate micro-arc and half-device-pixel consecutive-command
filters for background lines and polygon strokes. They mirror Canvas's 0.35 CSS-pixel threshold
with initial-view scaling, DPR-aware truncation, consecutive-only deduplication and the
0.1-device-pixel stroke for a collapsed path. Native datasets, polygon fills/holes and original
selection/editing geometry remain unchanged. This display approximation uses the stated pixel thresholds. `screenFilter=off` disables both switches.
The data Worker caches exact view/DPR/revision results with stale-result protection. Navigation
snapshots avoid rebuilding during gestures. The two benchmark buttons separate original-geometry navigation from filtered fixed-view warm
drawing. Neither uses snapshots. Screen preparation is reported separately; the two FPS methods
measure distinct workloads and are reported separately.


### Near-to-far cache recovery

Screen-filtered strokes no longer depend on resident raw path GPU buffers. Zoom-out prepares the latest
screen commands without rebuilding evicted raw paths first. Full polygon triangulations take eviction
priority over inactive raw paths within the unchanged 256 MiB raw-cache budget. Oversized fill working
sets may still need rebuilding; cache capacity determines residency. Selection,
editing precision and screen-filter rules are unchanged.

```bash
pnpm benchmark:luma:zoom-out --data-dir /path/to/authorized/files --assert-refill
```

This runner uses complete real files and wheel input from a 16× near view, recording release-to-complete-
frame latency separately from warm FPS. Its isolated loopback server uses port 4195 and closes afterwards,
without modifying a user-owned 4187 server. `--assert-refill` checks rebuild behavior on the known preloaded real-file route.
Validate other files and routes separately.

## API

- `Emap`
- `MapOptions`
- `SimplifyOptions`

## Runnable examples

- [Web Worker](/mapseekai/emap/examples/web-worker/)
- [Simplify control](/mapseekai/emap/examples/simplify-control/)
- [Geometry simplification](/mapseekai/emap/examples/simplify/)
- [密集点 LOD / Dense point LOD](/mapseekai/emap/examples/point-lod/)

- [luma WebGL2 Benchmark](/mapseekai/emap/examples/luma-benchmark/)


## Dynamic UInt16 raster comparison

The [luma dynamic raster example](/mapseekai/emap/examples/luma-raster/) keeps the TIFF source open
and fetches finer overviews/full-resolution pixels as the camera zooms. It compares the formal Canvas
pipeline with WebGL2 and WebGPU using the same source CRS and overview policy. The GPU experiment
currently supports north-up UInt8/UInt16 images with 1–4 bands and no palette; cross-CRS reprojection remains
in the formal Canvas path, without a silent bounding-box approximation.

GPU numerical textures support NoData-aware nearest/bilinear sampling, source-wide stretches,
band mapping and opacity in shaders. Style-only changes reuse loaded data without CPU RGBA rebuilds.
Both display caches have a 32 MiB soft budget, but retain different representations. Include cold-view
halo reads and CPU interleaving costs rather than reporting only warm rendering speed. The shared reader
also supports exact column-window reads for eligible uncompressed strips, benefiting Canvas as well.

`pnpm benchmark:luma:raster:dynamic --data-dir <local-test-directory>` runs the two authorized TIFFs.
Stable-view timings include an eight-frame confirmation window: approximately 133–150 ms for a warm view
is settled-view latency including confirmation; measure GPU execution separately. The original luma-benchmark raster path remains a separate fixed-texture
compositing benchmark.


### Dynamic raster zoom refinement

The `luma-raster` example batches adjacent complete source windows, shares halo reads,
and publishes ready textures through disjoint progressive coverage. Pointer and camera
pauses prevent pending packing/uploads from competing with active gestures. Original values,
source CRS, overview policy and soft cache budgets remain unchanged. Separate main-thread
packing/submission, cumulative Worker decoding and settled wall time; the latter includes
eight quiet-frame confirmations. Measure gains per view, including block-edge duplication
and small striped-read costs.


## Dynamic raster memory diagnostics

The `luma-raster` example reports decoded-block cache, GPU texture payloads, queued
samples and reusable packing storage below the map. These tracked resources exclude
V8/Worker temporaries, Canvas/swapchain surfaces and driver overhead; add these costs to the 32 MiB cache
budget when measuring total browser memory. Source values and overview selection stay unchanged.

`openGeoTIFF(file, { blockCacheBytes: 32 * 1024 ** 2 })` caps the aggregate decoded-block
cache across the source's Workers (8–256 MiB). Omitting the option retains storage-aware
defaults. This is separate from decode reservations; smaller caches may require rereads.

On macOS run `pnpm profile:luma:raster:memory --data-dir "/authorized/test-data"` with
the original FUS/GJ files. Optional flags include `--backends webgl,webgpu --dprs 1,2
--cycles 4 --trace`. Only the profiler's own browser and preview process are cleaned up.
Forced GC is restricted to untimed checkpoints; the production renderer never forces GC.


### Source cores, GPU halo reuse, and local folders

The dynamic raster example can prepare an original UInt8/UInt16 upload layout in the
Worker, avoiding planar intermediate outputs and main-thread channel packing. Eligible
TIFF tiles are read as disjoint cores; resident integer textures supply exact one-pixel
halo edges/corners with GPU copies. Only neighbors needed by visible sample footprints
are requested, without recursive halo expansion. Incomplete coverage retains the previous
image; completed regions still replace it without double alpha or stale NoData bleed.
Strips and incompatible layouts retain bounded window fallback, at the same overview policy.

The folder selector lists TIFFs and pairs `.tif.ovr` by the full relative path. One selected
image is loaded at a time; multi-image mosaicking requires a separate application step. The verified folder contains
four UInt8 RGB originals with planar external OVRs and one internally overviewed COG.
Embedded GeoTIFF georeferencing is used; inputs whose georeferencing is only in TFW/XML
need those coordinates written into GeoTIFF keys first. Other sample types, palettes and cross-CRS display remain in the formal Canvas path.

`haloCopies`, `haloCopyBytes` and `preparedUploads` separate GPU edge reuse from CPU uploads.
`packMs=0` records zero main-thread packing; Worker/browser copies have separate costs.
`?pipeline=legacy` compares the planar reader within the current build;
other behavior follows the current version. Add `--include-cdf` to `benchmark:luma:raster:dynamic` to include all five
original TIFFs in the authorized `cdf20250916042716` folder.

## Formal WebGL2 / WebGPU navigation and preparation caches

These optimizations are enabled by default for formal maps with `renderer: 'webgl2'` or `'webgpu'`;
no private benchmark flags are needed. Lightweight pan and wheel gestures replay resident GPU geometry
at the current camera. New viewport planning waits until input pauses for approximately 80 ms or the gesture ends, avoiding repeated geometry preparation during continuous input. When CPU drawing
or asynchronous GPU completion latency exceeds 33.3 ms, navigation reuses the painted frame until
the gesture ends, then redraws the current view instead of resubmitting dense geometry on every move.
Completion latency is sampled at most once per 250 ms; it includes scheduling and asynchronous completion; GPU timestamps are measured separately.
Background geometry, icon and label notifications wait for the gesture's settle redraw; style updates and device recovery
still redraw immediately.
Navigation snapshots use completed content; the first ready geometry still triggers a redraw.
New areas can temporarily be blank and background strokes scale with the snapshot; edit overlays remain
live. Content changes invalidate old work. Canvas2D retains its adaptive bitmap policy; successful GPU
submissions provide reusable navigation frames.

Ordinary examples also use viewport/path-range culling, the `Viewport` tiny-arc filter, and the large-data
half-pixel filter described below. No per-example benchmark switches are needed. Tiny-arc and half-pixel
filtering affect display only; original topology stays unchanged.

Stable views reuse arc visibility and candidate-outline preparation instead of flattening/filtering
again before a GPU mesh cache hit. Ordered input IDs and geometry revisions are still checked;
dash direction, point density, layer order, selection and editing semantics remain unchanged.
Additional selection snapshots share the existing geometry byte budget and owner lifecycle.
Strokes cache whole layers; draw-range indices and GPU viewport clipping avoid preparing or uploading geometry again when visible roads change during a pan. Polygon-fill boundary chunks still retain complete spatial membership.
With screen filtering disabled, opaque solid MSAA strokes arrange GPU data by spatial proximity within each preparation batch to improve range culling. Original coordinates, topology, feature order, and whole-layer presentation stay unchanged. Dashes, arrows, translucent strokes, and other order-dependent paths retain their original order.

Large formal GPU draws use a dedicated geometry Worker. The main thread cooperatively copies bounded
XY packets; triangulation and GPU packing run off-thread without cloning the entire source or attribute tables.
Strokes cache whole layers without spatial-grid loading. A layer is presented only when all its batches are ready;
detail updates retain the complete previous layer until its replacement is ready. Internal preparation and uploads
remain bounded by vertex and buffer limits. Fills and points retain progressive presentation in parent/bucket order,
without accumulating alpha from previous partial frames. Icons preserve their original overlap order.

When polygon fills reuse identical cached geometry, they do not join unrelated stroke updates into one large handoff group. Changed fills and boundaries still transition together, preventing temporary GPU memory pressure from blocking later updates.

```ts
const map = await Emap.create({
  container: 'map',
  renderer: 'webgl2',
  geometryWorkerUrl: '/assets/emap-geometry-worker.js', // Defaults beside the package bundle
  screenPathFiltering: true,
});
```

`screenPathFiltering` defaults to half-device-pixel display filtering for opaque solid strokes in every renderer,
using cells only to select interior vertices while preserving retained positions and endpoints. It is independent of `geometryLod`;
call `setScreenPathFiltering(false)` to disable it at runtime. Dashes, arrows, translucent strokes, and polygon fills
retain geometry precision. Small layers and edit highlights remain synchronous.
The geometry Worker is independent of the operation `useWorker` flag.

The geometry soft budget is 256 MiB, with a bounded visible working set of at most 512 MiB.
Over-budget work reports an error instead of truncating features. A single packet is limited to
two million XY vertices; partition metadata has its own limit. Source data, JS/Worker temporaries,
textures and driver memory are additional. Large `render()` calls can start asynchronous preparation
and progressively present partial scenes rather than completing all geometry immediately.
An additional exact per-feature Worker cache is bounded to 64 MiB / 20,000 entries; unchanged
coordinates and ring offsets reuse triangulations across changing batch memberships.

Chunking adds scheduling and draw-call costs, so compare cold responsiveness, settle time, cache
reuse and memory separately to assess gains for each workload. CPU submission time
measures host work; GPU execution time and FPS require separate samples. Large polygons have conservative internal triangle-range indexes,
reducing submitted indices without new coordinate uploads or dropping holes/enclosing triangles.
Fragmented selections may conservatively draw the entire mesh.

During resident GPU geometry replay, existing labels reproject ground anchors with fixed CSS offsets; glyph and halo sizes do not scale
with map zoom. Async layouts add newly visible labels during navigation. Atlas-generation checks
prevent recycled UVs from displaying the wrong glyph. Cold tasks, file parsing and business indexes
still cost time. Lightweight views replenish geometry during gestures; expensive views reuse snapshots
without repeated GPU submissions while content is unchanged.

## Full GeoPackage browser stress test

Run `pnpm benchmark:geopackage:browser --file /authorized/data.gpkg --renderer webgl2 --cycles 3`
against the local example preview; webgpu and canvas2d are also supported. The harness checks native
read-only SQLite row counts, the unchanged file hash, settled navigation, cache residency and disposal.
It records import, rendering readiness, long tasks and process-group RSS separately. Default topology,
point LOD, display arcs, paints and allocation budgets are retained. A passed stress route validates the tested file, viewport, DPR, and machine.
Compare GPU/Canvas2D speed and memory capacity on each target configuration.

Cold polygon uploads use conservative viewport coverage and compact referenced vertices, retaining
complete triangles and holes. Resident whole-source geometry remains reusable; source data is not clipped.
The shared 256 MiB soft / 512 MiB hard geometry budget remains unchanged.

### Binary batches and stable stroke caches

The formal geometry Worker consumes flat XY/offset buffers. Complex polygons retain exact even-odd
ring relationships; cheap single-ring features use a binary batch path. Child chunks have tight bounds,
CPU preparation batches remain independent of small GPU allocations, and queue/eviction bookkeeping
is incremental. Progressive notifications are coalesced using observed presentation cost.
Opaque solid strokes use source-anchored detail frames at least as fine as the requested device resolution.
Pans within existing coverage reuse these buffers; new coverage, members, revisions or detail levels still
require preparation. Cells select interior vertices without snapping retained coordinates or endpoints,
so changing detail bands does not shift road junctions. Set `screenPathFiltering: false`
to disable this approximation. Authoritative topology, export and editing coordinates are unchanged.
Metadata-only registration reuses an unchanged DisplayArcs instead of constructing the same LOD twice.


### Geometry cache and batch efficiency

Formal GPU tessellation caching uses numeric feature keys and an intrusive LRU while retaining exact
coordinate/ring-offset checks. Stable radix ordering preserves triangle order; eligible split fills
use uint16 indices without changing coordinate precision or triangle contents. Four-byte upload
padding is budgeted, never drawn. Large arc collections coalesce bounded consecutive batches after
fine-chunk selection, preserving order, dash distances and endpoints; icons are not reordered.
Completed LOD partition plans are retained in a bounded metadata cache and cleared on source removal
or geometry revision changes. Cache capacity and eviction determine geometry residency.
Measure full-file GeoPackage import and main-thread restoration separately.

The GeoPackage browser benchmark accepts `--warm-frames 8` to record eight CPU submissions and draw
counts after each view has settled. The default is 0. Report these CPU measurements separately from GPU duration/FPS,
file reads, and cold preparation.

### Valid stroke instances and direct-upload buffer pages

Formal affine GPU maps use valid-segment instances and precomputed join coefficients for suitable
opaque solid strokes. Long-path storage regressions, nonuniform/perspective views, translucency,
dashes and arrows retain the original path. No source coordinates or valid segments are removed.
Precomputation changes floating-point evaluation order and may produce sparse MSAA boundary-sample
differences; 4x antialiasing and the existing half-pixel display precision are retained.

Compact strokes and uint16 fills upload directly into shared GPU pages. Only consecutive compatible
resident slices are drawn together in their original order; no full-scene second copy is allocated.
Page slack shares the original 256/512 MiB geometry limits. The 16 MiB new-page reserve is inside that
budget and counts toward total GPU capacity. Releasing slices may temporarily increase fragmentation beyond the
reserve; actual capacity remains accounted and empty pages are destroyed immediately. Index alignment
uses complete zero-area triangles with a separate padding counter; they produce no pixels.

`benchmark:geopackage:browser --warm-frames 8 --gpu-frames 12` samples CPU submission and GPU pass
duration separately. GPU times are collected only when timestamp queries are supported; missing samples
remain unavailable measurements. Shared index buffers are counted once by physical object. Report
CPU, GPU, and FPS measurements separately. Precomputation and paging have cold-preparation costs,
so evaluate gains for each view.

### Ordered command reuse and page recycling

Formal GPU maps cache ordered meshes, exact visible ranges and compatible page spans instead of rebuilding
submission plans and parsing identical styles on every frame. WebGPU automatically reuses stable fill and
opaque MSAA-stroke commands while keeping four-sample antialiasing. Text, icons, raster images and other
paths retain their existing rendering. Command reuse preserves source features and actual triangles;
measure CPU and GPU savings separately.

Retired page regions can be split and coalesced without moving live data or raising geometry budgets.
Repeated ownership/eviction maintenance is skipped only for complete resident frames with unchanged
requests and external memory pressure. File import and topology restoration remain separate costs.

### Lossless stroke layouts and dependency invalidation

Screen strokes omit only endpoint low components that are exactly zero, using 48-byte XY instances;
nonzero low parts retain the 64-byte high/low layout. A task may hold both layouts, with their combined
size still checked against the existing budget. Authoritative Float64 coordinates, caps and MSAA remain.
Only uniform opaque MSAA stroke scopes may organize visible ranges by physical buffer; translucent
strokes, dashes, arrows, icons and parent-layer order are not reordered. Retiring a mesh invalidates
only the command scopes that reference it; unrelated recordings remain reusable. Import is unchanged,
and gains should be measured at each viewport.

### Bounded geometry microbatches

Formal WebGL2/WebGPU maps coalesce small geometry jobs into at most eight jobs and 2 MiB of
transferable backing storage per message. Large jobs remain isolated and one geometry Worker is used.
The first job never waits for a batch; each chunk keeps its version and resource identity. Cancellation
rewinds reserved cursors and cannot restore retired sources. Per-item errors retain other successful results.
Unsimplified native arc lengths can avoid a coordinate-count scan. Speculative coordinate capacity is
limited to 2 MiB; larger, retained-detail or custom inputs keep exact counting. Compaction may briefly
retain the bounded capacity buffer plus its exact result.
`geometryChunks.messages` and `jobs` distinguish requests from logical jobs; `batchAdmissionMs` records
admission overhead separately. This optimization targets rendering preparation; measure GPU shading and file import separately.
Existing geometry and feature-cache budgets remain unchanged.

### Resident stroke bounds and selected-range batching

Formal GPU maps retain conservative contiguous-instance envelopes for eligible opaque screen strokes.
Navigation selects resident Buffer ranges. Extreme joins stay drawable when safety cannot be proven,
and nonuniform transforms do not reuse similarity-only envelopes. MSAA and coordinate/detail precision stay unchanged.
Constant-RGBA fill scopes group by physical page. Adjacent partially visible slices can coalesce selected ranges,
without crossing filtered holes, retired slices or unselected triangles. Candidate/submitted work and padding
remain separately accounted. Measure frame time alongside submission overhead on each target view and GPU.

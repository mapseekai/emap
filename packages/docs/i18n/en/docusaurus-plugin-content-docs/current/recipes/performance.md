---
id: performance
slug: /recipes/performance
title: Performance
api: ["Emap", "MapOptions", "SimplifyOptions"]
examples: ["simplify", "simplify-control", "web-worker", "point-lod", "luma-benchmark"]
stability: stable
verifiedVersion: 0.13.0
---

# Performance

Tune four layers: Worker dataset replacement, shared-arc simplification, viewport spatial indexing, and dense-point render LOD.


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
| `workerRouting` | `WorkerRoutingFn` | Built-in decision | Called only for `'auto'`; receives `cmd`, `heads`, `vertexCount`, `recordCount`, `mode`, `threshold`, and `defaultDecision`, then returns `boolean`. |

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

`DisplayArcs` is source-internal render LOD with no option. More than `500000` arc vertices creates a low-detail copy: existing thresholds retain about `8%`; otherwise it fast-simplifies at four times average segment length. It renders while `unitsPerPixel > low-detail average segment length × 1.5`; closer scales use full arcs.

Each frame sets `max(retainedInterval, pixelSize × 0.5)`, preserving user simplification as a floor. In-place edits mark display arcs stale; rebuild waits for a low-detail copy. Export temporarily restores full precision.

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

The independent `luma-benchmark` waits for selected local files; it does not generate performance
inputs. Canvas, WebGL2 and WebGPU share a native mapshaper dataset and conservative spatial culling.
The existing PointLod is enabled for point backgrounds with a 3 CSS-pixel cell target. Lines and polygons remain full detail. GeoJSON streams through a Worker;
full geometry is cached by revision. Default viewer/editor presets still use Canvas.

Open `/mapseekai/emap/examples/luma-benchmark/?gpu=webgl` or `?gpu=webgpu`.
Point aggregation has its own off switch and grid-size control, independent of symbol radius. Cells retain original representatives, not centroids or count bubbles.
Point shader controls select automatic optimization or the same-precision standard path, a CSS radius
(default 3), and opacity (default 1). Filled circles use four-vertex instancing and an analytic
antialiased edge inspired by GeoArrow/deck.gl. Automatic coverage optimization applies only to
consecutive same-color opaque circles. It changes neither coordinates, counts, radii nor sample
resolution. Transparent points and other symbols retain the standard compositing path.

The page runs Canvas → GPU → GPU → Canvas. CPU submission time is not GPU execution time.
The point-specific runner measures fixed full/far/near views; do not mix those FPS values with
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
actual GeoArrow layers with the same coordinates. Reference dependencies are test-only, not emap
production dependencies. Input hashes, pixels, raw frame intervals and resource release are recorded.

The soft cache budget only evicts inactive chunks; it never reduces visible geometry precision.
Actual browser memory and emap import limits still apply. Fixed decoded raster tiles do not measure
end-to-end GeoTIFF I/O, decoding or overview selection.

### Full-detail line rendering

The two luma examples offer `MSAA path optimization`, `same-geometry MSAA reference`,
and `legacy analytic stroke` modes. Original mapshaper paths and segments are unchanged;
point LOD remains independent. Opaque solid strokes use a six-vertex indexed path envelope,
round joins/caps and actual render-target multisampling. A private depth mask only rejects
already covered same-color samples. Color changes and intervening primitives reset coverage;
translucency, dashes and devices without multisampling retain the analytic path.
The MSAA result is not pixel-identical to the old analytic antialiasing; do not describe
that visual change as an equal-output speed comparison.

```bash
pnpm benchmark:luma:lines --data-dir /path/to/authorized/files --gpu webgl --frames 20
pnpm benchmark:luma:lines --data-dir /path/to/authorized/files --gpu webgpu --frames 20
```

This runner loads complete `big.geojson`, `lucc.geojson` and `building.geojson` and measures
stroke-only fixed views. The UI A/B still supports full-scene animated navigation; the two
methods must not be mixed. `--reference-dir` optionally uses a local deck.gl-geoarrow checkout
for a real GeoArrowPathLayer comparison, without adding its dependencies to emap production.

### Snapshot navigation and conservative path culling

Both luma examples enable snapshot navigation and viewport path-range filtering by default.
Gestures reuse a completed image; settling redraws current full-detail geometry. Newly exposed
areas may temporarily be blank, and zooming temporarily scales image sharpness and stroke width.
The editor bypasses snapshot navigation while a feature is selected to keep original handles exact.
Native mapshaper geometry, topology and history remain unchanged; PointLod is an independent option.

Range culling rejects only bounds outside the expanded viewport, including neighbor and stroke
padding. It does not omit visible short paths or simplify vertices. Original GPU buffers are reused
with offset VAOs on WebGL and firstInstance on WebGPU. A full-extent view still submits all paths.
Use `?nav=off` or `?cull=off` to disable each mechanism, and `&pointLod=off` for original point counts.

Raw A/B trials always bypass snapshots. Snapshot rAF cadence is not full-geometry GPU throughput.
The UI separates navigation state, CPU submission, replacement readiness, candidate segments and
submitted segments.

### Canvas screen filtering in the luma examples

The independent examples enable separate micro-arc and half-device-pixel consecutive-command
filters for background lines and polygon strokes. They mirror Canvas's 0.35 CSS-pixel threshold
with initial-view scaling, DPR-aware truncation, consecutive-only deduplication and the
0.1-device-pixel stroke for a collapsed path. Native datasets, polygon fills/holes and original
selection/editing geometry remain unchanged. This is a display approximation, not full-detail
pixel equivalence. `screenFilter=off` disables both switches.
The data Worker caches exact view/DPR/revision results with stale-result protection. Navigation
snapshots avoid rebuilding during gestures. The two benchmark buttons separate original-geometry navigation from filtered fixed-view warm
drawing. Neither uses snapshots. Screen preparation is reported separately; the two FPS methods
are not interchangeable.


### Near-to-far cache recovery

Screen-filtered strokes no longer depend on resident raw path GPU buffers. Zoom-out prepares the latest
screen commands without rebuilding evicted raw paths first. Full polygon triangulations take eviction
priority over inactive raw paths within the unchanged 256 MiB raw-cache budget. Oversized fill working
sets may still need rebuilding; this is not a guarantee that every dataset stays resident. Selection,
editing precision and screen-filter rules are unchanged.

```bash
pnpm benchmark:luma:zoom-out --data-dir /path/to/authorized/files --assert-refill
```

This runner uses complete real files and wheel input from a 16× near view, recording release-to-complete-
frame latency separately from warm FPS. Its isolated loopback server uses port 4195 and closes afterwards,
without modifying a user-owned 4187 server. `--assert-refill` checks the known preloaded real-file route,
not a universal no-rebuild guarantee for arbitrary data.

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
currently supports north-up UInt16 images with 1–4 bands and no palette; cross-CRS reprojection remains
in the formal Canvas path, without a silent bounding-box approximation.

GPU numerical textures support NoData-aware nearest/bilinear sampling, source-wide stretches,
band mapping and opacity in shaders. Style-only changes reuse loaded data without CPU RGBA rebuilds.
Both display caches have a 32 MiB soft budget, but retain different representations. Include cold-view
halo reads and CPU interleaving costs rather than reporting only warm rendering speed. The shared reader
also supports exact column-window reads for eligible uncompressed strips, benefiting Canvas as well.

`pnpm benchmark:luma:raster:dynamic --data-dir <local-test-directory>` runs the two authorized TIFFs.
Stable-view timings include an eight-frame confirmation window: approximately 133–150 ms for a warm view
is not GPU execution time. The original luma-benchmark raster path remains a separate fixed-texture
compositing benchmark.


### Dynamic raster zoom refinement

The `luma-raster` example batches adjacent complete source windows, shares halo reads,
and publishes ready textures through disjoint progressive coverage. Pointer and camera
pauses prevent pending packing/uploads from competing with active gestures. Original values,
source CRS, overview policy and soft cache budgets remain unchanged. Separate main-thread
packing/submission, cumulative Worker decoding and settled wall time; the latter includes
eight quiet-frame confirmations. Not every view is faster, and block-edge duplication
and small striped reads still have costs.


## Dynamic raster memory diagnostics

The `luma-raster` example reports decoded-block cache, GPU texture payloads, queued
samples and reusable packing storage below the map. These tracked resources exclude
V8/Worker temporaries, Canvas/swapchain surfaces and driver overhead; a 32 MiB cache
budget is not total browser memory. Source values and overview selection stay unchanged.

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
image is loaded at a time; this is not automatic mosaicking. The verified folder contains
four UInt8 RGB originals with planar external OVRs and one internally overviewed COG.
Embedded GeoTIFF georeferencing is used; this feature does not promise arbitrary TFW/XML
fallback. Other sample types, palettes and cross-CRS display remain in the formal Canvas path.

`haloCopies`, `haloCopyBytes` and `preparedUploads` separate GPU edge reuse from CPU uploads.
`packMs=0` means no main-thread packing, not an entirely copy-free Worker/browser pipeline.
`?pipeline=legacy` keeps the planar reader as a diagnostic comparison, not an exact old-build
reproduction. Add `--include-cdf` to `benchmark:luma:raster:dynamic` to include all five
original TIFFs in the authorized `cdf20250916042716` folder.

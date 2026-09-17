---
id: geotiff
slug: /data/geotiff
title: Local GeoTIFF rasters
api: ["openGeoTIFF", "openGeoTIFFHandle", "geoTIFFPlugin", "rasterPlugin", "RasterSource", "RasterStyle", "RasterReference", "RasterContract", "RASTER_PYRAMID_THRESHOLD", "GeoTIFFAddOptions", "GeoTIFFContract", "GeoTIFFPluginOptions", "OpenGeoTIFFOptions", "RasterCacheStats", "RasterPerformanceTotals", "RasterPlanningDiagnostics", "RasterLayerPlanningDiagnostics", "RasterSelectedLevelDiagnostics", "RasterError", "RasterLayerInfo", "RasterLayerReference", "RasterLevel", "RasterMetadata", "RasterBandStatistics", "RasterRenderRequest", "RasterRenderResult", "RasterTaskDiagnostics", "RasterWarpMesh", "RasterProcessingStats", "RasterLevelProcessingStats", "RasterReadRequest", "RasterReadResult", "RasterRenderOptions", "RasterSamples", "RasterWindow", "RenderFrame", "RenderPass"]
examples: ["geotiff-viewer"]
stability: experimental
verifiedVersion: 0.12.0
---

# Local GeoTIFF rasters

The optional `@mapseekai/emap/geotiff` entry pins `geotiff@3.0.5`. It reads byte ranges from the original local File, decodes windows in a dedicated Worker, and draws derived tiles on the existing map canvas.

## Load a file

```ts
import { Emap, Bounds } from '@mapseekai/emap';
import { rasterPlugin, geoTIFFPlugin } from '@mapseekai/emap/geotiff';

const map = await Emap.create({
  container: 'map',
  preset: 'viewer',
  plugins: [
    rasterPlugin({ cacheBytes: 64 * 1024 ** 2, concurrency: 2 }),
    geoTIFFPlugin({ workerUrl: '/assets/emap-geotiff-worker.js', workerCount: 2 }),
  ],
});
await map.ctx.geoTIFF.addFile('imagery', file, {
  overviewFile,
  style: { bands: [0, 1, 2], resampling: 'bilinear' },
});
const bounds = await map.ctx.raster.getBounds('imagery');
map.fitBounds(new Bounds(...bounds), { padding: 32, duration: 0 });
```

Do not call `file.arrayBuffer()` first. Deploy the packaged `dist/emap-geotiff-worker.js` at the configured URL with a JavaScript MIME type and a CSP allowing the Worker. It is a self-contained classic Worker, without mapshaper vendor imports. The distributed ESM defaults to a sibling Worker; bundler users should copy the asset explicitly and supply its URL.

## Mandatory pyramids above 2GiB

The non-configurable policy is **`file.size > 2 * 1024 ** 3` requires valid overviews before any pixel decoding**. Otherwise loading fails with `PYRAMID_REQUIRED`. Exactly 2GiB does not trigger this policy, but all read budgets still apply.

Internal IFDs, SubIFDs and explicitly selected `filename.tif.ovr` files are supported. Full-size pages, masks, incompatible dimensions or bands do not count as overviews. External names must match the source filename plus `.ovr`. Where georeferencing exists, CRS and extent are checked. A georeference-free external overview still depends on the user selecting the correct companion; filename matching is not cryptographic identity verification.

Three-band originals and overviews may use different `MINISBLACK`/`RGB` tags when their numerical band types match and no alpha semantics change. Raw bands are preserved; palette, WhiteIsZero, and other colorspace checks are not relaxed. An explicitly supplied `.ovr` with no compatible levels fails with `OVERVIEW_MISMATCH` before pixel decoding rather than being silently ignored.

The example now prefers directory authorization: after the user grants read access to an imagery directory, selecting `a.tif` automatically looks up and associates sibling `a.tif.ovr`; a directory containing only one TIFF is selected and loaded immediately. Browser security does not let a plain `<input type="file">` discover the selected file's parent directory, so browsers without directory-handle support retain manual TIFF/OVR selection as a fallback. emap core still receives only user-authorized Files/handles and never bypasses browser permissions to inspect local siblings.

Build overviews using QGIS or a locally installed GDAL:

```bash
gdaladdo -ro -r average "image.tif"
```

`-ro` preserves the original file and creates an external `.ovr`; GDAL automatically chooses progressively reduced levels when none are specified. Use `-r nearest` for categorical data. Select both files again after building. emap does not modify the original, encode pyramids in the browser, or create hidden OPFS copies.

An incomplete pyramid or enormous compressed strip can still fail with `RASTER_READ_BUDGET`. Build more complete overviews or a tiled TIFF; the presence of one small reduction is not a universal performance guarantee.

## Display and layer management

Rasters use a separate read-only source model, not vector `TopologySource` or `map.addLayer()`. The raster stack is currently below vector layers. Raster ordering is supported; arbitrary vector/raster interleaving is not yet provided.

```ts
map.ctx.raster.setStyle('imagery', { opacity: 0.6 });
map.ctx.raster.setVisibility('imagery', false);
map.ctx.raster.moveLayer('imagery');
const values = await map.ctx.raster.queryPixel('imagery', x, y);
map.ctx.raster.remove('imagery');
```

By default, the first three non-alpha data bands map to RGB. Sources with one or two available data bands default to grayscale using the first band. Spectral roles are not inferred: select the appropriate R/G/B band mapping for multispectral imagery. Indexed images retain their native palette by default.

The example provides RGB and single-band grayscale modes, separate R/G/B selectors, and a grayscale band selector. Single-band files automatically use grayscale and disable unavailable RGB mode. UI band numbers start at 1; API indices start at 0.

```ts
map.ctx.raster.setStyle('imagery', { bands: [0, 1, 2] });
map.ctx.raster.setStyle('imagery', { bands: [1], stretch: 'auto' });
map.ctx.raster.setStyle('imagery', { bands: undefined }); // Automatic/native palette.
```

Changing bands clears inherited channel-specific ranges unless new `ranges` are explicitly supplied in the same call. Grayscale uses the selected band's source statistics, not the first band's statistics. Alpha remains a transparency channel and is excluded from default color selection. Band choices persist in external project references. Explicitly selecting an indexed image's band displays its numerical class values as gray rather than expanding its palette.

Nearest/bilinear resampling, NoData, unassociated alpha, palettes, opacity, and fixed ranges are supported. Grayscale writes equal R/G/B display values. Pixel queries still return original full-resolution samples; rendering-mode changes never modify them.

The default `stretch: 'auto'` preserves UInt8 colors and applies a 2–98% percentile stretch to Int8, UInt16/Int16, UInt32/Int32, and Float16/Float32/Float64 display pixels. Original samples and pixel-query values are unchanged; Float16 samples decode to Float32 buffers.

Statistics run in the Worker after mandatory pyramid checks. A suitable overview is preferred; a 4×4 source-wide grid samples at most 64×64 pixels per stratum, totaling at most 65,536 sample positions. Every read still enforces source-window and whole-block budgets. No full-image decode is performed and statistics are not recomputed per viewport. NoData, NaN, infinities, and transparent-alpha samples are excluded. `metadata.statistics` exposes per-band `min/max/p02/p98/count/approximate`; overview or partial sampling is marked approximate. Very sparse valid regions can be missed, in which case explicit display ranges are available.

All tiles share the same stable ranges. Constant-valued rasters display as mid-gray; all-invalid rasters remain transparent. Choose `minmax`, `percentile`, or `none` to override automatic behavior. `none` uses the sample type range (floating-point `[0, 1]`). Explicit `ranges` take precedence:

```ts
map.ctx.raster.setStyle('imagery', { bands: [0], ranges: [[0, 3000]] });
```

## Continuous navigation display

During wheel/drag gestures and camera animations, only previously completed imagery is transformed. No new viewport tile reads or presentation swaps start during the gesture. The map retains its existing 250ms wheel-end detection. Other view changes use `settleDelay` (default 150ms, configurable 0–2000ms); explicit active gestures always block reads until they end.

```ts
rasterPlugin({
  cacheBytes: 64 * 1024 ** 2,
  concurrency: 2,
  settleDelay: 150,
  presentationInterval: 60,
});
map.ctx.raster.setStyle('imagery', { stretch: 'minmax', ranges: undefined });
```

After movement settles, ready target-resolution tiles are **presented in short groups of at most 60ms by default**. This avoids a separate update for every tile without waiting for the whole viewport. A fully ready batch is flushed immediately rather than waiting for the timer. Unready regions retain the previous view; cached parent or other old-resolution tiles can fill missing coverage. Interrupting another zoom freezes the already presented mixture instead of reverting to the previous complete batch.

Old and new imagery use disjoint map-coordinate clips, so a location is drawn only once and translucent pixels are not double-blended. A completed transparent/NoData tile still owns its region: it exposes lower layers, never stale samples from the old raster. Shared tile and clip boundaries are quantized consistently to device pixels to avoid fractional-DPR seams.

A failed tile does not cancel its siblings. Its region keeps available fallback coverage while an error is reported; cancelled or obsolete responses cannot overwrite the current view. Opacity-only changes reuse decoded pixels. The map coalesces tile-ready notifications into animation frames rather than forcing a synchronous render for every tile.

Repeated interruptions can retain fragments from several resolutions. When their byte or fragment budget is exceeded, the visible fallback is compacted into a bounded in-memory preview before further replacements. This temporary preview may be lower-resolution, but it does not write OPFS or copy/modify the original file. First loads and newly entered areas without cached coverage must still await initial reads.

Use `getStats()` fields `interacting` for gesture/settle state, `pendingFrames` for unfinished view batches, `presentedTiles` for progressive tile presentations, `committedFrames` for fully successful view batches, and `readRequests` for tile reads. Tiles can be presented while `pendingFrames > 0`. The example includes UInt8, UInt16, Int16, Float32, and Float64 fixtures plus stretch-mode controls.

## Presentation cadence and read throughput

Block reads and screen updates are separate stages. [QGIS MapCanvas](https://api.qgis.org/api/qgsmapcanvas_8cpp_source.html) polls the render job's composed image through an update timer (250ms constructor default, configurable) and submits final output when the job finishes. [Raster preview feedback](https://api.qgis.org/api/qgsrasterlayerrenderer_8cpp_source.html) also rate-limits preview updates. Consequently, QGIS should not be described as immediately displaying every decoded block. [GDAL's block cache](https://gdal.org/en/stable/user/configoptions.html#config-GDAL_CACHEMAX) avoids repeated block reads. This is a source-level comparison, not a native QGIS speed measurement on the user's computer.

emap uses a shorter bounded presentation window while preserving incremental progress: reduce actual reads and decoding first, then group ready results without removing memory limits or hiding slow work behind a full-viewport wait.

`presentationInterval` is a bounded ready-tile grouping window (0–250ms, default 60ms); 0 restores immediate per-tile presentation. It is separate from the navigation `settleDelay`. Slow tiles do not hold up completed groups. Cancellation and disposal clear queued keys and timers. The earliest tile may wait up to one grouping interval in exchange for fewer partial visual updates; a complete batch flushes early.

Small compressed byte ranges share aligned 64KiB pages and deduplicated in-flight requests. Each original or overview file retains at most 16 pages (1MiB), plus at most 16 in-flight pages. Large ranges remain direct reads. Physical reads, including prefetch, still count against the existing I/O budget.

Each open raster source adds an **8MiB decoded-block LRU**, divided across parallel Workers and shared across original and overview IFDs and also capped at 4096 entries. Neighboring display tiles, revisits, and style changes reuse original decoded blocks. Only completed buffers are retained, never long-lived result promises. Closing the source releases the cache.

Uniform native-endian numeric samples in common encodings use TypedArray row copies/deinterleaving with at most four active block reads. geotiff.js still implements codecs and predictors. Float16, non-native endianness, mixed samples, and special codecs retain the upstream reader. Nearest and bilinear display both reuse coordinate/channel/interpolation state instead of allocating arrays per pixel. Source values, overview selection, and display ranges are unchanged.

These are **additional to the display cache**: up to 1MiB retained compressed pages per TIFF file plus 8MiB decoded blocks per raster source. An external `.ovr` has its own compressed-page allowance. Pending reads, the current window, and browser resources add transient memory. Removing layers or unloading plugins releases buffers and Workers; no OPFS/IndexedDB copy is created.

`test/browser/raster-performance.spec.mjs` performs three same-machine local-file rounds when `EMAP_GEOTIFF_LOCAL_FILE` is set. `EMAP_RASTER_BENCH_OUT` optionally records JSON. Metrics cover navigation-to-completion, first updated tile, animation frames with tile updates, and display-cache size. Source-cold rounds rebuild emap sources/caches but do not clear OS disk caches. This is not a native QGIS-versus-emap speed benchmark.

## Parallel decoding and background colorization

GeoTIFF uses a **tile-pipeline Worker pool**. Independent workers execute window I/O, decoding, assembly, resampling, stretching, and RGBA generation concurrently. This is not additional `Promise.all()` work on one thread, geotiff.js's block-level `Pool`, or a thread per TIFF block.

```ts
const loader = geoTIFFPlugin({
  workerUrl: '/assets/emap-geotiff-worker.js',
  workerCount: 2,
});
const renderer = rasterPlugin({ concurrency: 4 }); // Useful with workerCount: 4.
console.log(map.ctx.raster.getProcessingStats('imagery'));
```

`workerCount` accepts 1–4, defaulting to two (one when the browser reports two or fewer logical cores). One worker still colorizes off the main thread. A module-level quota permits at most four extra workers across sources, excluding each source's primary worker. When the quota is unavailable, requests use existing workers instead of spawning unbounded threads. Every replica uses the same `emap-geotiff-worker.js`; no new deployment asset is needed.

The primary worker validates TIFF/OVR metadata and collects bounded statistics. A second metadata-only replica can warm during initial view settling; further replicas start on demand. Replicas reuse identical statistics, without rescanning or introducing per-worker color seams. The mandatory >2GiB pyramid gate still runs before the first pixel read.

The main thread retains viewport scheduling, LOD choice, projection-mesh construction, and Canvas compositing. `RasterWarpMesh` uses Float64 coordinates and preserves exact pixel-center fallbacks at projection validity boundaries. The worker sends `RasterRenderResult.rgba` as a transferred ArrayBuffer; the display path no longer sends all raw UInt16/Float32 bands to the UI for colorization. `queryPixel()` and `readWindow()` still return original numerical samples.

`RasterSource.renderTile(RasterRenderRequest, signal)` is optional: GeoTIFF implements the background pipeline by default; third-party sources implementing only `readWindow()` retain the legacy main-thread colorization fallback. `getProcessingStats()` reports workers, busy workers, historical concurrency peak, queued jobs, reserved bytes, and rendered tiles. The example exposes worker/render counters.

Parallel tasks reserve an aggregate **64MiB per source for estimated decode + warp + RGBA buffers**; tasks wait when simultaneous reservations would exceed this budget. Queued outbound meshes are limited to 32MiB. The 8MiB decoded cache and 1MiB retained compressed-page budget per TIFF are divided among configured workers. Directory arrays across replicas stay within 32MiB, reducing replication when necessary. These limits exclude general browser-process and Worker-runtime overhead.

Cancellation settles the caller immediately, but the physical worker slot stays occupied until actual completion, preventing an unbounded stale CPU queue during repeated zooms. A 60-second watchdog remains. Layer/plugin disposal terminates every owned worker and releases queues, timers, listeners, and extra-worker leases. A worker crash fails and closes the source pool explicitly.

Main and Worker assets must come from the same build. `RASTER_WORKER_VERSION` identifies stale deployed Worker code. This design does not require SharedArrayBuffer, cross-origin isolation, OffscreenCanvas, or GPU rendering. Canvas upload/compositing remains on the main thread. Actual Windows improvements require same-data, same-viewport, same-style measurements on the target machine.

## Project references and privacy

`map.ctx.raster.toReferences()` returns only JSON-safe file identity, style, visibility and order. It includes no File, Blob, TIFF bytes or decoded cache.

```ts
const references = map.ctx.raster.toReferences();
await map.ctx.geoTIFF.addHandle(references[0].id, handle, {
  expected: references[0].source,
  style: references[0].style,
  overviewFile,
});
map.ctx.raster.setVisibility(references[0].id, references[0].visible);
```

The host owns permission checks, user-gesture permission requests, handle persistence, project migration and relinking UI. `addHandle()` obtains a fresh File and rejects mismatched filename, size or modification time. Handles are not portable JSON permissions. emap writes nothing to IndexedDB, OPFS or Cache Storage and never deletes the original when removing a layer.

Existing vector MSX snapshots do not embed rasters. Hosts must persist raster references separately. Integrating these references into Loom project storage is separate from this emap implementation.

## Budgets and scope

Display cache defaults to 64MiB (configurable 8–256MiB). Global tile concurrency defaults to two (1–4); per-source reads use a default two-worker pipeline pool, serial within each worker, with at most 16 queued/active requests. A request is limited to 4,194,304 source pixels and an estimated 64MiB decode budget including entire compressed blocks. At most 16 rasters are open. Metadata directories, field counts, byte ranges and safe integer offsets are validated. Stale views cancel obsolete reads; layer removal and plugin disposal release workers and canvases.

These budgets are not a total browser-process memory cap. Decoder, Worker, projection and canvas intermediates require additional memory.

Supported inputs are north-up GeoTIFF/BigTIFF with 8/16/32-bit integers or 16/32/64-bit floating-point samples in grayscale, RGB or palette color spaces. Known EPSG GeoKeys are recognized; otherwise supply `crs` explicitly. Display reprojection uses the existing CRS adapter and a locally refined inverse-warp grid, not four-corner stretching.

Rotated/sheared grids, independent TIFF validity masks, associated alpha, YCbCr/CMYK and 1/4-bit classification samples are explicitly rejected. Convert such inputs to north-up tiled TIFFs with pyramids and NoData or unassociated alpha first.

Tests cover small real TIFFs, BigTIFF, pyramids and a sparse file above the 2GiB threshold. Real 10/20/50GB imagery performance has not been benchmarked; no such capacity or latency guarantee is implied.

## Public contracts and standalone reads

`GeoTIFFPluginOptions` configures the Worker URL; `GeoTIFFAddOptions` adds CRS, external overviews, display style, cancellation and expected references. `RasterRenderOptions` sets cache/concurrency budgets. `RasterContract` manages the raster stack; `GeoTIFFContract` opens local files.

```ts
import { openGeoTIFF } from '@mapseekai/emap/geotiff';
const source = await openGeoTIFF(file, { workerUrl: '/assets/emap-geotiff-worker.js' });
try {
  const values = await source.readWindow({
    level: source.metadata.levels[0].id,
    window: [0, 0, 256, 256], // Must lie inside the image.
    samples: [0],
  });
  console.log(values.data[0]);
} finally {
  source.dispose();
}
```

`RasterBandStatistics` describes stable source-level display statistics. `RasterMetadata` and `RasterLevel` describe the source and available resolutions. A `RasterWindow` is a half-open pixel window `[left, top, right, bottom]`; when used for map bounds it is `[xmin, ymin, xmax, ymax]`. `RasterReadRequest` and `RasterReadResult` retain original typed `RasterSamples`.

`RasterLayerInfo` describes a layer, `RasterLayerReference` is serializable, and `RasterCacheStats` reports application cache state. Use `RasterError.code` for error-specific UI. Advanced providers register a synchronous `RenderPass` receiving `RenderFrame`; schedule asynchronous decoding outside it and bind the unregister function to plugin lifetime.

## Memory lifecycle checks

Removed sources are tracked only through weak loader ownership, not a historical metadata list. Decoder disposal clears TIFF directories and File/Blob references; serial queue sentinels do not retain the last decoded pixel result. Map/plugin teardown releases tile and fallback canvases, workers, pending callbacks, timers and rendering subscriptions. A failing custom source cleanup does not prevent other resources from closing; errors are aggregated afterward.

External `RasterSource` providers must respond to `AbortSignal` and close their own resources in `dispose()`. emap detaches cancelled waiters even when an external promise never settles, but cannot terminate network requests, threads or other resources created independently by a third-party plugin.

`test/browser/raster-memory.spec.mjs` uses Chromium CDP forced garbage collection and WeakRef to verify collection, recording heap, DOM, listener and Worker counts. It covers three warmup cycles followed by 30 load/navigation/removal cycles, 15 provider restarts, map disposal and uncooperative reads. JS heap measurements do not include every browser-process, Canvas/GPU or operating-system file-cache allocation; bounded regression tests are not a guarantee against leaks for every possible dataset.


## Performance Diagnostics

`geotiff-viewer` includes a Performance Diagnostics panel. Press **Start recording**, perform one zoom, pan, or style change, and the panel freezes when raster work settles. **Copy JSON** makes Windows/macOS comparisons reproducible.

The report includes wall time, LOD, viewport/DPR/logical cores, workers, tile/read counts, host planning and Canvas upload, presentation wait, cumulative Worker time, file range reads, TIFF block loads, window assembly, colorization/resampling, approximate Worker-to-host transfer, and compressed-page/decoded-block cache hit rates. `planning.passes/plannedTiles/current` separates cumulative planning generations during one operation from the **final current viewport** tile grid. `grid/tiles/idealViewportTiles/amplification/pixelSize/span` shows whether a count such as 168 tiles is one oversized final grid or accumulated work across view generations. The final grid remains bounded by the per-layer display-cache budget.

Decoded-block diagnostics also expose eviction count, admitted/evicted bytes, current/peak occupancy, capacity, entry counts, and oversize skips. An `evictionRate = evictions / misses` near one while peak occupancy stays near capacity is a strong cache-thrashing signal. `evictedMiB` measures operation churn, not a unique working-set size.

```ts
const before = map.ctx.raster.getStats();
// Perform one navigation operation.
const after = map.ctx.raster.getStats();
console.log(after.performance.fileReadMs - before.performance.fileReadMs);
console.log(after.performance.colorizeMs - before.performance.colorizeMs);
```

`RasterCacheStats.performance` contains cumulative counters; hosts should diff two snapshots. Worker tasks run in parallel, so `workerMs`, `fileReadMs`, and `blockLoadMs` are accumulated task durations and **must not be summed as wall-clock time**. The example's `decodeApprox` is `blockLoadMs - fileReadMs`, useful for bottleneck triage rather than exact CPU profiling. `transferMs` also includes Worker message scheduling and is approximate.

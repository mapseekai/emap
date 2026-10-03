# emap tasklane migration

All emap-owned Web Workers use `@mapseekai/tasklane@0.2.0-beta.2` (protocol v7). DuckDB-Wasm retains its official Worker, initialization, protocol and lifecycle.

| Workload | Ownership and cancellation |
| --- | --- |
| Mapshaper commands | Runtime scope; budgeted asynchronous packing; hard cancellation; independently scheduled worker slots |
| GPU geometry | Session containing the bounded exact triangulation cache; transferable batches; hard cancellation and a fresh generation on retry |
| MSDF text | Session containing the font engine and WASM heaps; cooperative cancellation; explicit engine disposal |
| GeoTIFF | One Session per decoder replica; File references use Blob limits; physical settlement controls decode-slot admission |
| GeoPackage | Import Session followed by pull-based leased chunks; the final arc chunk precedes a separate end sentinel |
| Benchmark import and LOD | A module Worker Session owns the imported render dataset and LOD source |

## Runtime ownership

A map creates a lazy runtime and disposes it through its native Cordis lifecycle. Mapshaper, geometry and font clients borrow that runtime. Optional GeoTIFF providers also use it when no custom worker URL is specified. Standalone import/source/font/geometry clients own their fallback runtime, keeping lifecycle and resource budgets local to their owners.

Applications can explicitly share one runtime:

```ts
import { createEmapWorkerRuntime, Emap } from '@mapseekai/emap';
import { geoTIFFPlugin } from '@mapseekai/emap/geotiff';
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';

const workers = createEmapWorkerRuntime({
  urls: {
    mapshaper: '/assets/emap-worker.js',
    geometry: '/assets/emap-geometry-worker.js',
    msdf: '/assets/emap-msdf-worker.js',
    geotiff: '/assets/emap-geotiff-worker.js',
    geopackage: '/assets/emap-geopackage-worker.js',
  },
  sizes: { mapshaper: 2 },
});
const map = await Emap.create({
  container: 'map',
  workerRuntime: workers,
  useWorker: 'auto',
  plugins: [
    geoTIFFPlugin(),
    geoPackagePlugin({ workerUrl: '/assets/emap-geopackage-worker.js', workerRuntime: workers }),
  ],
});
// After all consumers have finished:
await map.dispose();
await workers.dispose();
```

Injected runtimes are borrowed, never destroyed by individual maps or clients. Their configured pool asset URLs take precedence over per-client URLs. A custom GeoTIFF provider URL without an explicit runtime keeps its own runtime so that existing URL overrides remain effective. `openGeoTIFF` and `importGeoPackageInWorker` both accept `workerRuntime` for explicit application ownership. The existing injected `workerPool` option retains its exclusive map ownership semantics.

The main bundle and all worker assets must be deployed from the same build. Mapshaper and GeoPackage retain their sibling mapshaper vendor asset; GeoPackage retains `sql-wasm.wasm`; MSDF retains its `msdf/` assets. The benchmark module worker uses Vite's `?worker&url` asset handling.

## Admission and data boundaries

### Cache-aware raster routing and adaptive capacity

`openGeoTIFF(file, { workerScheduling: 'cache-aware' })` opts tiled levels into
Tasklane SessionGroup scheduling. Readers report at most 128 recent resident
spatial block keys; trimming and disposal remove stale residency. Warm requests
are restricted to the best resident members before native scheduling, so an idle
cold replica does not repeatedly decode a busy reader's warm blocks. Cold requests
can use idle replicas. Row-striped levels still use their enlarged primary cache.
Cache gauges are attributed to the Session that actually executed the task. Group requests are bounded by the source's existing
16-request and 64 MiB decode limits, including native queued/cancelling work;
waiting on a warm reader does not consume another reader's dispatch permit.
Cold submissions are limited to the ready reader count; overflow stays in the
source queue to refresh resident hints and include newly opened replicas. `busyWorkers` and `peakWorkers` count this source's physical
task occupancy (including preparation and cancellation barriers), not submitted
requests. `queuedTasks` includes both source and native admission queues;
`dispatchedTasks` counts runtime submissions, including admission waits. These
metrics do not include other sources borrowing the same runtime.

The default remains `workerScheduling: 'spatial'`: the measured cold-read benefit
was small and varied by workload, while unconditional idle-reader dispatch caused
additional warm decodes. The opt-in path includes the warm-residency safeguard;
these measurements describe cold reads and warm decodes. Both policies retain the same source-wide
decode/cache budgets, result ownership and physical cancellation barriers.

Applications can enable pool feedback control independently:

```ts
const workers = createEmapWorkerRuntime({
  adaptive: { geotiff: { sampleMs: 1000, idleMs: 30_000 } },
});
const source = await openGeoTIFF(file, {
  workerRuntime: workers,
  workerScheduling: 'cache-aware',
});
```

For a configured adaptive GeoTIFF pool, omitted minima preserve two initial slots
(clamped to the configured pool size) and the full 256 MiB cache reservation per
Worker. The cache reservation is an admission ceiling, not an eager allocation.
This protects pinned reader metadata and storage-aware decoded-block caches from
Tasklane's generic quarter-cache starting target. Explicit minima still override
these defaults; lower cache targets must accommodate the reader's 128 MiB floor
plus its decoded-block cache. Once pressure returns to normal and capacity grows,
the next raster read restores its decoded cache up to the original source budget.
The current pool target is sampled at native task admission, and the Worker admits
the resource growth before raising the reader limit. Rejected growth leaves reads
usable with the smaller cache; recovery does not prefetch or allocate cache blocks.

When an adaptive pool still has growth headroom under normal memory pressure,
primary/replica admission can wait so the controller sees the demand. These waits
are bounded at five seconds and respect cancellation; an optional replica timing
out leaves the primary usable. Fixed-capacity defaults retain immediate rejection
when only mandatory readers exhaust capacity. Idle shrinking may reclaim optional
replicas but preserves mandatory readers; subsequent reads tolerate reclaimed
members. Adaptive control stays off by default to preserve burst capacity and
avoid a recurring controller where the workload does not need one.

`test/browser/raster-scheduling.spec.mjs` compares identical windows and SHA-256
sample hashes, verifies three-renderer zoom/return imagery, and checks cleanup.
Set `EMAP_SCHEDULING_FILE` to a local TIFF and `EMAP_SCHEDULING_OUT` to a JSON path
for a repeatable three-round cold/warm comparison. Source files are read in place.

The default shared runtime permits 19 physical workers, 4 active tasks, 1 asynchronous preparation and 64 queued tasks. Pool capacities are Mapshaper 1, geometry 4, MSDF 4, GeoTIFF 8 and GeoPackage 2. Sessions reserve exclusive slots; applications sharing the runtime across more consumers must configure pool sizes and overall limits together.

Import task envelopes are bounded at 2 GiB. The shared runtime adds 192 MiB of input and 768 MiB of output headroom to its 2 GiB bulk reservations, allowing three interactive tasks alongside a maximum-size bulk task. Scratch reservations remain 4 GiB. Standalone runtimes retain their existing ceilings. Partial application budget overrides preserve unspecified Emap defaults. Explicit Mapshaper parallelism scales those envelopes for up to four simultaneous jobs. Worker cache reservations are bounded separately: geometry 64 MiB, MSDF/GeoTIFF 256 MiB per worker, GeoPackage 2 GiB. Decoded raster cache leases additionally share a 256 MiB resident budget within each emap runtime; independent runtimes have independent budgets. These are conservative admission reservations, not eager allocations or a guarantee about browser process RSS. Existing geometry batch, raster block-cache, decode, tile and GeoPackage import limits remain in force.

`MapshaperWorkerPool.jobTimeoutMs` now requires an integer from 1 to 2147483647. The old `0` (unbounded) value is rejected explicitly because tasklane requires bounded execution; no current emap caller uses that value.

The runtime handles scheduling, handshake, timeouts, physical cancellation, worker generations and result leases. Raster spatial routing, block-cache admission, feature triangulation, stale-result checks, history and selection remain emap responsibilities. Cooperative cancellation rejects callers promptly but does not release physical slots or scratch credits until `handle.settled`.

Mapshaper and imported datasets use binary envelopes to avoid tasklane's object-graph limits. The envelope preserves dates (including invalid dates), typed-array element types, exact view bytes and attribute keys (including `__proto__`). Unsupported object kinds, accessors and cyclic data are rejected rather than silently corrupted. Result leases are released after decoding/consumption. GeoPackage consumes one chunk at a time; cancellation discards the incomplete receiver and closes its Session.

## Verification

Regression coverage includes 50,000-shape binary round trips, parallel Mapshaper jobs, cancellation/restart, borrowed runtime isolation, physical settlement accounting, final GeoPackage arcs, cache retention and late-result rejection. Browser coverage exercises the built classic/module worker assets, local WASM, GIS data parity, WebGL/WebGPU geometry, text and disposal.

The existing optional multi-gigabyte private-file benchmarks remain opt-in through `EMAP_BENCHMARK_DATA_DIR`. Run the repository test suite excluding historical source snapshots under `test-results/` when that local directory contains copied repositories.

Validated on 2026-09-25:

- Full Vitest run: 300 files and 4,237 tests passed; 56 tests skipped. Final cross-entry error normalization changes also passed the affected 117-test regression run, including the new foreign-bundle error contract.
- Production build and bundle smoke passed (11 required files, 36 package export targets).
- Typecheck, public type contracts, examples types, API surface, architecture (532 modules; no runtime cycles), test layout, changed-TypeScript formatting/lint and documentation verification passed.
- Built-asset browser regressions: 54 Chrome cases and 8 cases each in Firefox/WebKit passed after correcting the test-only protocol probe. Three private-file Chrome benchmarks were skipped. Coverage includes actual 50,000-point parallel Mapshaper tasks, public map operation events/CRS, GeoPackage parity/cancellation, GeoTIFF parallel decoding/removal, WebGL/WebGPU geometry and MSDF rendering.
- DuckDB source and its dependency versions are unchanged. No commit, publication or deployment was performed.

## Follow-up audit fixes — 2026-09-25

The audit reproductions are now permanent regressions in `test/integration/worker/tasklane-regressions.test.ts`, with additional binary tests and a real-browser Date round trip in `test/browser/tasklane-migration.spec.mjs`.

Date fields survive Mapshaper commands without being converted to empty objects. A maximum-size Mapshaper task can coexist with three full interactive reservations. Lost geometry/MSDF sessions get a fresh generation; synchronous raster enqueue failures reach the fatal callback and close the invalid source. SessionOwner, Mapshaper pool and raster-source disposal retain failed cleanup for retry instead of permanently chaining rejected promises.

GeoTIFF primary admission reclaims only idle optional replicas and returns capacity after physical disposal. Five sources under the two-reader policy and eight concurrent primaries are covered. Exhausting all eight primary slots fails immediately with `RASTER_WORKER_CAPACITY`; it does not implicitly raise the physical limit or wait for the task queue timeout. This admission descriptor is shared across independently bundled public entries. Arbitrary application-created tasklane runtimes must coordinate their own persistent sessions.

Follow-up verification: 301 Vitest files / 4,253 tests passed, 56 tests skipped, excluding historical `test-results/` source snapshots. Chrome: 18 browser cases passed and one private-file case skipped. Firefox/WebKit: three migration cases each passed, including Date preservation. Production build, bundle smoke, examples, full `docs:verify`, architecture, changed-TypeScript formatting and lint passed. GitNexus and CodeGraph indexes were refreshed. No commit, push, publication or deployment was performed.

The 2 GiB bulk task ceilings remain conservative ceilings; the added interactive headroom controls admission, while peak RSS requires separate measurement. Size-aware bulk reservations, chunked main-thread serialization and separate transferable arc buffers remain performance follow-ups. GeoTIFF LOD/decoder algorithms and DuckDB retain their existing implementations.

## Follow-up resolution — 2026-09-26

The continuous-queue regression required a tasklane scheduling correction, retained in `patches/@mapseekai__tasklane@0.1.0-beta.3.patch` and the lockfile. Reservations no longer protect work that cannot obtain a physical slot, and cannot block higher effective priorities. Same-priority fairness remains intact.

The shared raster admission descriptor now includes live pool occupancy, the global worker ceiling and cache budget. Its lease registry is shared across entry bundles. Retiring replicas leave affinity routing immediately, but their capacity remains reserved until confirmed physical release; failed cleanup can be retried without breaking reads on the original source.

Geometry, label and raster providers expose physical cleanup barriers to native Cordis teardown. The public map verifies those barriers and retains failed resource owners for a subsequent `dispose()` retry. Borrowed runtimes remain borrowed. Partial Session construction is atomic, and array-index accessors are rejected without invocation.

Known Mapshaper input preparation uses a conservative data-dependent bound. GeoPackage announces a chunk bound before its consume task, rather than reserving 2 GiB output for every chunk. Large buffers are separate transferable attachments; small attribute blobs stay inside MessagePack. Benchmark transfer lists are now used, and the obsolete production stream wrapper has been removed. Arbitrary Mapshaper output retains the existing 2 GiB ceiling; this is not an actual-memory or frame-latency guarantee.

The seven original re-review reproductions are retained in `test/integration/worker/tasklane-lifecycle.test.ts`, alongside higher-priority reservation and cross-pool capacity cases. Map-level cleanup waiting/retry and real-browser large arc-buffer ownership have dedicated regressions.

Verified after this follow-up:

- Full Vitest run excluding historical `test-results/**` copies: 302 files and 4,269 tests passed; one file / 56 tests skipped.
- Chrome built-asset regressions: 19 passed, one optional private-file case skipped; includes WebGL/WebGPU text, actual 50,000-point tasks and a 40,000-vertex arc-buffer round trip without detaching the source.
- Firefox and WebKit built-asset regressions: 10 passed per browser, covering migration, GeoPackage and parallel raster lifecycle.
- Production build, bundle smoke, examples build, `docs:verify`, changed-code format/lint, architecture and test-layout checks passed. Architecture reports 533 production modules and no runtime cycles.
- GitNexus and CodeGraph refreshed; affected symbols reviewed. DuckDB source and dependency versions are unchanged. No commit, push, publication or deployment performed.

No multi-gigabyte private-file benchmark or browser peak-RSS study was performed in this follow-up. Hybrid transfer avoids large-buffer MessagePack copies but does not make all object-metadata encoding asynchronous or guarantee a particular frame rate.

## Native resource APIs — tasklane 0.2.0-beta.2

This section supersedes the earlier custom-admission and local-patch implementation described in the historical verification notes above. The package is pinned explicitly: the registry's newest published beta is `0.2.0-beta.2`, while its `latest` tag still points to `0.1.0-beta.1` as of 2026-09-26.

- GeoTIFF uses `scope.acquireSession`: required primary readers and explicitly reclaimable replicas. Native admission owns pool/global/cache limits and physical cleanup. Idle ordinary Workers in other pools may also be reclaimed. No custom `SessionCapacity` registry or endpoint termination counter remains.
- Capacity occupied exclusively by required sessions fails promptly with `RASTER_WORKER_CAPACITY`. If optional readers or idle ordinary Workers exist, admission can wait for cleanup, bounded by the runtime queue timeout and a five-second cancellation cap. Replica handles marked `reclaimed` leave spatial routing before the next dispatch and can be rebuilt when capacity returns. Failed cleanup retains its retry barrier.
- Decoded block caches use Scope-owned resident resource leases. The default shared budget is 256 MiB **per runtime**, replacing the module-global counter; independent standalone sources no longer consume each other's hidden allowance or global four-replica limit. Share a runtime when aggregate limits across sources/maps are required. Explicit `limits.budgets.residentBytes` overrides remain effective.
- Reader resources report decoded block-cache bytes and cumulative hits/misses/evictions through native diagnostics. Their trim callbacks evict blocks and lower the cache limit before returning cache credits. Directories, compressed pages and required reader state retain a conservative 128 MiB reservation floor; a trim below this floor reports a maintenance failure while leaving the primary usable. Reported `usedBytes` covers decoded blocks, not complete reader RSS. Scope resident credits remain conservative for the source lifetime. A subsequent read under normal pressure restores the decoded limit within both the current pool capacity and the original source allocation. Queued requests sample capacity at dispatch so an older request cannot undo later pressure maintenance.
- GeoPackage uses `createSizedResultSource` and `iterateSizedResults` for descriptor/token validation, output admission, one-chunk backpressure, result release and cursor cleanup. Binary envelopes, final arcs, cancellation, transactional receiver semantics and borrowed runtime ownership remain intact.
- The reservation correction was absorbed upstream in beta.4; the obsolete beta.3 patch and its lockfile registration are removed. All classic and module Worker bundles must be rebuilt with the main package because the wire protocol is now v7.

Spatial routing remains specific to raster storage. SessionGroup affinity, adaptive sizing and explicit interactive reserves are available through the injected runtime but are not enabled by default; they require workload-specific policy. No GPU renderer, DuckDB protocol or GIS transaction contract is changed by this upgrade. The historical test counts above describe earlier runs, not validation of this version.

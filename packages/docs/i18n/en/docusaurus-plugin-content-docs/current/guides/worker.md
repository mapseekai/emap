---
id: worker
slug: /guides/worker
title: Web Worker
api: ["Emap", "MapOptions", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions", "createEmapWorkerRuntime", "EmapWorkerRuntimeOptions", "EmapWorkerPool"]
examples: ["web-worker"]
stability: stable
verifiedVersion: 0.14.0
---

# Web Worker

Emap supports Worker execution for dataset replacements, size-based routing, job cancellation, and result-version checks. Independent sources can process concurrently while the main thread stays responsive.

```ts
const map = await Emap.create({
  container: 'map', // mount the map
  useWorker: 'auto', // route by command and data size
  workerThreshold: 50_000, // choose a Worker at this vertex count
  workerUrl: '/assets/emap-worker.js', // published Worker bundle
  workerPoolSize: 2, // at most two concurrent Workers
});
```

## Core parameters

Worker-related `MapOptions` for `Emap.create(options)`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `useWorker` | `boolean \| 'auto'` | `false` | `false` uses the main thread; `true` routes every operation through a Worker; `'auto'` routes by command and data size. |
| `workerThreshold` | `number` | `50_000` | `'auto'` vertex threshold; selects a Worker at or above it. |
| `workerUrl` | `string` | `'emap-worker.js'` | Worker bundle URL; relative URLs resolve against `document.baseURI`. |
| `workerPoolSize` | `number` | `1` | Worker-slot count and peak parallelism; spawns lazily under load. |
| `workerPool` | `MapshaperWorkerPool` | — | Preconstructed pool; takes precedence over `workerUrl` and `workerPoolSize`. |
| `workerRouting` | `WorkerRoutingFn` | — | Per-operation route decision. |

## More routing control

Workers cover the mapshaper dataset-replace path, including `clip`, `dissolve`, `union`, `mosaic`, `simplify`, and `project`; selection-level edits stay on the main thread. In `'auto'`, lightweight commands stay on the main thread, costly commands use `floor(workerThreshold × 0.5)`, and `classify` compares that threshold against layer records.

`workerRouting` can override the default decision; both `'auto'` and `true` invoke it:

```ts
const map = await Emap.create({
  container: 'map',
  useWorker: 'auto',
  workerRouting: ({ heads, defaultDecision }) => {
    if (heads.includes('buffer')) return true;
    return defaultDecision;
  },
});
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `cmd` | `string` | — | Original command text. |
| `heads` | `string[]` | — | Parsed command names. |
| `vertexCount` | `number` | — | Source arc vertex count. |
| `recordCount` | `number` | — | Total layer records; `classify` uses it for scale. |
| `mode` | `boolean \| 'auto'` | — | Current `useWorker` setting. |
| `threshold` | `number` | — | Configured `workerThreshold`. |
| `defaultDecision` | `boolean` | — | Engine default route decision. |

## Result commit and version checks

The Worker path exports the dataset before dispatch and restores it on return; `workerjobstart` and `workerjobend` provide ID, command, duration, and outcome. Before commit, Emap checks map lifecycle, source, original dataset, `editVersion`, `attributeVersion`, and transaction state. Any change returns `ok: false` with `error.kind: 'stale-operation'`, preserving newer state.

Dataset replacement creates a history boundary. `map.cancelWorkerJobs()` cancels running and queued jobs; the pool then creates Workers on demand.

## Publish Worker assets

Publish these installed-package files; point `workerUrl` to the first:

| File | Purpose | Deployment location |
| --- | --- | --- |
| `dist/emap-worker.js` | Fixed-name Worker bundle; loads its vendor relatively. | Same public directory as `mapshaper-vendor.js` |
| `dist/mapshaper-vendor.js` | Classic-script mapshaper vendor for the Worker. | Sibling of `emap-worker.js` |
| `dist/mapshaper-vendor.mjs` | ESM vendor. | Application ESM loading path |

```text
node_modules/@mapseekai/emap/dist/emap-worker.js
node_modules/@mapseekai/emap/dist/mapshaper-vendor.js
```

```text
public/assets/emap-worker.js
public/assets/mapshaper-vendor.js
```

`emap-worker.js` loads its vendor with `importScripts('mapshaper-vendor.js')`; the classic-script files must remain adjacent and both URLs must serve JavaScript.

## Use your own Worker pool

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `workerUrl` | `string` | Required | Bundle URL passed to `new Worker()`. |
| `WorkerCtor` | `typeof Worker` | `globalThis.Worker` | Worker-constructor override. |
| `poolSize` | `number` | `1` | Worker slot count, floored and at least `1`; spawns lazily under load. |
| `jobTimeoutMs` | `number` | `120_000` | Request timeout in milliseconds; terminates the Worker on timeout; must be an integer from `1` to `2147483647`. |

```ts
const workerPool = new MapshaperWorkerPool({
  workerUrl: '/assets/emap-worker.js',
  poolSize: 2,
});

const map = await Emap.create({ container: 'map', useWorker: true, workerPool });
```

The map exclusively manages a supplied `workerPool`; `await map.dispose()` cancels jobs, destroys Workers, and releases resources.

## Runnable examples

- [Web Worker](/mapseekai/emap/examples/web-worker/)

## Shared tasklane runtime

Emap uses `@mapseekai/tasklane` for Mapshaper, geometry, MSDF fonts, GeoTIFF and GeoPackage Workers. DuckDB retains its official Worker and protocol. A map owns its default runtime and releases it on disposal. Standalone clients own their runtime unless one is supplied.

Use `createEmapWorkerRuntime(options: EmapWorkerRuntimeOptions)` to share a runtime. `EmapWorkerPool` names the five pools; `urls` selects matching Worker assets, `sizes` sets pool capacities, and `limits` configures tasklane admission limits. Resources are created lazily. Supply all needed asset URLs when the bundler relocates assets.

```ts
import { Emap, createEmapWorkerRuntime } from '@mapseekai/emap';

const runtime = createEmapWorkerRuntime({
  urls: {
    mapshaper: '/emap-worker.js',
    geometry: '/emap-geometry-worker.js',
    msdf: '/emap-msdf-worker.js',
    geotiff: '/emap-geotiff-worker.js',
    geopackage: '/emap-geopackage-worker.js',
  },
});
const map = await Emap.create({ container: 'map', workerRuntime: runtime });
// Later, dispose every consumer before releasing the shared runtime.
await map.dispose();
await runtime.dispose();
```

An injected `workerRuntime` is borrowed: disposing a map or client closes its scope and sessions without disposing the shared runtime. Its owner must call `runtime.dispose()`. A custom runtime must configure the named pools its consumers use. Worker assets and the main bundle must come from the same build. GeoPackage import also accepts `workerRuntime` in its import options; GeoTIFF accepts it in its open options.

The shared runtime reserves an additional 192 MiB of input and 768 MiB of output admission credits for three interactive tasks, so one maximum-size Mapshaper task does not monopolize both budgets. Memory is allocated on demand against these admission credits. Explicit `limits.budgets` values still take precedence; unspecified fields retain Emap defaults. Priority changes do not preempt running tasks.

GeoTIFF uses native tasklane `acquireSession` admission: primaries are required, reconstructible replicas are explicitly reclaimable, and slots return only after physical cleanup. The default shared GeoTIFF pool permits eight readers. Capacity occupied exclusively by required sessions fails promptly with `RASTER_WORKER_CAPACITY`. When optional replicas or ordinary idle Workers exist, admission may wait within both the runtime queue timeout and a five-second cancellation cap. Application-created tasklane runtimes use the same admission API.

Geometry and MSDF clients replace lost sessions with a fresh generation. A lost raster reader fails its source; reopen the file rather than reading through an empty replacement session. Failed disposal retains cleanup records for retry through the client's disposal method, without destroying a borrowed runtime.

The Worker binary envelope preserves dates (including invalid dates), typed-array element types, exact view bytes, and special attribute keys. Supply encodable data objects; objects outside the encoding set, accessors, and cycles produce explicit errors.

### Continuous work and physical cleanup

Emap pins `@mapseekai/tasklane@0.2.0-beta.2`, using protocol v7. Rebuild and deploy the main package and all Workers together. The former local scheduling patch is now upstream and has been removed; reservations preserve same-priority fairness without blocking physically runnable work at a higher effective priority.

GeoTIFF decoded block caches use Scope-owned resident leases, sharing 256 MiB per emap runtime by default. Independent runtimes have independent budgets; share `workerRuntime` to enforce aggregate limits across sources/maps. Reclaimed replicas leave spatial routing before the next dispatch, while failed cleanup retains retry records. Readers publish block-cache hits, misses and evictions through `resourceCacheStats` and support `runtime.trim()`. Required reader state retains a conservative 128 MiB floor; shrinking below it reports a maintenance failure. Measure complete RSS separately with process tools. Once memory pressure is normal and pool capacity permits, the next read restores the decoded limit up to the source's original allocation. Queued tasks sample the current budget at dispatch; the Worker admits native resource growth before raising the reader limit. Reads continue with the smaller cache when growth is refused. Recovery does not prefetch or eagerly allocate blocks, and does not require reopening the source.

`await map.dispose()` waits for geometry, font and raster cleanup barriers. A repeated call retries retained cleanup failures without destroying a borrowed runtime. Standalone raster providers may expose `settled`, which can be awaited after `dispose()`.

### Binary transport and budgets

Known Mapshaper inputs use a conservative data-dependent bound; opaque preparation callbacks retain the maximum input envelope. Arbitrary command output cannot reliably be predicted from input size, so its 2 GiB output ceiling remains. Reservations control admission; memory is allocated on demand and browser heap usage is measured separately.

Mapshaper, GeoPackage and the benchmark use a hybrid envelope. Large binary views travel separately; caller-owned inputs are preserved by default. Explicitly owned full buffers transfer directly, while partial views copy only their actual range. Small BLOBs stay within the metadata envelope to avoid exceeding the transport's backing-store count limit.

GeoPackage uses native `createSizedResultSource` / `iterateSizedResults` and announces the next chunk's output bound before the receiver reserves and consumes it. Small chunks no longer each reserve 2 GiB of output. Final arcs remain a data chunk followed by a distinct end sentinel. Deploy the main bundle, Worker assets and WASM from the same build.

---
id: worker
slug: /guides/worker
title: Web Worker
api: ["Emap", "MapOptions", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions"]
examples: ["web-worker"]
stability: stable
verifiedVersion: 0.12.0
---

# Web Worker

Emap can send dataset-replace operations to a Web Worker while the main thread stays responsive; independent sources can process concurrently.

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
| `jobTimeoutMs` | `number` | `120_000` | Request timeout in milliseconds; positive values terminate the Worker, `0` disables timeout; finite and non-negative. |

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

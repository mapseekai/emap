---
id: worker
slug: /guides/worker
title: Web Worker
api: ["Emap", "MapOptions", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions"]
examples: ["web-worker"]
stability: stable
verifiedVersion: unreleased
---

# Web Worker

Emap can run dataset-replace operations in a Web Worker so the main thread remains responsive during long processing. A worker serializes input and output datasets, which suits heavier work and concurrent work over independent sources.

## Configure routing

Set `useWorker` when creating the map:

```ts
const map = await Emap.create({
  container: 'map',
  useWorker: 'auto',
  workerThreshold: 50_000,
  workerUrl: '/assets/emap-worker.js',
  workerPoolSize: 2,
});
```

| `useWorker` | Behavior |
|---|---|
| `false` | Run operations on the main thread |
| `true` | Run dataset-replace operations through a worker |
| `'auto'` | Route from source vertex count and `workerThreshold` |

Bulk dataset-replace operations can run in a worker; selection-level edits such as vertex commands and translating selected features run on the main thread.

## Publish worker assets

An application must publish these files from the installed package and point `workerUrl` at the first one:

```text
node_modules/@mapseekai/emap/dist/emap-worker.js
node_modules/@mapseekai/emap/dist/mapshaper-vendor.js
```

Keep both files in the same public directory, for example:

```text
public/assets/emap-worker.js
public/assets/mapshaper-vendor.js
```

The worker loads `mapshaper-vendor.js` from its own directory. The static server must return JavaScript for both URLs, not an application HTML fallback.

## Use your own worker pool

Pass a pool when independent sources need concurrent operations:

```ts
const workerPool = new MapshaperWorkerPool({
  workerUrl: '/assets/emap-worker.js',
  poolSize: 2,
});

const map = await Emap.create({ container: 'map', useWorker: true, workerPool });
```

The map exclusively manages a supplied `workerPool` and destroys it during native Cordis teardown; use `await map.dispose()` to wait for cleanup to finish. Do not pass one pool to multiple maps.

## Runnable examples

- [Web Worker](/mapseekai/emap/examples/web-worker/)

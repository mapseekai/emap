---
id: worker
slug: /guides/worker
title: Web Worker
api: ["Emap"]
examples: ["web-worker"]
stability: stable
verifiedVersion: 0.5.0
---

# Web Worker

Worker routing moves heavier dataset-replace operations off the main thread. It
can reduce UI stalls during long work, but dataset serialization means it is
not faster for every task.

## Routing modes

| `useWorker` | Behavior |
|---|---|
| `false` | Default; run every operation on the main thread |
| `true` | Route every eligible dataset-replace operation |
| `'auto'` | Choose from vertex count, command cost, and routing rules |

Start with `'auto'`:

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerThreshold: 50000,
  workerUrl: '/assets/emap-worker.js',
});
```

`workerThreshold` defaults to `50000` arc vertices. A boolean `useWorker`
ignores the threshold.

## Eligible work

Good worker candidates include buffer, clean, clip, erase, dissolve, union,
mosaic, simplify, and project operations.

Selection, feature translation, rotation, and vertex editing stay on the main
thread because their cost is normally lower than pack, postMessage, and unpack
overhead. `useWorker` does not move rendering or browser pointer events into a
worker.

## Deploy static files

Copy these package files:

```text
node_modules/@mapseekai/emap/dist/emap-worker.js
node_modules/@mapseekai/emap/dist/mapshaper-vendor.js
```

Into a public layout such as:

```text
public/
└─ assets/
   ├─ emap-worker.js
   └─ mapshaper-vendor.js
```

The default worker runs:

```js
importScripts('mapshaper-vendor.js');
```

Keep the files together. A relative `workerUrl` resolves against
`document.baseURI`; verify the final public URL when deploying under a
subpath.

## Worker pool

The default pool size is `1`. Increase it only for concurrent work over
independent sources:

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerPoolSize: Math.max(1, navigator.hardwareConcurrency - 1),
  workerUrl: '/assets/emap-worker.js',
});
```

Every worker loads a mapshaper instance. More parallelism also means more
memory. Workers spawn lazily, but CPU count alone is not a reason to use the
maximum.

Advanced applications may pass a prebuilt `MapshaperWorkerPool` to one map
through `workerPool`. The map adopts that pool exclusively and cancels and
destroys it from `map.remove()`; do not pass one pool to multiple maps. The
pool owns URL and size configuration. With `useWorker: false`, `workerPool` is
ignored and remains caller-owned.

## Custom routing

`workerRouting` can override an `'auto'` decision:

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerRouting: ({ defaultDecision }) => defaultDecision,
});
```

The callback receives command heads, vertex count, threshold, and the default
decision. Override it only after measuring representative application data.

## Operation state and cancellation

Worker and main-thread operations share the same Promise and `OpResult`:

```ts
setBusy(true);

try {
  const result = await map.ops.simplifyLayer({
    source: 'main',
    percentage: 0.25,
  });

  if (!result.ok) {
    showError(result.error);
  }
} finally {
  setBusy(false);
}
```

Internal worker-pool `workerjob*` signals are not public `map.on` events.
Manage progress around the operation Promise.

Cancel queued or running jobs with:

```ts
map.cancelWorkerJobs();
```

Cancellation is useful when leaving a page, replacing sources, or honoring an
explicit user action. The current Promise still needs failure handling.

## Troubleshooting

- For a worker 404, open `workerUrl` directly and confirm the server returns
  JavaScript rather than the application HTML fallback.
- For a vendor 404, place `mapshaper-vendor.js` beside the worker.
- If small data became slower, use `'auto'` and tune `workerThreshold` from
  measurements.
- If memory is high, reduce `workerPoolSize`; each slot owns an independent
  mapshaper instance and may retain packed input/output during processing.

## API

- [MapOptions](/mapseekai/emap/api/interfaces/index.MapOptions.html)
- [MapshaperWorkerPool](/mapseekai/emap/api/classes/index.MapshaperWorkerPool.html)
- [MapshaperWorkerPoolOptions](/mapseekai/emap/api/interfaces/index.MapshaperWorkerPoolOptions.html)

## Runnable examples

- [Web Worker](/mapseekai/emap/examples/web-worker/)

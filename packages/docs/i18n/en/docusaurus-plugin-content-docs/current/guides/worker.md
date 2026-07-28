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

Worker routing moves heavy dataset-replace operations off the main thread. It does not route tiny selection edits because serialization overhead is larger than the work.

## Behavior notes

`useWorker: true` routes all eligible operations; `auto` routes by vertex count and command cost; `workerUrl` defaults to `emap-worker.js`.

## API

- [src.MapshaperWorkerPool](/emap/api/classes/index.MapshaperWorkerPool.html)
- [src.MapOptions](/emap/api/interfaces/index.MapOptions.html)

## Runnable examples

- [web-worker](/emap/examples/web-worker/)

## Minimal snippet

```ts
const map = new Emap({ container: "map", useWorker: "auto", workerUrl: "/dist/emap-worker.js" })
```

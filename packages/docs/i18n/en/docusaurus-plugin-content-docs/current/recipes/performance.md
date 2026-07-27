---
id: performance
slug: /recipes/performance
title: Performance
api: ["Emap"]
examples: ["simplify","simplify-control","web-worker"]
stability: stable
verifiedVersion: 0.5.0
---

# Performance

Keep render work small: use layer visibility, simplification, worker routing, and stable paint objects instead of reloading data on every interaction.

## Behavior notes

Large topology operations should use `useWorker: "auto"` and an appropriate `workerThreshold`; small pointer edits should stay on the main thread.

## API

- [src.MapOptions](https://zwishing.github.io/emap/api/interfaces/index.MapOptions.html)
- [src.MapshaperWorkerPool](https://zwishing.github.io/emap/api/classes/index.MapshaperWorkerPool.html)

## Runnable examples

- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)
- [simplify-control](https://zwishing.github.io/emap/examples/simplify-control/)
- [simplify](https://zwishing.github.io/emap/examples/simplify/)

## Minimal snippet

```ts
const map = new Emap({ container: "map", useWorker: "auto", workerThreshold: 50000 })
```

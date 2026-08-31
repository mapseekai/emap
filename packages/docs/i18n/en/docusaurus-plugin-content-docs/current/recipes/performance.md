---
id: performance
slug: /recipes/performance
title: Performance
api: ["Emap"]
examples: ["simplify","simplify-control","web-worker"]
stability: stable
verifiedVersion: 0.8.1
---

# Performance

Keep render work small: use layer visibility, simplification, worker routing, and stable paint objects instead of reloading data on every interaction.

## Behavior notes

Large topology operations should use `useWorker: "auto"` and an appropriate `workerThreshold`; small pointer edits should stay on the main thread.

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.MapshaperWorkerPool](/mapseekai/emap/api/classes/emap.MapshaperWorkerPool.html)

## Runnable examples

- [web-worker](/mapseekai/emap/examples/web-worker/)
- [simplify-control](/mapseekai/emap/examples/simplify-control/)
- [simplify](/mapseekai/emap/examples/simplify/)

## Minimal snippet

```ts
const map = new Emap({ container: "map", useWorker: "auto", workerThreshold: 50000 })
```

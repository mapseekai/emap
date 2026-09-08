---
id: performance
slug: /recipes/performance
title: Performance
api: ["Emap", "MapOptions", "SimplifyOptions"]
examples: ["simplify", "simplify-control", "web-worker"]
stability: stable
verifiedVersion: 0.9.0
---

# Performance

Focus performance work in three places: route large data operations to a worker, simplify geometry that does not need full detail, and avoid rendering features outside the viewport.

## Enable workers for large data operations

```ts
const map = new Emap({
  container: "map",
  useWorker: "auto",
  workerThreshold: 50_000,
})
```

With `useWorker: "auto"`, dataset-replace operations route to a worker when a dataset's arc vertex count reaches `workerThreshold`; smaller datasets stay on the main thread to avoid transfer overhead. `useWorker: true` routes every such operation to a worker. Worker routing handles data operations; Canvas rendering remains on the main thread.

## Simplification and viewport culling

Run `map.ops.simplifyLayer()` on line and polygon data to reduce the vertices processed by later rendering and operations. Choose the least detail that preserves readability, and simplify after import or as a separate user action.

Emap builds spatial indexes for large layers and, in local views, visits only viewport candidate features. Set `layout.visibility: "none"` to skip layers that do not need rendering. Features visible at full extent still need drawing; an index cannot reduce their count.

## API

- `Emap`
- `MapOptions`
- `SimplifyOptions`

## Runnable examples

- [Web Worker](/mapseekai/emap/examples/web-worker/)
- [Simplify control](/mapseekai/emap/examples/simplify-control/)
- [Geometry simplification](/mapseekai/emap/examples/simplify/)
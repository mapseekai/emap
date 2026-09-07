---
id: performance
slug: /recipes/performance
title: Performance
api: ["Emap"]
examples: ["simplify","simplify-control","web-worker"]
stability: stable
verifiedVersion: 0.9.0
---

# Performance

Keep render work small: use layer visibility, simplification, worker routing, and stable paint objects instead of reloading data on every interaction.

## Behavior notes

Large topology operations should use `useWorker: "auto"` and an appropriate `workerThreshold`; small pointer edits should stay on the main thread.

Large layers prebuild spatial indexes when data loads or is replaced, sharing them with feature queries. At local views, point, line, and fill rendering visits spatial candidates. Views covering much of the data extent retain direct scans to avoid querying and sorting large candidate sets. Classified lines also cache each style bucket's ordered arc list.

When a full draw exceeds about 33 ms, pan and zoom reuse the existing canvas and redraw at full quality after interaction ends. Initial indexing takes additional time and memory, and geometry edits invalidate the index. Indexing cannot reduce the number of features visible at full extent. Worker routing applies to data operations; it does not automatically move Canvas drawing off the main thread.

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

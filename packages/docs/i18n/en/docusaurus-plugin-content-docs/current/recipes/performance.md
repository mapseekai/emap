---
id: performance
slug: /recipes/performance
title: Performance
api: ["Emap", "MapOptions", "SimplifyOptions"]
examples: ["simplify", "simplify-control", "web-worker", "point-lod"]
stability: stable
verifiedVersion: unreleased
---

# Performance

Focus performance work in three places: route large data operations to a worker, simplify geometry that does not need full detail, and avoid rendering features outside the viewport.

## Enable workers for large data operations

```ts
const map = await Emap.create({
  container: "map",
  useWorker: "auto",
  workerThreshold: 50_000,
})
```

With `useWorker: "auto"`, dataset-replace operations route to a worker when a dataset's arc vertex count reaches `workerThreshold`; smaller datasets stay on the main thread to avoid transfer overhead. `useWorker: true` routes every such operation to a worker. Worker routing handles data operations; Canvas rendering remains on the main thread.

## Simplification and viewport culling

Run `map.ops.simplifyLayer()` on line and polygon data to reduce the vertices processed by later rendering and operations. Choose the least detail that preserves readability, and simplify after import or as a separate user action.

Emap builds spatial indexes for large layers and, in local views, visits only viewport candidate features. Set `layout.visibility: "none"` to skip layers that do not need rendering. At full extent, a spatial index alone cannot reduce the count; dense points can also use automatic LOD below.

## Automatic LOD for dense points

Large `circle` layers thin dense points automatically. Each grid cell retains the real point with the lowest original feature/component ID; coordinates and attributes stay intact. Both Point and MultiPoint are supported. Display filters run before representative selection, and styles still resolve from original feature attributes.

```ts
map.addLayer({
  id: 'points', type: 'circle', source: 'points',
  pointLod: { cellSize: 8 }, // Optional; 1–64 CSS pixels
  paint: { 'circle-radius': 3 },
});
// Set pointLod: false in addLayer to disable thinning.
```

The grid is anchored at the data origin and uses binary nested scales. Panning and DPR do not change cell membership. At ordinary scales, cell width is between half and all of the requested CSS size. Zooming restores detail progressively. Adjacent cells can still overlap: this is density thinning, not strict collision avoidance or cluster bubbles.

Fewer than 10,000 valid filtered points, or less than 10% reduction, keeps the original drawing path. Each render layer caches at most three scales. Warm pans query a Flatbush index of representatives without rescanning original points. Identical queries reuse their result; full-extent queries reuse sorted ID arrays. Geometry/attribute versions, dataset/layer/shapes identity, feature count, filter mask, CRS, cell configuration or viewport budget changes invalidate the cache.

The build budget follows the full CSS viewport's grid capacity, independently of tiny pointer query bounds, and is capped at a representative allowance of 64 MiB / 80 bytes. This is a memory planning allowance, not a JavaScript heap guarantee. If it is exceeded, rendering retains a coarser thinned level; if a single-point layer has sufficiently few indexed original candidates in the full viewport, it uses the original candidate path. Normal dense 1080p/4K views therefore do not suddenly draw all points after crossing a fixed 100k cutoff. Very large data extents or tiny cell sizes can retain coarser detail. Cold construction runs on the main thread and may try multiple coarser scales when over budget.

Click/hover picking follows painted representatives plus selected/highlighted overlays. During fast CSS navigation, picking retains the representatives actually painted in the previous frame until redraw. Box/lasso selection, attribute tables, statistics, analysis, exports and source-only `.msx` snapshots retain original data and existing display-filter semantics. Hidden MultiPoint components are not clickable merely because another component of the same feature is visible. Layer configuration snapshots defensively clone `pointLod`; `.msx` does not save render configuration.

Run the reproducible algorithm benchmark:

```bash
node --expose-gc --max-old-space-size=8192 scripts/benchmark-point-lod.mjs
```

A fixed seed generates 100k, 1M and 5M points with uniform and clustered distributions. The report separates the median of three cold builds (including their first query), median/P95 of 50 warm pan queries, and input/output counts. Data generation is excluded. Node algorithm timings are not browser FPS; Canvas drawing, import, style resolution and the original spatial index are outside this measurement.

## API

- `Emap`
- `MapOptions`
- `SimplifyOptions`

## Runnable examples

- [Web Worker](/mapseekai/emap/examples/web-worker/)
- [Simplify control](/mapseekai/emap/examples/simplify-control/)
- [Geometry simplification](/mapseekai/emap/examples/simplify/)
- [密集点 LOD / Dense point LOD](/mapseekai/emap/examples/point-lod/)

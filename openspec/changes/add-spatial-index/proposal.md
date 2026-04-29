# Change: Per-layer Flatbush spatial index for feature queries

## Why
`Emap.queryRenderedFeatures` and the click-hit / box-select / lasso paths it powers all funnel through `FeatureQuery._queryFeaturesInBBox` / `_pathTest` / `_pointTest`. Each one currently iterates **every shape in every layer of every source**, computing per-shape bbox on the fly to decide whether to keep it. That's `O(N)` per query.

For 100k-feature datasets:
- Single click hit-test: ~200-500 ms freeze on every click
- Lasso drag: each frame queries → scrolling lasso paints jankily
- BoxSelect drag finalizer: visibly hangs on release
- Programmatic batch queries: linear in dataset size × call count

flatbush is already a dependency (it ships in the bundle as a polyfill module for mapshaper's own internals). emap has been using it nowhere directly. Building one Flatbush index per (source, layer) brings the typical query down to `O(log N + K)` where `K` is the number of bbox-overlap candidates.

## What Changes

### `FeatureQuery` — internal index cache
- Add `_indexCache: Map<string, Flatbush>` keyed by `${sourceId}|${layerIndex}|${shapes.length}|${arcs.size()}`. The cache key changes whenever a dataset-replace op runs (which always changes shape count and / or arc count), so invalidation is automatic for the most common edit path.
- Add `_getOrBuildIndex(sourceId, layerIndex, layer, arcs): Flatbush | null`:
  - Allocate a `Flatbush(layer.shapes.length)`.
  - Per shape: compute bbox (point: bounding box of its coords; path: union of `arcs.getSimpleShapeBbox` per part). Null shapes get a degenerate `[0,0,0,0]` bbox so search ids remain dense.
  - Returns `null` for empty / shape-less layers (caller falls back to no-index iteration).
- Use the index as a **prefilter** in `_queryFeaturesInBBox` — `index.search(xmin, ymin, xmax, ymax)` returns candidate ids; the existing per-shape test (more precise for multi-point / multi-part paths) runs only on candidates. Same wiring in `_pathTest` (used by the point-click query for path features) and `_pointTest` (point click for point features).

### `Emap` — public methods
- `Emap.prebuildSpatialIndex(sourceId?: string): void` — eagerly build indexes for every layer of one source (or all sources). Useful for callers who want to pay the build cost in idle time before user interaction. No-op for sources with no dataset / no shapes.
- `Emap.clearSpatialIndex(sourceId?: string): void` — drop cached entries. Necessary after in-place geometry edits (`translateSelected`, `rotateSelected`, vertex commands) that don't change shape / arc counts so the auto-invalidation key would miss. Without it, queries return slightly stale results until the next dataset-replace op.

## Impact
- Affected specs: `spatial-index` (new shared capability tracking the per-layer index contract).
- Affected code:
  - `src/map/feature-query.ts` — internal cache + builder + three query call sites updated.
  - `src/map/map.ts` — two new public methods + `import Flatbush from 'flatbush'` (just types — already in the bundle).
  - `src/map/feature-query.test.ts` (new file) — index correctness + cache invalidation tests.
  - `src/map/map.test.ts` — `prebuildSpatialIndex` / `clearSpatialIndex` integration tests.
- No new dependencies. flatbush has been in `package.json` since the original mapshaper-bundle setup.

## Notes
- **Cache invalidation by shape / arc count**: catches every dataset-replace op (clip, dissolve, mosaic, union, etc.) automatically because they all change shape and / or arc counts. **Misses in-place edits** that mutate arc coordinates without changing counts (`translateSelected`, vertex moves). For those, callers must call `clearSpatialIndex(sourceId)` explicitly. Documented in the spec.
- **First-query cost**: building the index is `O(N)` over shapes + per-shape bbox computation — exactly the same work the no-index loop did. So the first query after data load takes the SAME time it does today; subsequent queries are `O(log N + K)`. To make the first query fast too, callers can call `prebuildSpatialIndex(sourceId)` from a `requestIdleCallback` after the source's `data` event.
- **Memory**: ~16 bytes per shape × layer count. For 100k shapes that's ~1.6 MB. Acceptable.
- **Why not auto-prebuild on data event**: would require FeatureQuery to listen to source events (currently a pull-model query helper, no event subscription). Reasonable v2 if profiling shows the first-query lag is still a real problem.
- **Why not invalidate via `geometrychange` events**: would require adding a new event type and threading version bumps through every selection-level command. Simpler to expose `clearSpatialIndex` and document.
- **Path-precision caveat**: the index uses union-of-arc-bbox per shape, which is the same precision as today's inner test. So results are bit-for-bit identical for path features. For multi-point shapes, the index emits the same prefilter conservatism (shape bbox might overlap query bbox even if no individual point does) and the existing post-filter still excludes those — net same behaviour, faster.

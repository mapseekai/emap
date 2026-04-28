## 1. FeatureQuery
- [x] 1.1 Add `_indexCache: Map<string, Flatbush>` private field. Key: `${sourceId}|${layerIndex}|${shapes.length}|${arcs?.size?.() ?? 0}`.
- [x] 1.2 Add `_getOrBuildIndex(sourceId, layerIndex, layer, arcs): Flatbush | null`. Returns null for shape-less layers; otherwise allocates `Flatbush(shapes.length)`, fills per-shape bboxes (point: coord union; path: arc-part bbox union), `finish()`es, caches, returns.
- [x] 1.3 Use index as a prefilter in `_queryFeaturesInBBox`. Iterate only `index.search(xmin, ymin, xmax, ymax)` candidate ids; existing per-shape test still runs (multi-part path / multi-point precision).
- [x] 1.4 Use index as a prefilter in `_pathTest`. Convert click + threshold to a query bbox, narrow to candidates, run existing per-part loop on those.
- [x] 1.5 Use index as a prefilter in `_pointTest`. Same shape — query bbox = `[x ± POINT_HIT_THRESHOLD/toPx, y ± POINT_HIT_THRESHOLD/toPx]`.
- [x] 1.6 Add public `prebuild(sourceId, source): void` — iterates source's layers and calls `_getOrBuildIndex` for each. Used by `Emap.prebuildSpatialIndex`.
- [x] 1.7 Add public `clear(sourceId?): void` — drops cache entries whose key starts with `${sourceId}|` (or all entries when sourceId is omitted).

## 2. Emap
- [x] 2.1 Add `Emap.prebuildSpatialIndex(sourceId?: string): void`. When `sourceId` provided, prebuild that source only; otherwise prebuild every source.
- [x] 2.2 Add `Emap.clearSpatialIndex(sourceId?: string): void`. Delegates to `FeatureQuery.clear`.

## 3. Tests
- [x] 3.1 New `src/map/feature-query.test.ts`:
  - Build a fixture with three known shapes; assert `_getOrBuildIndex` returns Flatbush whose `search` returns expected ids for various bboxes.
  - Cache hit: same `(sourceId, layerIndex, counts)` returns the same instance on second call.
  - Cache miss: different shape count → new instance.
- [x] 3.2 In `src/map/map.test.ts`:
  - `prebuildSpatialIndex(sourceId)` populates the cache for that source's layers.
  - `prebuildSpatialIndex()` (no arg) populates for every source.
  - `clearSpatialIndex(sourceId)` drops only that source's entries.
  - Regression: `queryRenderedFeatures(bbox)` returns the same results before and after enabling the index (parity test).

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.

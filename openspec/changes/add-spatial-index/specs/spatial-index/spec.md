## ADDED Requirements

### Requirement: Per-layer Flatbush spatial index in FeatureQuery
`FeatureQuery` SHALL maintain a per-(source, layer) Flatbush spatial index over per-shape bboxes, used as a prefilter in `queryRenderedFeatures` (bbox form), `_pathTest`, and `_pointTest`. The existing per-shape precision tests still run on the candidate ids returned by the index.

#### Scenario: Bbox query returns the same set with or without the index
- **WHEN** the same query bbox is run against the same dataset
- **THEN** the result set is identical (same `(source, layer, id)` triples, same order modulo iteration order) regardless of whether the index existed in cache before the call

#### Scenario: Cache key changes when shape count changes
- **WHEN** a dataset-replace op (e.g. `clipLayer`) changes a layer's `shapes.length`
- **THEN** the next query rebuilds the index from the new dataset (cache key differs)

#### Scenario: Cache key changes when arc count changes
- **WHEN** a dataset-replace op changes the source's arc collection size (e.g. `unionLayers` adds intersection cuts)
- **THEN** the next query rebuilds the index

#### Scenario: In-place geometry edits do NOT auto-invalidate
- **WHEN** `translateSelected` / vertex commands mutate arc coordinates without changing shape or arc counts
- **THEN** the cache is NOT auto-invalidated
- **AND** queries return prefilter-stale results (some shapes may no longer overlap the query bbox; some shapes that should be candidates may be missed)
- **AND** callers should call `clearSpatialIndex(sourceId)` to refresh

#### Scenario: Empty / shape-less layers return no index
- **WHEN** a layer has zero shapes (or `shapes` is undefined)
- **THEN** `_getOrBuildIndex` returns `null`
- **AND** the query falls back to the no-index loop (which has nothing to iterate anyway)

### Requirement: Emap.prebuildSpatialIndex
`Emap` SHALL provide `prebuildSpatialIndex(sourceId?: string): void` that eagerly builds spatial indexes for one source (when `sourceId` is provided) or every registered source (when omitted).

#### Scenario: Per-source prebuild populates the cache
- **WHEN** `prebuildSpatialIndex('s1')` is called
- **THEN** the index cache contains entries for every layer of source `s1` that has shapes

#### Scenario: All-sources prebuild iterates every source
- **WHEN** `prebuildSpatialIndex()` is called with no argument
- **THEN** indexes for every registered topology source's layers are built

#### Scenario: Unknown sourceId is a safe no-op
- **WHEN** `prebuildSpatialIndex('does-not-exist')` is called
- **THEN** no error is raised
- **AND** no cache entries are added

### Requirement: Emap.clearSpatialIndex
`Emap` SHALL provide `clearSpatialIndex(sourceId?: string): void` that drops cached spatial indexes for one source (when provided) or all sources (when omitted).

#### Scenario: Per-source clear drops only that source's entries
- **WHEN** `clearSpatialIndex('s1')` is called
- **THEN** entries whose cache key starts with `s1|` are removed
- **AND** entries for other sources remain in the cache

#### Scenario: All-sources clear drops every entry
- **WHEN** `clearSpatialIndex()` is called with no argument
- **THEN** the cache is empty

#### Scenario: After in-place geometry edit + clear, queries reflect new positions
- **WHEN** `translateSelected(dx, dy)` runs
- **AND** the caller calls `clearSpatialIndex(sourceId)`
- **THEN** subsequent `queryRenderedFeatures(bbox)` returns refreshed results based on the new arc positions

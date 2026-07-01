# GeoArrow Dual-Representation Dataset Design

## Goal

Give emap a dataset model that supports both topology-aware node editing and
efficient large-data WebGL rendering of GeoArrow sources, on the
`feat/webgl-painter-luma` branch, using luma.gl v10's new `@luma.gl/arrow`
module.

Target scale: ~1M vertices (100k–1M features) loaded from GeoParquet /
GeoArrow / DuckDB, smooth pan/zoom immediately after load, mapshaper-grade
topology editing (shared boundaries move together) without a conversion pause
at first edit.

## Decisions (settled during brainstorming)

- **Both representations are prepared at load time.** Import already builds
  mapshaper topology eagerly (`fromArrowTable` → `buildTopology`); the change
  is to *retain* the source Arrow table instead of discarding it.
- **Topology (`MapshaperDataset` / `ArcCollection`) is the single source of
  truth.** Everything Arrow-shaped is a derived cache stamped with a revision
  number. No dual-write: edits never mutate Arrow buffers directly.
- **Bring master to the branch with a full `git merge master`** (master is 131
  commits ahead; branch touches mostly `src/renderer/webgl/`, `map.ts`,
  `vertex-edit.ts` — small overlap).
- **Upgrade luma.gl 9.3.3 → v10 (alpha/beta)** and use `@luma.gl/arrow`
  (Arrow shader layouts, `ArrowPathModel` / `ArrowStoragePathModel`, GeoArrow
  closed-path normalization). Pin an exact alpha version; the branch is
  explicitly experimental.
- Approaches rejected: dual-authoritative with dual writes (every edit command
  would need O(n) Arrow list-offset rewrites and a second write path);
  GeoArrow-authoritative with a topology overlay (rewrites the entire
  mapshaper editing kernel).

## Architecture

```text
                    ┌──────────────────────────────────────────┐
                    │ GeoDataset (owned by TopologySource)      │
                    │                                           │
   edit commands ──▶│  topology: MapshaperDataset  ← authority  │
 (ops/editSession)  │  revision: number            ← +1 per edit│
                    │                                           │
                    │  arrowCache: { table, revision } ← derived│
                    └──────────────┬────────────────────────────┘
                                   │ derived per-chunk
                                   ▼
                    WebGL retained chunk pipeline (existing on branch)
                    chunk output = GeoArrow-layout binary columns
                    (flat coords + startIndices) → @luma.gl/arrow models
```

Two derived layers with different jobs:

| Derived data | Shape | Used by | Update strategy |
|---|---|---|---|
| `arrowCache` | Whole GeoArrow `Table` (native encoding) | DuckDB ops, geoarrow/geoparquet export, load-time direct render | Lazy whole-table rebuild: `getArrowTable()` rebuilds via existing `toArrowTable` when `revision` mismatches, then re-caches |
| Render chunks | Spatially-chunked binary columns | Every frame (pan/zoom/edit) | Incremental: edits invalidate only affected chunks (per the retained-binary-chunk-pipeline design) |

### API additions (TopologySource)

```ts
interface TopologySource {
  // ...existing surface unchanged
  /** Monotonic committed-edit counter (named to distinguish it from the
   *  existing render-only getRenderRevision()). */
  getDataRevision(): number;
  /** Record an in-place data edit; expires derived caches lazily. */
  markDataEdited(): void;
  /**
   * GeoArrow table for one layer. Cached per (layer, encoding) — DuckDB
   * consumes 'wkb', rendering/export consume 'native'. Returns the cached
   * table when its revision matches; otherwise rebuilds through
   * toArrowTable and re-caches. Rebuilds reset the render-LOD retained
   * interval (same discipline as export()) so derived tables always carry
   * full-detail coordinates.
   */
  getArrowTable(opts?: { layer?: number | string; encoding?: 'native' | 'wkb' }): unknown;
  /** Install an externally produced table (import path, DuckDB results)
   *  as the cache entry for the current data revision. */
  seedArrowTable(table: unknown, opts: { encoding: 'native' | 'wkb'; layer?: number | string }): void;
}
```

The table crosses the core API as `unknown`: the core bundle must not
depend on apache-arrow, so the formats bundle registers the converter into
the existing format-registry global slot and typed access lives in
formats/duckdb code.

The revision bump lands at two choke points that together cover every edit
path without per-command wiring: `TopologySource.setDataset` (dataset-replace
ops — everything `_runner.ts` / `COMMAND_EFFECTS` drives lands here via
`DatasetReplaceCommand`, plus DuckDB results and reproject) and the Map
history entry points `pushCommand` / `undo` / `redo` (in-place edits:
vertex move/insert/delete, editSession translate / rotate / scale).
Double-bumps are harmless — over-invalidation only costs a lazy rebuild. `attribute-only` effects also bump (the Arrow table
carries attribute columns); `crs-only` / reproject invalidates everything
including render chunks.

## Data Flows

### Load (GeoParquet / GeoArrow / DuckDB query result)

```text
bytes → Arrow Table (tableFromIPC / duckdb-wasm)
  ├─▶ [immediately] whole-table direct render via ArrowPathModel /
  │    ArrowStoragePathModel — zero-copy first paint (the "bridge")
  ├─▶ fromArrowTable() → topology dataset (existing, includes buildTopology)
  └─▶ store as arrowCache at revision 0
chunk pipeline builds in the worker → ready chunks replace the bridge render
```

The bridge render exists because chunk building for ~1M vertices takes
seconds; during that window the user sees the complete dataset, not chunks
popping in. Once the visible chunks are ready the painter switches to the
retained chunk path (which supports local invalidation); the bridge model is
released.

Non-Arrow imports (GeoJSON, Shapefile, …) skip the bridge and the revision-0
cache; their first `getArrowTable()` call builds the table.

### Edit

```text
edit command (vertex-edit / editSession / ops.*)
  → COMMAND_EFFECTS classification → revision++ (in _runner)
  → fire 'geometrychange' { arcIds?, featureIds? }
  → chunk pipeline invalidates locally (falls back to layer-wide when ids
    are unavailable — per the existing chunk pipeline design)
  → arrowCache expires implicitly (revision mismatch); rebuilt lazily on
    the next getArrowTable() call
```

Drag sessions stay cheap: per-frame moves only mark dirty (existing
`markDisplayArcsDirty` pattern); chunk rebuild and the revision bump land on
commit/release, not per frame. What the user sees per frame during the drag
is defined by the edit-session hot path below.

### Edit-session rendering (real-time display consistency)

Retained chunks rebuild asynchronously, so a drag frame can never wait for
them. During an edit session the affected geometry drops back to an
immediate-mode hot path while everything else stays retained:

```text
┌─ unaffected geometry (~99.9%) ─▶ retained chunks keep drawing, untouched
├─ affected arcs/features ───────▶ hot path: rebuilt each frame from the
│   (arcIds known at drag start;    live ArcCollection into a small dynamic
│    shared arcs included, so       buffer (hundreds–thousands of vertices,
│    both neighbours update)        <1ms) via buffer writes — cursor-accurate
└─ consistency mask ─────────────▶ affected features are hidden inside the
     retained chunks: chunk vertices carry a featureId attribute; the
     shader discards ids listed in a small hidden-id uniform array
     (edit sessions touch 1–few features, so a uniform list suffices)
```

Without the mask the retained chunk draws the old position while the hot
path draws the new one — ghosting. The mask guarantees each feature is drawn
by exactly one source at any moment.

On release/commit:

1. `revision++` → affected chunks rebuild asynchronously in the worker.
2. The hot-path overlay keeps drawing until the replacement chunks are
   ready, then unloads and the mask clears.
3. Every frame shows a complete picture — overlay or new chunk, never a
   hole, never a double image.

`arrowCache` consistency: the revision bumps on commit only, never per drag
frame, so the Arrow table always means "state as of the last committed
edit". A DuckDB op or export triggered mid-drag sees the last committed
state — consistent and explainable. The Canvas painter reads live arcs every
frame and needs none of this.

### DuckDB ops

```text
Emap.ops.duckdb* (buffer / overlay / query / …)
  → source.getArrowTable()      ← unedited data: cache hit, zero conversion
  → insertArrowTable / registerFileBuffer (existing runtime)
  → result Table → fromArrowTable → setDataset (new topology)
  → result Table becomes the new revision's arrowCache (no round-trip waste)
```

### Export

`export({format: 'geoarrow' | 'geoparquet'})` goes through `getArrowTable()`:
unedited data exports the originally loaded table (byte-faithful); edited
data rebuilds first. Other formats unchanged.

## Rendering Integration (luma.gl v10)

- Upgrade `@luma.gl/core` / `engine` / `webgl` to v10; add `@luma.gl/arrow`.
- Chunk outputs standardize on GeoArrow physical layout — flat coordinate
  arrays plus `startIndices` offset arrays — attached via v10 Arrow shader
  layouts, so the chunk path and the bridge path share one shader/layout
  convention.
- Polygon fill keeps the branch's evenodd **stencil** approach: it consumes
  rings directly (no tessellation), which fits GeoArrow ring data natively.
  The existing earcut path stays for cases that need real triangles.
- The Canvas painter path is untouched; `painter-factory` keeps choosing.

## Error Handling

- **v10 alpha instability**: if v10 `Device` creation or `@luma.gl/arrow`
  init throws, `painter-factory` falls back to the Canvas painter — no blank
  page. Pin the exact alpha version to absorb API churn deliberately.
- **Bridge render failure** (unsupported geoarrow encoding, buffer limits):
  skip the bridge and wait for chunks — degrades to progressive fill, never
  an error surface.
- **`getArrowTable()` rebuild failure**: throw a clear error to the caller
  (DuckDB ops wrap it in `DuckDbOperationError`); the stale cache entry is
  dropped, never served; authoritative topology is unaffected by derived-layer
  failures.
- **Worker failure**: existing degradation (disable async geometry, keep the
  synchronous small-data path) applies unchanged.

## Testing

Unit:

- revision increments for every `COMMAND_EFFECTS` category; reproject
  invalidates render chunks too.
- `getArrowTable()`: cache hit at matching revision; rebuild on mismatch;
  round-trip correctness (move a vertex → exported table has the new
  coordinate); DuckDB result table re-seeds the cache.

Renderer:

- vertex edit invalidates only affected chunks (existing cache test
  infrastructure).
- bridge → chunk switchover keeps a model alive at all times (no flash).
- edit session: hot-path buffer reflects live arc coordinates each frame;
  masked features are absent from retained chunk draws; mask clears only
  after replacement chunks are ready (no ghosting, no holes).

Integration:

- GeoParquet load → vertex edit → DuckDB buffer → geoparquet export, full
  chain.

Manual acceptance:

- new `test/examples/geoarrow-editing.html`: ~1M-vertex dataset pans/zooms
  smoothly right after load; node editing is responsive; DuckDB ops work on
  both fresh and edited data.

## Implementation Phases

Each phase leaves the branch healthy and shippable.

```text
0. git merge master → resolve conflicts (map.ts / vertex-edit.ts /
   package.json expected) → full test suite green
1. luma 9.3.3 → v10 alpha upgrade; existing WebGL tests green (no features)
2. GeoDataset: revision + arrowCache in TopologySource; revision++ in _runner
3. DuckDB ops + geoarrow/geoparquet export routed through getArrowTable()
4. v10 whole-table bridge render (@luma.gl/arrow path models)
5. chunk outputs unified on GeoArrow layout + edit local invalidation wired
   (completes Phase 4 of the retained-binary-chunk-pipeline design)
6. edit-session hot path + featureId consistency mask (real-time drag
   feedback over retained chunks)
```

Phases 0–1 are pure infrastructure; 2–3 deliver the dual-representation
dataset value; 4–6 deliver the rendering upgrades.

## Risks

- **v10 is pre-release** (official target Q3 2026). Mitigation: exact version
  pin, painter-factory fallback, and phase 1 is isolated so a breaking alpha
  bump is a one-phase revert.
- **Memory: three resident copies near the viewport** (topology Float64,
  arrow cache, chunk buffers) at 1M vertices ≈ tens of MB each — acceptable
  for the target scale; the chunk pipeline's LRU (existing design) bounds the
  GPU side. If the arrow cache ever matters, dropping it is safe (rebuildable).
- **Attribute edits currently lack per-command granularity** for cache
  reuse — any edit expires the whole arrow table. Accepted: rebuild is
  seconds-scale and off the render path.

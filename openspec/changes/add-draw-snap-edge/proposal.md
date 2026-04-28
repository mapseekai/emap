# Change: `DrawFeatureControl` snap enhancement — edge snap + multi-source + visual kind

## Why
The current `DrawFeatureControl` snaps the cursor to existing **vertices** of the source it's drawing into, plus vertices the user has just placed. Two real gaps:

1. **No edge snap.** A user drawing a road that meets an existing road at the middle of a segment can't snap there — only at the segment's endpoints. Every CAD / GIS tool offers "snap to nearest point on edge".

2. **Single-source only.** A user drawing in source A whose data lives in source B (e.g. tracing along a basemap reference layer that's stored separately) gets no snap help — `_findSnapTarget` only inspects `this._options.source`.

3. **No visual distinction between vertex and edge snap.** The renderer draws a single red ring regardless. Users who care about topological-end-of-segment vs middle-of-segment can't tell which one will be committed.

## What Changes

### Algorithm
- Extend `_findSnapTarget` to test:
  - Vertex distance for every vertex of every snap source's arcs (existing).
  - **Perpendicular projection onto every arc segment** of every snap source. For each segment, compute the closest point in pixel space, accept if perpendicular pixel distance is below threshold AND the projection's parameter `t` falls in `[0, 1]` (i.e. on the segment, not its extension).
  - Both candidates compete on raw pixel distance — whichever is closer wins. Ties go to vertex (matches user intent: hitting a corner should snap there, not slide along the adjacent edge).
- The closest pixel point on the chosen edge is converted back to map coordinates via `map.unproject(px, py)`.
- In-progress drawing vertex snap is unchanged (always vertex, never edge).

### Options
Three new `DrawFeatureControlOptions` fields:
- `snapSources?: string[]` — list of source IDs to snap against. Defaults to `[opts.source]` (the source being drawn into).
- `snapToVertex?: boolean` — default `true`. Disables vertex snap entirely when `false`.
- `snapToEdge?: boolean` — default `true`. Disables edge snap entirely when `false`.

### State + Rendering
- Extend `EditDrawState` with `snapKind: 'vertex' | 'edge' | null` so renderers can differentiate the indicator. Type exported alongside `EditDrawState`.
- Update `CanvasPainter.drawEditDraw`: vertex snap → red **circle ring** (existing); edge snap → red **square ring** (rotated 45°, same radius). Self-vertex snap (in-progress drawing) renders as circle (treated as vertex).

## Impact
- Affected specs: `draw-feature` (modified — three new requirements covering edge snap, multi-source, snap kind).
- Affected code:
  - `src/ui/draw-feature-control.ts` — `_findSnapTarget` rewrite, options additions, state field.
  - `src/renderer/canvas-painter.ts` — different glyph for `snapKind === 'edge'`.
  - `src/map/map.ts` — extend `EditDrawState` interface with `snapKind`.
  - `src/ui/draw-feature-control.test.ts` — new tests.
  - `test/examples/draw-features.html` (or similar) — demo edge snap.

## Notes
- **Performance**: edge snap iterates every segment (`forEachSegment`). For a 100k-vertex source that's 100k segments × 2 projections + segment-projection math per mousemove. ~500k ops, sub-frame on modern CPUs. If profiling shows it dominating on huge datasets, a flatbush spatial index (already a dep) can be added in a v2 with a per-source lazy-built cache.
- **Why not snap to ALL sources by default**: surprising. Users explicitly opt in via `snapSources`. Default of `[opts.source]` matches existing behaviour exactly.
- **Why not centroid / centre snap**: niche; can be added as kinds later. Vertex + edge cover ~95 % of GIS / CAD drawing workflows.
- **Visual glyph choice**: square is the convention in QGIS / ArcMap for "snap to segment". Sticking with it for muscle-memory reasons.
- **Edge-vs-vertex tie**: when the cursor is exactly at a vertex, both vertex distance AND edge distance are zero. The strict `<` comparison preserves whichever was set first. Vertex loop runs before edge loop within a source, so vertex wins. Cross-source order is `snapSources` order; the first source's vertices beat any other source's edges at equal distance.

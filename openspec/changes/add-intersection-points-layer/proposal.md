# Change: Add `intersectionPointsLayer` — materialize self-intersection points as a point layer

## Why
mapshaper's `-points intersections` flag is registered in the parser but its implementation is a debug-only timing benchmark (`testIntersections(arcs)`) that just `console.log`s the count and emits the source layer unchanged — no actual point output. The audit confirmed this is WIP upstream; we shouldn't extend our `pointsLayer` enum to include a broken option.

What users actually want is **a point layer they can render / select / edit, with one feature per detected self-intersection in a polygon or polyline target**. The underlying primitives mapshaper exposes — `findSegmentIntersections` (already used by `checkGeometry`) and `getIntersectionLayer` — produce exactly that. No CLI command wraps them; we can.

This is the materialize-as-layer counterpart to the read-only `checkGeometry` report.

## What Changes

### `Emap.intersectionPointsLayer({ source, target, name?, tolerance? }): Promise<boolean>`
- Walks the source's `arcs` via `mapshaper.internal.findSegmentIntersections(arcs, { tolerance })`.
- Builds a new point layer via `mapshaper.internal.getIntersectionLayer(intersections, lyr, arcs)` — one multi-point feature whose `shapes[0]` is the array of `[x, y]` for every intersection point limited to arcs reachable from the target layer.
- Names the new layer `name` (defaults to `${target}-intersections`).
- Adds the new layer to the source's dataset (does NOT replace the target).
- Routes through the existing `_runDatasetCommand` pattern so the operation is undoable.

### Validation
- `source` must resolve.
- `target` must resolve and be polygon or polyline (point layers have no segments to intersect).
- `name` (if supplied) must not collide with any existing layer.
- `tolerance` (if supplied) must be a positive finite number.

## Impact
- Affected specs: `intersection-points` (new capability — sibling to `check-geometry` for the materialize-as-layer use case).
- Affected code:
  - `src/map/map.ts` — new `IntersectionPointsLayerOptions` interface + `Emap.intersectionPointsLayer` method.
  - `src/map/map.test.ts` — new tests covering the four validation paths and a real-mapshaper round-trip on a self-intersecting fixture.
  - `src/index.ts` — re-export option type.
- `src/types/mapshaper.d.ts` — add `internal.getIntersectionLayer` declaration.

## Notes
- **Why not extend `pointsLayer({ type: 'intersections' })`**: would add an API surface that mirrors a known-broken upstream flag. When/if mapshaper's `-points intersections` becomes real, we can collapse the wrappers; until then keeping them separate is honest.
- **Single multi-point feature vs. one feature per intersection**: `getIntersectionLayer` returns `{ shapes: [points] }` — one feature with all points. That's mapshaper's chosen shape; we forward unchanged. Users who want one-feature-per-point can pipe through `explodeLayer` afterwards.
- **Limited to target's arcs**: `getIntersectionLayer` filters intersections to those whose endpoints belong to arcs referenced by the target layer's shapes. Cross-layer intersections aren't reported here — `checkGeometry` already covers the global intersection scan.
- **Result is dataset-replace style**: adds a layer to the source's dataset and routes through `_runDatasetCommand`, so it's undoable and integrates with the existing history-barrier convention.

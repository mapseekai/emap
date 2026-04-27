# Change: Add `pointsLayer` — extract points from polygons / polylines

## Why
mapshaper's `-points` is the canonical "give me a point per feature" command. It powers labelling pipelines (centroid / inner-point), vertex-handle inspection (`vertices`), and line-sampling workflows (`midpoints`, `endpoints`, `interpolated`). It rounds out the geometry-conversion family alongside `-divide` (polylines), `-lines` (polygons → boundary lines), and `-polygons` (polylines → enclosed polygons).

## What Changes
- Add `Emap.pointsLayer({ source, target, type, interval?, name?, noReplace? }): Promise<boolean>` in `src/map/map.ts`.
- `type` is a single enum string (mapshaper exposes mutually-exclusive boolean flags in the CLI; collapsing to one option avoids invalid combos at the boundary):
  `'centroid' | 'inner' | 'vertices' | 'endpoints' | 'midpoints' | 'interpolated'`.
- Build mapshaper command `-target "<target>" -points <flag> [interval=N] [name="..."] [no-replace]` and delegate to `_runDatasetCommand`.
- Validate that the source / target resolve and the geometry type matches the mode:
  - `centroid`, `inner` → polygon
  - `vertices`, `endpoints` → polygon or polyline
  - `midpoints`, `interpolated` → polyline
  - `interpolated` additionally requires `interval > 0`.
- Add `PointsOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/points.html` with a target dropdown and a mode dropdown.

## Impact
- Affected specs: `points` (new capability)
- Affected code: `src/map/map.ts` (one new public method + options interface), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example HTML
- No new infrastructure.

## Notes
- v1 omits `intersections` (mapshaper marks it WIP and the describe is commented out) and `vertices2` (a debug flavor of `vertices`).
- v1 omits the tabular `x=` / `y=` mode (creates points from records of an existing table); that's a different workflow class.
- mapshaper accepts only one of the flags at a time — picking a single enum mirrors that contract while staying ergonomic.

## 1. Implementation
- [x] 1.1 Declare `PointsOptions { source, target, type, interval?, name?, noReplace? }` in `src/map/map.ts` with `type: 'centroid' | 'inner' | 'vertices' | 'endpoints' | 'midpoints' | 'interpolated'`.
- [x] 1.2 Add `Emap.pointsLayer(opts): Promise<boolean>`. Validates source/target exist, target geometry matches mode (polygon for centroid/inner, polyline for midpoints/interpolated, polygon-or-polyline for vertices/endpoints), `interpolated` requires positive `interval`. Builds `-target "T" -points <flag> [interval=N] [name="..."] [no-replace]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `PointsOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap pointsLayer` describe block in `src/map/map.test.ts` covering: each mode's command shape, interval, name, no-replace, missing source / unresolved target / wrong geometry → false, interpolated without interval → false, history label `Points <target>`.

## 3. Example
- [x] 3.1 Add `test/examples/points.html` with target dropdown (any) and mode dropdown.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.

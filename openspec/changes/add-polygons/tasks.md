## 1. Implementation
- [x] 1.1 Declare `PolygonsOptions { source, target, gapTolerance?, fromRings? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.polygonsLayer(opts): Promise<boolean>`. Validates source exists and target is a polyline layer. Builds `-target "T" -polygons [gap-tolerance=N] [from-rings]` and delegates to `_runDatasetCommand`. Forwards `gap-tolerance=` only when the caller supplies a positive number.
- [x] 1.3 Re-export `PolygonsOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap polygonsLayer` describe block in `src/map/map.test.ts` covering: minimal command shape, gap-tolerance forwarding (positive vs ignored zero/negative), from-rings, missing source / unresolved target / non-polyline target → false, history label `Polygons <target>`.

## 3. Example
- [x] 3.1 Add `test/examples/polygons.html` with target dropdown (polylines), gap tolerance input, from-rings checkbox.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.

# Change: Add `polygonsLayer` — convert polylines to polygons

## Why
mapshaper's `-polygons` is the inverse of `-lines` — given a polyline layer (e.g. raw road centerlines or imported boundary segments), it forms enclosed polygons. Two flavors: full polygonization that snaps gaps and reconstructs faces (default) and a fast `from-rings` path when the input is already known to be a layer of closed paths. Round-trip companion to `linesLayer` and the third member of the geometry-conversion batch alongside `pointsLayer` and `linesLayer`.

## What Changes
- Add `Emap.polygonsLayer({ source, target, gapTolerance?, fromRings? }): Promise<boolean>` in `src/map/map.ts`.
- Build the mapshaper command `-target "<target>" -polygons [gap-tolerance=N] [from-rings]` and delegate to `_runDatasetCommand`.
- Validate that `target` resolves to a polyline layer.
- Add `PolygonsOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/polygons.html`.

## Impact
- Affected specs: `polygons` (new capability)
- Affected code: `src/map/map.ts` (one new public method + options interface), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example HTML
- No new infrastructure.

## Notes
- mapshaper's `-polygons` doesn't support `name=` or `no-replace` — the operation is pure geometry-type conversion replacing the target in place. We don't expose them.
- `gap-tolerance` is in source-CRS units (degrees for EPSG:4326, metres for projected CRSes). Default mapshaper behaviour is to compute one automatically; we forward only when the caller supplies a positive value.

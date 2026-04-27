# Change: Add `innerlinesLayer` — extract shared edges as polylines

## Why
mapshaper's `-innerlines` converts a polygon layer into a polyline layer along the edges shared between adjacent polygons. The classic use case is cartographic: drawing internal administrative borders (state-state, county-county) as a separate styleable layer while keeping the original polygons intact. emap had no API for this — wrapping it through the existing runner takes ~15 lines.

## What Changes
- Add `Emap.innerlinesLayer({ source, target, where?, name?, noReplace? }): Promise<boolean>` that builds the mapshaper command `-target "<TARGET>" -innerlines [where=...] [name=...] [no-replace]` and delegates to `_runDatasetCommand`.
- Add `InnerlinesOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/innerlines.html`.

## Impact
- Affected specs: `innerlines` (new capability)
- Affected code: `src/map/map.ts` (one new public method), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example
- No new infrastructure.

## Notes
- `where` is mapshaper's polygon-boundary filter (`mapshaper-options.mjs` calls it `whereOpt2`), evaluated with **both `A` and `B`** in scope — the two polygons sharing the boundary. Lets you keep only inter-state boundaries and skip e.g. coastline edges (`A.STATE !== B.STATE`).
- `noReplace` mirrors mapshaper's `no-replace` flag — keeps the original polygon layer alongside the new polyline layer.
- `name` controls the output layer name (mapshaper auto-generates one otherwise).

# Change: Add `mosaicLayer` — flatten overlapping polygons into a mosaic

## Why
mapshaper's `-mosaic` rebuilds a polygon layer that contains overlaps into a flat tile mosaic — every overlap region becomes its own polygon, every gap is preserved, no shared interior. It is the "make this layer topologically sane" sibling of `-clean`, useful when polygons in one layer overlap (electoral districts, coverage zones, multi-source merges).

## What Changes
- Add `Emap.mosaicLayer({ source, target, snapInterval?, noSnap?, noReplace?, name? }): Promise<boolean>` that builds the mapshaper command `-target "<TARGET>" -mosaic [snap-interval=...] [no-snap] [no-replace] [name=...]` and delegates to `_runDatasetCommand`.
- Add `MosaicOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/mosaic.html`.

## Impact
- Affected specs: `mosaic` (new capability)
- Affected code: `src/map/map.ts` (one new public method), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example
- No new infrastructure.

## Notes
- v1 omits `calc=` (per-feature attribute aggregation expression). Can be added later when there is a real caller.
- Default behaviour replaces the target layer with the mosaic output. `noReplace: true` keeps the original alongside the new mosaic layer (mapshaper's `no-replace` flag).

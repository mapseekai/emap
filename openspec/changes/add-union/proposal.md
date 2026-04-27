# Change: Add `unionLayers` — flat mosaic from two or more polygon layers

## Why
mapshaper's `-union` overlays two or more polygon layers and rebuilds them as a single flat mosaic — every intersection region between the input layers becomes its own polygon, and attributes from both sides flow into each output feature. Standard "overlay analysis" workhorse alongside clip / erase / mosaic.

## What Changes
- Add `Emap.unionLayers({ source, targets, fields?, name?, noReplace? }): Promise<boolean>` that builds the mapshaper command `-target "L1,L2,..." -union [fields=...] [name=...] [no-replace]` and delegates to `_runDatasetCommand`.
- Validate that **at least two** target layers are supplied and that all of them resolve in the source (mapshaper raises an opaque error otherwise).
- Add `UnionOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/union.html` accepting multi-file uploads (reusing the multi-file `setData` extension) so users can supply two single-layer files.

## Impact
- Affected specs: `union` (new capability)
- Affected code: `src/map/map.ts` (one new public method), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example
- No new infrastructure. Reuses the multi-file `setData` path landed in `93b57e9`.

## Notes
- mapshaper's `-target` for `-union` is a **comma-separated list** of layer names, not the single quoted layer the other ops use. We join `targets` with commas and embed the whole thing as a single quoted argument.
- v1 omits mapshaper's commented-out `add-fid` flag (it's marked dev-only in `mapshaper-options.mjs`).

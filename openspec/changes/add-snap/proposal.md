# Change: Add `snapLayer` — explicit vertex snapping

## Why
mapshaper's `-snap` is the standard fix for "almost-but-not-quite-coincident" vertices that show up after reprojection, manual digitization, or merging multiple sources. emap's import path runs the cheap default snap inside `cleanPathsAfterImport`; this proposal exposes the user-driven, distance-tunable variant.

## What Changes
- Add `Emap.snapLayer({ source, target, interval?, endpoints?, precision? }): Promise<boolean>` that builds the mapshaper command `-target "<TARGET>" -snap [<INTERVAL>] [endpoints] [precision=<N>]` and delegates to `_runDatasetCommand`.
- Add `SnapOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/snap.html`.

## Impact
- Affected specs: `snap` (new capability)
- Affected code: `src/map/map.ts` (one new public method), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example
- No new infrastructure.

## Notes
- `interval` is mapshaper's positional default; `precision` rounds all coords to a given decimal precision (e.g. `0.000001`).
- `endpoints: true` snaps only line endpoints (mapshaper's flag of the same name).
- Numbers are emitted bare; mapshaper's `interval` accepts numeric values directly.

# Change: Add `explodeLayer` — divide multi-part features into single-part

## Why
Multi-part features (multipolygon islands, multiline rivers, multipoint clusters) are common in real data and a frequent annoyance for editors: you cannot pick or attribute one piece without affecting all parts. mapshaper's `-explode` is the standard fix, splitting one multi-part feature into N single-part features, each with a copy of the original attributes. Wrapping it costs almost nothing on top of the existing runner.

## What Changes
- Add `Emap.explodeLayer({ source, target }): Promise<boolean>` that builds the mapshaper command `-target "<TARGET>" -explode` and delegates to `_runDatasetCommand`.
- Add `ExplodeOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/explode.html`.

## Impact
- Affected specs: `explode` (new capability)
- Affected code: `src/map/map.ts` (one new public method), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example
- No new infrastructure. Inherits all dataset-replace semantics (history barrier, selection cleared) from the runner.

## Notes
- v1 does not expose mapshaper's undocumented `naive` flag — its description in `mapshaper-options.mjs` is "// testing", so it is not a stable API surface to bind to.
- Works on every geometry type mapshaper supports for `-explode` (multipolygon, multipolyline, multipoint).

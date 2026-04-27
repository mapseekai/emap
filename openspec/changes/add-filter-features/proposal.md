# Change: Add `filterFeatures` — drop features by JS expression

## Why
mapshaper's `-filter` is the workhorse "delete every feature that doesn't match this predicate" command. It rounds out the L2 attribute-driven operations alongside `applyExpression`: the latter mutates records, the former drops them.

## What Changes
- Add `Emap.filterFeatures({ source, target, expression?, invert?, removeEmpty? }): Promise<boolean>` that builds the mapshaper command `-target "<TARGET>" -filter [<expr>] [invert] [remove-empty]` and delegates to `_runDatasetCommand`.
- `expression` follows mapshaper's convention: features that evaluate to FALSE are deleted (so `'this.pop > 100'` keeps populous features). `invert: true` flips. `removeEmpty: true` also drops features with null geometry.
- Returns `false` when neither `expression` nor `removeEmpty` is supplied (mapshaper would error; we catch early).
- Add `FilterOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/filter-features.html`.

## Impact
- Affected specs: `filter-features` (new capability)
- Affected code: `src/map/map.ts` (one new public method), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example
- No new infrastructure.

## Notes
- v1 omits mapshaper's `bbox=`, `keep-shapes`, `ids=`, `cleanup`, `name=` options — niche and expandable later.
- Companion to `applyExpression`: same JS context (`this.id`, `this.area`, `this.bounds`, fields), opposite intent (mutate vs delete).

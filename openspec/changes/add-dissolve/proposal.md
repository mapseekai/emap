# Change: Add dissolve operation

## Why
Dissolve is the third whole-dataset polygon op (after clip / erase) and the simplest exercise of the `_runDatasetCommand` runner that `add-clip-erase` introduced. Together they cover ~80% of the polygon ops a typical editor needs. This proposal also locks in the field-quoting convention every later command-string-driven op will share.

## What Changes
- Add `Emap.dissolveLayer({ source, target, field? })` that delegates to the existing private `_runDatasetCommand`. With no `field`, mapshaper merges every feature in the target layer into one; with `field`, features sharing that field's value are merged.
- Quote the target layer name and the optional field name using the same `quoteMapshaperArg` helper added in `add-clip-erase`. No new helpers.
- Add `DissolveOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/dissolve.html` showing dissolve-all and dissolve-by-field.

## Impact
- Affected specs: `dissolve` (new capability)
- Affected code: `src/map/map.ts` (one new public method + helper plumbing), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export)
- No new dependencies, no new commands files. v1 reuses every primitive shipped by `add-clip-erase`.

## Notes
- v1 supports a **single** dissolve field (the most common case). Multi-field grouping (`fields=A,B`) and aggregation expressions (`sum-fields=`, `calc=`) are deferred to a follow-up — no current emap user is asking for them, and keeping the API surface minimal is cheap to widen later.
- "Merge selected features" is a different operation that needs selection-aware extract / dissolve / merge-back plumbing. Out of scope here; tracked as a future `add-merge-selected` proposal.
- mapshaper's `-dissolve2` is an alias for `-dissolve` since 0.6.x (`mapshaper-options.mjs:821`), so we always emit `-dissolve` and let mapshaper apply the modern topology-repair pipeline.

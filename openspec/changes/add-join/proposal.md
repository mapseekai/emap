# Change: Add `joinTable` — attribute join from CSV / JSON / another layer

## Why
Maps without joined-in attribute data are immediately limiting. Loading a thematic shapefile of states and a CSV of population-by-state, then joining on `STATE_FIPS` is the canonical "make a chloropleth" workflow. mapshaper's `-join` does this; emap so far only covers `setData` (load one file as one source).

## What Changes
- Add `Emap.joinTable(opts: JoinTableOptions): Promise<boolean>` in `src/map/map.ts`.
- The `data` parameter accepts three shapes:
  - `{ csv: string | Uint8Array }` — stashed in a synthetic input-files cache as `.emap-join.csv` and referenced by name in the `-join` arg.
  - `{ json: string | unknown[] | Uint8Array }` — same, as `.emap-join.json`. Plain arrays/objects are JSON-stringified up-front.
  - `{ layer: string }` — an existing layer in the same source; passed by name (no cache injection).
- Required `keys: [targetKey, sourceKey]` — serialized as `keys=<target>,<source>`.
- Optional passthroughs: `fields[]`, `prefix`, `where`, `calc`, `unjoined`, `unmatched`.
- Extend the dataset-replace runner so it accepts an optional `inputFiles` cache and attaches it to every parsed command (mapshaper commands that don't use it ignore it). This is the same mechanism `setData` uses for `-i`.
- Add `JoinTableOptions` interface; re-export from `src/index.ts`.
- Add `test/examples/join.html` — load a Shapefile/GeoJSON, paste CSV in a textarea, configure keys, run join.

## Impact
- Affected specs: `join` (new capability)
- Affected code:
  - `src/map/map.ts` — new public method, options interface, runner-signature widening
  - `src/map/map.test.ts` — new describe block (mocked + a real-mapshaper round-trip with a tiny GeoJSON + CSV)
  - `src/index.ts` — re-export
  - `test/examples/join.html` — new example
- Runner extension is backward-compatible: `inputFiles` is optional, all existing call sites unchanged.

## Notes
- v1 omits `string-fields=`, `dynamic-vars=`, `interpolate=` — they're niche and can be added behind options later.
- We don't accept arbitrary "any-format" file-by-content in v1: only CSV (auto-detected from `csv:` field) and JSON (`json:` field) are supported. Users with TSV / DBF / etc. data should pre-load via `setData` and use `{ layer: 'name' }`.
- The synthetic filenames `.emap-join.csv` / `.emap-join.json` collide if `joinTable` is called twice in flight — that won't happen because the runner is awaited per-call. We still use distinct names for csv vs json to make mapshaper's extension-based auto-detection work correctly.
- Plain arrays/objects passed via `{ json: ... }` go through `JSON.stringify` once. The roundtrip cost is negligible for the table sizes that fit in browser memory.

# Change: Add `bufferLayer` — generate buffer polygons

## Why
`-buffer` is one of mapshaper's headline geometry ops and is the missing fourth dataset-replace command alongside clip / erase / dissolve. It is also the canonical proof that adding more `_runDatasetCommand`-shaped operations costs almost nothing now that the runner is in place.

## What Changes
- Add `Emap.bufferLayer({ source, target, radius, capStyle? }): Promise<boolean>` that builds the mapshaper command `-target "<TARGET>" -buffer <RADIUS> [cap-style=...]` and delegates to the existing `_runDatasetCommand`.
- Support both **constant radius** (`number`) and **expression radius** (`string`, e.g. `"pop / 1000"`) — mapshaper accepts both in the same positional argument (`mapshaper-options.mjs:454`: "radius of buffer, as an expression or a constant").
- Support `capStyle: 'flat' | 'round'` (mapshaper's `cap-style=` option). Default left to mapshaper.
- Add `BufferOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/buffer.html`.

## Impact
- Affected specs: `buffer` (new capability)
- Affected code: `src/map/map.ts` (one new public method), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example
- No new commands files, no new helpers. Pure runner-reuse.

## Notes
- v1 does not expose `tolerance=`, `vertices=`, `arc-quality=`, `slice-length=`, `backtrack=`, `type=`, `planar`, `v2`, `v3` — every advanced knob mapshaper offers. The defaults match mapshaper's CLI defaults; specialised use can come later when there is a real caller.
- Buffer requires polygon / polyline / point geometry (mapshaper handles all three). emap does not artificially restrict — pass through whatever the layer is.
- Radius units are interpreted in source CRS coordinates, identical to mapshaper CLI behaviour (e.g., degrees for `EPSG:4326`, metres for `EPSG:3857`). Documented in JSDoc.

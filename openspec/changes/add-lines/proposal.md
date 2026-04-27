# Change: Add `linesLayer` — convert polygons to polylines

## Why
mapshaper's `-lines` flips a polygon layer into a polyline layer made of its boundary arcs. With `fields=`, the boundaries are tagged hierarchically (e.g. outer national border vs. inter-state borders vs. inter-county borders) — the canonical "extract administrative borders" workflow. Together with `-divide`, `-mosaic`, `-union` and the new `-points`, this rounds out the geometry-conversion family.

## What Changes
- Add `Emap.linesLayer({ source, target, fields?, name?, noReplace? }): Promise<boolean>` in `src/map/map.ts`.
- Build the mapshaper command `-target "<target>" -lines [<fields-csv>] [name="..."] [no-replace]` and delegate to `_runDatasetCommand`.
- Validate that `target` resolves to a polygon layer (the polyline-to-polyline and point-with-groupby modes are out of scope for v1).
- Add `LinesOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/lines.html` with a target dropdown (polygon-only) and an optional fields input.

## Impact
- Affected specs: `lines` (new capability)
- Affected code: `src/map/map.ts` (one new public method + options interface), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example HTML
- No new infrastructure.

## Notes
- v1 omits the `where=`, `each=`, `segments`, `callouts`, `arcs`, and `groupby` flags. They are debug-leaning or workflow-specific; the boundary-extraction case is the 95% use.
- `fields` is mapshaper's positional arg (`DEFAULT: true`). We emit the comma-joined list as a bare positional token (no `fields=` prefix), matching how the CLI is normally invoked.

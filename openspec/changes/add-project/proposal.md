# Change: Add `projectLayer` — reproject coordinates via mapshaper `-proj`

## Why
Many mapshaper operations (buffer, area calculations, distance tolerances in `snap` / `simplify`) need projected coordinates to produce sensible numbers — running them on lat/lon (EPSG:4326) data produces results in degrees, which are nonsensical at any non-equatorial latitude. The canonical workflow is:

1. Load EPSG:4326 GeoJSON.
2. Project to a local CRS (UTM, web mercator, equal-area).
3. Run buffer / simplify / area ops in metres.
4. Optionally project back to 4326 for display / export.

mapshaper's `-proj` does this via Proj.4. emap already has a low-level `TopologySource.reproject` for source-level CRS swapping, but it doesn't go through the dataset-replace runner so it's not undoable and can't target a single layer. `Emap.projectLayer` plugs the gap — undoable, layer-scoped, consistent with the other dataset-replace wrappers.

## What Changes
- Add `Emap.projectLayer({ source, crs, target?, init?, densify? }): Promise<boolean>` in `src/map/map.ts`.
- Build the mapshaper command `[-target "<target>"] -proj "<crs>" [init="<src-crs>"] [densify]` and delegate to `_runDatasetCommand`.
- Validate the source resolves and (when supplied) `target` resolves to a layer in the source. `crs` must be a non-empty trimmed string.
- Add `ProjectOptions` interface; re-export from `src/index.ts`.
- Add `test/examples/project.html` with a CRS dropdown of common aliases (EPSG codes + named projections like `'webmercator'` / `'robinson'`).

## Impact
- Affected specs: `project` (new capability)
- Affected code: `src/map/map.ts`, `src/map/map.test.ts`, `src/index.ts`, new example
- No new infrastructure. Reuses `_runDatasetCommand` and the existing mproj setup that ships with mapshaper.

## Notes
- v1 covers the 90% case: destination `crs` string + optional source-CRS override (`init`) + `densify` flag for curved-segment approximation.
- v1 omits:
  - `match=<layer or .prj>` — needs additional infrastructure to express layer references; users with this need can pre-load the .prj as a string and use `init=` instead.
  - `clip-angle` — azimuthal-projection-specific edge case.
  - `clip-bbox` — secondary; can be composed via a separate `-clip` step before `projectLayer`.
- mapshaper's `-proj` `crs` is `multi_arg join:' '`, accepting Proj.4 strings with spaces. We always quote the value via `quoteMapshaperArg` so spaces survive `splitShellTokens`.
- After successful project, the source's stored CRS metadata is updated by mapshaper inside the dataset; emap's existing `data` event fires once and `Projection` / `Viewport` may need to re-key. For v1 we don't auto-fit the viewport to the new projected extent — callers should call `setExtent(source.getExtent())` after `await projectLayer(...)` if they want the recentre.

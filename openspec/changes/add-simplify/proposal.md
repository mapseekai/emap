# Change: Add `simplifyLayer` — geometry simplification (DP / Visvalingam)

## Why
mapshaper's `-simplify` is the project's flagship command — Douglas–Peucker / Visvalingam / weighted-Visvalingam line simplification with a percentage / interval / resolution threshold. It's used everywhere: cartographic generalization, payload reduction for export, and producing simpler geometry for downstream overlay analysis.

emap already simplifies for **render-time LOD** via `DisplayArcs`, but that's a transient render filter; users who want to bake simplification into the dataset (so it survives export, propagates through subsequent commands, and reduces memory) need an explicit operation. This is the most-requested missing wrapper after the geometry-conversion family.

## What Changes
- Add `Emap.simplifyLayer({ source, target?, percentage?, interval?, resolution?, method?, weighting?, planar?, keepShapes?, lockBox?, noRepair? }): Promise<boolean>` in `src/map/map.ts`.
- Validate exactly one threshold is provided (percentage / interval / resolution) and that percentage is in `[0, 100]`, interval > 0, resolution matches `\d+x\d+`.
- Build `[-target "<name>"] -simplify <threshold> [<method>] [weighting=N] [planar] [keep-shapes] [lock-box] [no-repair]` and delegate to `_runDatasetCommand`.
- `target` is **optional**: simplify operates on the dataset's shared arcs, so omitting it scopes to the whole source (matching mapshaper CLI default).
- Add `SimplifyOptions` and `SimplifyMethod` types; re-export from `src/index.ts`.
- Add `test/examples/simplify.html`.

## Impact
- Affected specs: `simplify` (new capability)
- Affected code:
  - `src/map/map.ts` — one new public method + types
  - `src/map/map.test.ts` — new integration tests
  - `src/index.ts` — re-exports
  - `test/examples/simplify.html` — new example
- No new infrastructure. Reuses `_runDatasetCommand`.

## Notes
- mapshaper's `-simplify` mutates the dataset's arcs in place (sets `zz` thresholds + `zlimit`); `xx`/`yy` arrays are unchanged. Subsequent commands and exports honour the threshold automatically. Running `-simplify` again with a different threshold replaces the previous one — non-destructive in the sense that the original vertex data is preserved.
- Method `weighted` is mapshaper's default; `dp` (Douglas–Peucker) and `visvalingam` are explicit alternatives. `weighted` accepts a `weighting` coefficient (default 0.7).
- `keep-shapes` is the right choice for most chloropleth maps (prevents tiny states/counties from disappearing); we expose it as a boolean.
- v1 omits the `variable` flag (per-feature expression for the threshold) and the legacy `cartesian` alias of `planar`.
- Conflict with the render-time `DisplayArcs`: after `simplifyLayer` resolves, the source's `setDataset` path triggers `refreshDisplayArcs`, which rebuilds the LOD copy from the now-simplified arcs. No render-side change needed.
